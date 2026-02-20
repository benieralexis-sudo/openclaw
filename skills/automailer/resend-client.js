// AutoMailer - Client Email (Gmail SMTP + Resend fallback)
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const log = require('../../gateway/logger.js');
let _appConfig = null;
try { _appConfig = require('../../gateway/app-config.js'); } catch (e) {}

class ResendClient {
  constructor(apiKey, senderEmail) {
    this.apiKey = apiKey;
    this.senderEmail = senderEmail || 'onboarding@resend.dev';
    // Gmail SMTP config
    this.gmailEnabled = process.env.GMAIL_SMTP_ENABLED === 'true';
    this.gmailUser = process.env.GMAIL_SMTP_USER || '';
    this.gmailPass = (process.env.GMAIL_SMTP_PASS || '').replace(/\s/g, '');
    if (this.gmailEnabled && this.gmailUser) {
      log.info('resend-client', 'Gmail SMTP actif: ' + this.gmailUser);
    }
  }

  // --- Gmail SMTP (prioritaire) ---

  _smtpCommand(socket, command) {
    return new Promise((resolve, reject) => {
      let response = '';
      const onData = (data) => {
        response += data.toString();
        // SMTP responses end with \r\n and start with 3-digit code
        if (/^\d{3}[ -]/m.test(response) && response.endsWith('\r\n')) {
          socket.removeListener('data', onData);
          resolve(response.trim());
        }
      };
      socket.on('data', onData);
      if (command) socket.write(command + '\r\n');
      setTimeout(() => {
        socket.removeListener('data', onData);
        if (!response) reject(new Error('SMTP timeout'));
        else resolve(response.trim());
      }, 15000);
    });
  }

  async _sendViaGmail(to, subject, body, options) {
    options = options || {};
    const toEmail = Array.isArray(to) ? to[0] : to;
    const fromName = options.fromName || 'Alexis';

    // Construire le message MIME
    const boundary = 'boundary_' + crypto.randomBytes(8).toString('hex');
    const messageId = '<' + crypto.randomBytes(12).toString('hex') + '@getifind.fr>';
    const htmlBody = options.html || this._minimalHtml(body);

    const mime = [
      'From: ' + fromName + ' <' + this.gmailUser + '>',
      'To: ' + toEmail,
      'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
      'MIME-Version: 1.0',
      'Message-ID: ' + messageId,
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body).toString('base64'),
      '',
      '--' + boundary,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(htmlBody).toString('base64'),
      '',
      '--' + boundary + '--'
    ].join('\r\n');

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(587, 'smtp.gmail.com');
      let tlsSocket = null;
      let currentSocket = socket;

      const cleanup = () => {
        try { if (tlsSocket) tlsSocket.destroy(); } catch (e) {}
        try { socket.destroy(); } catch (e) {}
      };

      socket.setTimeout(30000, () => { cleanup(); reject(new Error('Gmail SMTP timeout')); });

      socket.on('error', (e) => { cleanup(); reject(new Error('Gmail SMTP erreur: ' + e.message)); });

