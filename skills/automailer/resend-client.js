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

    // Multi-mailbox rotation : GMAIL_MAILBOXES=user1:pass1,user2:pass2,user3:pass3
    this.mailboxes = [];
    this._mailboxIndex = 0;
    const mailboxesEnv = (process.env.GMAIL_MAILBOXES || '').trim();
    if (mailboxesEnv) {
      for (const entry of mailboxesEnv.split(',')) {
        const [user, pass] = entry.trim().split(':');
        if (user && pass) {
          this.mailboxes.push({ user: user.trim(), pass: pass.trim().replace(/\s/g, '') });
        }
      }
    }

    // Fallback : ancienne config mono-boîte si pas de GMAIL_MAILBOXES
    this.gmailEnabled = process.env.GMAIL_SMTP_ENABLED === 'true';
    this.gmailUser = process.env.GMAIL_SMTP_USER || '';
    this.gmailPass = (process.env.GMAIL_SMTP_PASS || '').replace(/\s/g, '');

    // Si mono-boîte configurée et pas de multi, l'ajouter au tableau
    if (this.mailboxes.length === 0 && this.gmailEnabled && this.gmailUser && this.gmailPass) {
      this.mailboxes.push({ user: this.gmailUser, pass: this.gmailPass });
    }

    // Per-mailbox error tracking (circuit breaker)
    this._mailboxErrors = {}; // { user: { count: N, lastError: timestamp } }

    if (this.mailboxes.length > 0) {
      log.info('resend-client', 'Gmail SMTP actif: ' + this.mailboxes.length + ' boite(s) en rotation — ' + this.mailboxes.map(m => m.user).join(', '));
    }
  }

  /**
   * Retourne la prochaine boîte mail en rotation round-robin.
   * Skip les boîtes avec 3+ erreurs consecutives (cooldown 5 min).
   */
  _nextMailbox() {
    if (this.mailboxes.length === 0) return null;
    const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const MAX_ERRORS = 3;
    // Try each mailbox, starting from current index
    for (let i = 0; i < this.mailboxes.length; i++) {
      const idx = (this._mailboxIndex + i) % this.mailboxes.length;
      const mb = this.mailboxes[idx];
      const err = this._mailboxErrors[mb.user];
      if (err && err.count >= MAX_ERRORS && (Date.now() - err.lastError) < COOLDOWN_MS) {
        continue; // Skip this mailbox (in cooldown)
      }
      // Reset if cooldown expired
      if (err && err.count >= MAX_ERRORS && (Date.now() - err.lastError) >= COOLDOWN_MS) {
        err.count = 0;
      }
      this._mailboxIndex = idx + 1;
      return mb;
    }
    // All mailboxes in cooldown — try the first one anyway
    this._mailboxIndex++;
    return this.mailboxes[(this._mailboxIndex - 1) % this.mailboxes.length];
  }

  _recordMailboxError(user) {
    if (!this._mailboxErrors[user]) this._mailboxErrors[user] = { count: 0, lastError: 0 };
    this._mailboxErrors[user].count++;
    this._mailboxErrors[user].lastError = Date.now();
    if (this._mailboxErrors[user].count >= 3) {
      log.warn('resend-client', 'Mailbox ' + user + ' en cooldown (3+ erreurs consecutives)');
    }
  }

  _resetMailboxErrors(user) {
    if (this._mailboxErrors[user]) this._mailboxErrors[user].count = 0;
  }

  // --- Gmail SMTP (prioritaire) ---

  _smtpCommand(socket, command) {
    return new Promise((resolve, reject) => {
      let response = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.removeListener('data', onData);
        if (!response) reject(new Error('SMTP timeout'));
        else resolve(response.trim());
      }, 15000);
      const onData = (data) => {
        response += data.toString();
        if (/^\d{3}[ -]/m.test(response) && response.endsWith('\r\n')) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.removeListener('data', onData);
          resolve(response.trim());
        }
      };
      socket.on('data', onData);
      if (command) socket.write(command + '\r\n');
    });
  }

  async _sendViaGmail(to, subject, body, options, mailbox) {
    options = options || {};
    const toEmail = Array.isArray(to) ? to[0] : to;
    const fromName = options.fromName || process.env.SENDER_NAME || 'Alexis';
    // Utiliser la boîte passée en paramètre ou fallback sur this.gmailUser
    const smtpUser = mailbox ? mailbox.user : this.gmailUser;
    const smtpPass = mailbox ? mailbox.pass : this.gmailPass;
    const smtpDomain = smtpUser.split('@')[1] || process.env.CLIENT_DOMAIN || 'ifind.fr';

    // Construire le message MIME
    const boundary = 'boundary_' + crypto.randomBytes(8).toString('hex');
    const messageId = '<' + crypto.randomBytes(12).toString('hex') + '@' + smtpDomain + '>';
    const htmlBody = options.html || this._minimalHtml(body, options.trackingId, toEmail);
    const trackingDomain = process.env.TRACKING_DOMAIN || process.env.CLIENT_DOMAIN || 'ifind.fr';

    const replyTo = options.replyTo || process.env.REPLY_TO_EMAIL || smtpUser;

    const mime = [
      'From: ' + fromName + ' <' + smtpUser + '>',
      'Reply-To: ' + replyTo,
      'To: ' + toEmail,
      'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
      'MIME-Version: 1.0',
      'Message-ID: ' + messageId,
      'List-Unsubscribe: <https://' + trackingDomain + '/unsubscribe?email=' + encodeURIComponent(toEmail) + '>',
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
      options.inReplyTo ? 'In-Reply-To: ' + options.inReplyTo : null,
      options.references ? 'References: ' + options.references : (options.inReplyTo ? 'References: ' + options.inReplyTo : null),
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
    ].filter(Boolean).join('\r\n');

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(587, 'smtp.gmail.com');
      let tlsSocket = null;
      let currentSocket = socket;
      let settled = false;
      const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };
      const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };

      const cleanup = () => {
        try { if (tlsSocket) tlsSocket.destroy(); } catch (e) {}
        try { socket.destroy(); } catch (e) {}
      };

      socket.setTimeout(30000, () => { cleanup(); safeReject(new Error('Gmail SMTP timeout')); });

      socket.on('error', (e) => { cleanup(); safeReject(new Error('Gmail SMTP erreur: ' + e.message)); });

      socket.on('connect', async () => {
        try {
          // Greeting
          await this._smtpCommand(currentSocket, null);
          // EHLO
          await this._smtpCommand(currentSocket, 'EHLO ' + smtpDomain);
          // STARTTLS
          await this._smtpCommand(currentSocket, 'STARTTLS');

          // Upgrade to TLS
          tlsSocket = tls.connect({ socket: socket, servername: 'smtp.gmail.com' }, async () => {
            try {
              currentSocket = tlsSocket;
              // EHLO again after TLS
              await this._smtpCommand(currentSocket, 'EHLO ' + smtpDomain);
              // AUTH LOGIN
              const authResp = await this._smtpCommand(currentSocket, 'AUTH LOGIN');
              if (!authResp.startsWith('334')) { cleanup(); return safeReject(new Error('AUTH failed: ' + authResp)); }
              // Username
              const userResp = await this._smtpCommand(currentSocket, Buffer.from(smtpUser).toString('base64'));
              if (!userResp.startsWith('334')) { cleanup(); return safeReject(new Error('AUTH user failed: ' + userResp)); }
              // Password
              const passResp = await this._smtpCommand(currentSocket, Buffer.from(smtpPass).toString('base64'));
              if (!passResp.startsWith('235')) { cleanup(); return safeReject(new Error('AUTH pass failed: ' + passResp)); }

              // MAIL FROM
              const fromResp = await this._smtpCommand(currentSocket, 'MAIL FROM:<' + smtpUser + '>');
              if (!fromResp.startsWith('250')) { cleanup(); return safeReject(new Error('MAIL FROM failed: ' + fromResp)); }
              // RCPT TO
              const rcptResp = await this._smtpCommand(currentSocket, 'RCPT TO:<' + toEmail + '>');
              if (!rcptResp.startsWith('250')) { cleanup(); return safeReject(new Error('RCPT TO failed: ' + rcptResp)); }
              // DATA
              const dataResp = await this._smtpCommand(currentSocket, 'DATA');
              if (!dataResp.startsWith('354')) { cleanup(); return safeReject(new Error('DATA failed: ' + dataResp)); }
              // Send message body + terminator
              const sendResp = await this._smtpCommand(currentSocket, mime + '\r\n.');
              if (!sendResp.startsWith('250')) { cleanup(); return safeReject(new Error('Send failed: ' + sendResp)); }

              // QUIT
              try { await this._smtpCommand(currentSocket, 'QUIT'); } catch (e) {}
              cleanup();

              // Extraire le message ID de la reponse Gmail
              const idMatch = sendResp.match(/sm\d+|[a-z0-9]{10,}/i);
              safeResolve({ success: true, id: 'gmail_' + (idMatch ? idMatch[0] : Date.now().toString(36)), messageId: messageId });
            } catch (e) {
              cleanup();
              safeReject(e);
            }
          });

          tlsSocket.on('error', (e) => { cleanup(); safeReject(new Error('TLS erreur: ' + e.message)); });
        } catch (e) {
          cleanup();
          safeReject(e);
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
  _minimalHtml(body, trackingId, toEmail) {
    const escaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const senderFullName = (process.env.SENDER_FULL_NAME || 'Alexis Bénier').replace(/é/g, '&eacute;').replace(/è/g, '&egrave;').replace(/ê/g, '&ecirc;').replace(/à/g, '&agrave;');
    const senderTitle = process.env.SENDER_TITLE || 'Fondateur';
    const clientDomain = process.env.CLIENT_DOMAIN || 'ifind.fr';
    const trackingDomain = process.env.TRACKING_DOMAIN || clientDomain;
    // Micro-variation signature (anti-fingerprint)
    const dashes = ['\u2014', '\u2013', '--'];
    const dash = dashes[Math.floor(Math.random() * dashes.length)];
    const separators = [' \u2014 ', ' | ', ' \u2013 '];
    const sep = separators[Math.floor(Math.random() * separators.length)];
    const signature = '<br><span style="color:#666;font-size:13px">'
      + dash + '<br>'
      + senderFullName + '<br>'
      + senderTitle + sep + clientDomain
      + '</span>';

    // Lien de desabonnement visible dans le footer
    const unsubLink = toEmail
      ? '<br><br><span style="font-size:11px;color:#999"><a href="https://' + trackingDomain + '/unsubscribe?email=' + encodeURIComponent(toEmail) + '" style="color:#999;text-decoration:underline">Se desabonner</a></span>'
      : '';

    // Pixel de tracking ouverture (invisible)
    const pixel = trackingId
      ? '<img src="https://' + trackingDomain + '/t/' + trackingId + '.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">'
      : '';

    return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + escaped + signature + unsubLink + '</div>' + pixel;
  }

  // --- Envoi principal (Gmail prioritaire, Resend fallback) ---

  async sendEmail(to, subject, body, options) {
    const toEmail = Array.isArray(to) ? to[0] : to;

    // Multi-domaine : selectionner le domaine optimal via DomainManager
    let selectedDomain = null;
    let domainMailbox = null;
    try {
      const domainManager = require('./domain-manager.js');
      selectedDomain = domainManager.selectDomain(toEmail);
      if (selectedDomain) {
        domainMailbox = domainManager.getMailboxForDomain(selectedDomain.domain);
      }
    } catch (e) { /* domain-manager non dispo, fallback classique */ }

    // Gmail SMTP via rotation multi-boîtes (ou domaine selectionne)
    const mailbox = domainMailbox || this._nextMailbox();
    if (mailbox) {
      try {
        const result = await this._sendViaGmail(to, subject, body, options, mailbox);
        const usedDomain = selectedDomain ? selectedDomain.domain : (mailbox.user.split('@')[1] || '?');
        log.info('resend-client', 'Email envoye via Gmail SMTP (' + mailbox.user + ') a ' + toEmail + ' [domain: ' + usedDomain + ']');
        if (_appConfig && _appConfig.recordServiceUsage) {
          _appConfig.recordServiceUsage('gmail', { emails: 1 });
        }
        // Tracker l'envoi dans le domain manager
        try {
          const dm = require('./domain-manager.js');
          dm.recordSend(usedDomain, toEmail, true);
        } catch (e) {}
        if (result) result.senderDomain = usedDomain;
        this._resetMailboxErrors(mailbox.user);
        return result;
      } catch (e) {
        this._recordMailboxError(mailbox.user);
        log.warn('resend-client', 'Gmail SMTP (' + mailbox.user + ') echoue, fallback Resend: ' + e.message);
      }
    }

    // Fallback Resend API
    options = options || {};
    const fromName = options.fromName || process.env.SENDER_NAME || 'Alexis';
    const trackingDomainResend = process.env.TRACKING_DOMAIN || process.env.CLIENT_DOMAIN || 'ifind.fr';
    const payload = {
      from: fromName + ' <' + this.senderEmail + '>',
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      text: body,
      html: options.html || this._minimalHtml(body, options.trackingId, toEmail),
      headers: {
        'List-Unsubscribe': '<https://' + trackingDomainResend + '/unsubscribe?email=' + encodeURIComponent(toEmail) + '>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    };
    if (options.inReplyTo) {
      payload.headers['In-Reply-To'] = options.inReplyTo;
      payload.headers['References'] = options.references || options.inReplyTo;
    }
    if (options.tags) payload.tags = options.tags;
    payload.reply_to = options.replyTo || process.env.REPLY_TO_EMAIL || this.senderEmail;

    // Retry avec backoff exponentiel sur 429 (rate limit)
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await this._request('POST', '/emails', payload);
      if (result.statusCode !== 429) break;
      const delay = Math.pow(2, attempt + 1) * 1000 + Math.floor(Math.random() * 1000); // 2-3s, 4-5s, 8-9s (jitter)
      log.warn('resend', 'Rate limit 429 — retry dans ' + (delay / 1000) + 's (tentative ' + (attempt + 1) + '/3)');
      await new Promise(r => setTimeout(r, delay));
    }

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
    // En mode Gmail, envoyer un par un avec rotation
    if (this.mailboxes.length > 0) {
      const results = [];
      for (const e of emails) {
        const mailbox = this._nextMailbox();
        try {
          const r = await this._sendViaGmail(e.to, e.subject, e.body, { fromName: e.fromName || process.env.SENDER_NAME || 'Alexis', trackingId: e.trackingId }, mailbox);
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
      const fromName = e.fromName || process.env.SENDER_NAME || 'Alexis';
      return {
        from: fromName + ' <' + this.senderEmail + '>',
        to: Array.isArray(e.to) ? e.to : [e.to],
        subject: e.subject,
        text: e.body,
        html: this._minimalHtml(e.body, e.trackingId, toEmail),
        tags: e.tags || [],
        reply_to: process.env.REPLY_TO_EMAIL || process.env.SENDER_EMAIL,
        headers: {
          'List-Unsubscribe': '<https://' + (process.env.TRACKING_DOMAIN || process.env.CLIENT_DOMAIN || 'ifind.fr') + '/unsubscribe?email=' + encodeURIComponent(toEmail) + '>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
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
