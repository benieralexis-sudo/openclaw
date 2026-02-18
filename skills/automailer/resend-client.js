// AutoMailer - Client API Resend
const https = require('https');
const log = require('../../gateway/logger.js');

class ResendClient {
  constructor(apiKey, senderEmail) {
    this.apiKey = apiKey;
    this.senderEmail = senderEmail || 'onboarding@resend.dev';
  }

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
  // Permet le tracking ouvertures/clics par Resend (pixel invisible)
  _minimalHtml(body) {
    // Echapper le HTML dans le texte, puis convertir les sauts de ligne
    const escaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + escaped + '</div>';
  }

  async sendEmail(to, subject, body, options) {
    options = options || {};
    const toEmail = Array.isArray(to) ? to[0] : to;
    const fromName = options.fromName || 'Alexis';
    const payload = {
      from: fromName + ' <' + this.senderEmail + '>',
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      text: body,
      html: options.html || this._minimalHtml(body), // HTML minimal pour tracking ouvertures/clics
      headers: {
        'List-Unsubscribe': '<https://ifind.fr/unsubscribe?email=' + encodeURIComponent(toEmail) + '>'
      }
    };
    if (options.tags) payload.tags = options.tags;
    if (options.replyTo) payload.reply_to = options.replyTo;

    const result = await this._request('POST', '/emails', payload);

    if (result.statusCode === 200 || result.statusCode === 201) {
      return { success: true, id: result.data.id };
    }
    const errorMsg = result.data.message || result.data.error || ('Resend erreur ' + result.statusCode);
    return { success: false, error: errorMsg, statusCode: result.statusCode };
  }

  async sendBatch(emails) {
    // emails = [{to, subject, body, options}, ...]
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
        reply_to: 'hello@ifind.fr',
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