      socket.on('connect', async () => {
        try {
          // Greeting
          await this._smtpCommand(currentSocket, null);
          // EHLO
          await this._smtpCommand(currentSocket, 'EHLO getifind.fr');
          // STARTTLS
          await this._smtpCommand(currentSocket, 'STARTTLS');

          // Upgrade to TLS
          tlsSocket = tls.connect({ socket: socket, servername: 'smtp.gmail.com' }, async () => {
            try {
              currentSocket = tlsSocket;
              // EHLO again after TLS
              await this._smtpCommand(currentSocket, 'EHLO getifind.fr');
              // AUTH LOGIN
              const authResp = await this._smtpCommand(currentSocket, 'AUTH LOGIN');
              if (!authResp.startsWith('334')) { cleanup(); return reject(new Error('AUTH failed: ' + authResp)); }
              // Username
              const userResp = await this._smtpCommand(currentSocket, Buffer.from(this.gmailUser).toString('base64'));
              if (!userResp.startsWith('334')) { cleanup(); return reject(new Error('AUTH user failed: ' + userResp)); }
              // Password
              const passResp = await this._smtpCommand(currentSocket, Buffer.from(this.gmailPass).toString('base64'));
              if (!passResp.startsWith('235')) { cleanup(); return reject(new Error('AUTH pass failed: ' + passResp)); }

              // MAIL FROM
              const fromResp = await this._smtpCommand(currentSocket, 'MAIL FROM:<' + this.gmailUser + '>');
              if (!fromResp.startsWith('250')) { cleanup(); return reject(new Error('MAIL FROM failed: ' + fromResp)); }
              // RCPT TO
              const rcptResp = await this._smtpCommand(currentSocket, 'RCPT TO:<' + toEmail + '>');
              if (!rcptResp.startsWith('250')) { cleanup(); return reject(new Error('RCPT TO failed: ' + rcptResp)); }
              // DATA
              const dataResp = await this._smtpCommand(currentSocket, 'DATA');
              if (!dataResp.startsWith('354')) { cleanup(); return reject(new Error('DATA failed: ' + dataResp)); }
              // Send message body + terminator
              const sendResp = await this._smtpCommand(currentSocket, mime + '\r\n.');
              if (!sendResp.startsWith('250')) { cleanup(); return reject(new Error('Send failed: ' + sendResp)); }

              // QUIT
              try { await this._smtpCommand(currentSocket, 'QUIT'); } catch (e) {}
              cleanup();

              // Extraire le message ID de la reponse Gmail
              const idMatch = sendResp.match(/sm\d+|[a-z0-9]{10,}/i);
              resolve({ success: true, id: 'gmail_' + (idMatch ? idMatch[0] : Date.now().toString(36)) });
            } catch (e) {
              cleanup();
              reject(e);
            }
          });

          tlsSocket.on('error', (e) => { cleanup(); reject(new Error('TLS erreur: ' + e.message)); });
        } catch (e) {
          cleanup();
          reject(e);
        }
      });
    });
  }

  // --- Resend API (fallback) ---

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : '';
      const headers = {
        'Authorization': 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json'
      };
      if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

      const req = https.request({
        hostname: 'api.resend.com',
        path: path,
        method: method,
        headers: headers
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ statusCode: res.statusCode, data: data });
          }
        });
      });
      req.on('error', (e) => {
        log.error('resend', 'Erreur reseau:', e.message);
        reject(new Error('Resend erreur reseau: ' + e.message));
      });
      req.setTimeout(15000, () => {
        req.destroy();
        log.error('resend', 'Timeout API (15s)');
        reject(new Error('Resend timeout (15s)'));
      });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // HTML minimal — ressemble a un email tape dans Gmail, zero branding
  _minimalHtml(body) {
    const escaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const signature = '<br><span style="color:#666;font-size:13px">'
      + '—<br>'
      + 'Alexis B&eacute;nier<br>'
      + 'Fondateur &mdash; ifind.fr'
      + '</span>';

    return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + escaped + signature + '</div>';
  }

  // --- Envoi principal (Gmail prioritaire, Resend fallback) ---

  async sendEmail(to, subject, body, options) {
    // Gmail SMTP si disponible
    if (this.gmailEnabled && this.gmailUser && this.gmailPass) {
      try {
        const result = await this._sendViaGmail(to, subject, body, options);
        log.info('resend-client', 'Email envoye via Gmail SMTP a ' + (Array.isArray(to) ? to[0] : to));
        if (_appConfig && _appConfig.recordServiceUsage) {
          _appConfig.recordServiceUsage('gmail', { emails: 1 });
        }
        return result;
      } catch (e) {
        log.warn('resend-client', 'Gmail SMTP echoue, fallback Resend: ' + e.message);
      }
    }

    // Fallback Resend API
    options = options || {};
    const toEmail = Array.isArray(to) ? to[0] : to;
    const fromName = options.fromName || 'Alexis';
    const payload = {
      from: fromName + ' <' + this.senderEmail + '>',
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      text: body,
      html: options.html || this._minimalHtml(body),
      headers: {
        'List-Unsubscribe': '<https://ifind.fr/unsubscribe?email=' + encodeURIComponent(toEmail) + '>'
      }
    };
    if (options.tags) payload.tags = options.tags;
    if (options.replyTo) payload.reply_to = options.replyTo;

    const result = await this._request('POST', '/emails', payload);

    if (result.statusCode === 200 || result.statusCode === 201) {
      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('resend', { emails: 1 });
      }
      return { success: true, id: result.data.id };
    }
    const errorMsg = result.data.message || result.data.error || ('Resend erreur ' + result.statusCode);
    return { success: false, error: errorMsg, statusCode: result.statusCode };
  }

  async sendBatch(emails) {
    // En mode Gmail, envoyer un par un
    if (this.gmailEnabled && this.gmailUser && this.gmailPass) {
      const results = [];
      for (const e of emails) {
        try {
          const r = await this._sendViaGmail(e.to, e.subject, e.body, { fromName: e.fromName || 'Alexis' });
          results.push(r);
        } catch (err) {
          results.push({ success: false, error: err.message });
        }
      }
      return { success: true, data: results };
    }

    // Fallback Resend batch
    const payload = emails.map(e => {
      const toEmail = Array.isArray(e.to) ? e.to[0] : e.to;
      const fromName = e.fromName || 'Alexis';
      return {
        from: fromName + ' <' + this.senderEmail + '>',
        to: Array.isArray(e.to) ? e.to : [e.to],
        subject: e.subject,
        text: e.body,
        html: this._minimalHtml(e.body),
        tags: e.tags || [],
        reply_to: 'alexis@getifind.fr',
        headers: {
          'List-Unsubscribe': '<https://ifind.fr/unsubscribe?email=' + encodeURIComponent(toEmail) + '>'
        }
      };
    });

    const result = await this._request('POST', '/emails/batch', payload);

    if (result.statusCode === 200 || result.statusCode === 201) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.data.message || ('Resend batch erreur ' + result.statusCode) };
  }

  async getEmail(emailId) {
    const result = await this._request('GET', '/emails/' + emailId);
    if (result.statusCode === 200) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.data.message || ('Resend erreur ' + result.statusCode) };
  }
}

module.exports = ResendClient;
