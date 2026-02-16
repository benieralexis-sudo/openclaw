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
        resolve({ statusCode: 0, data: { error: e.message } });
      });
      req.setTimeout(15000, () => {
        req.destroy();
        log.error('resend', 'Timeout API (15s)');
        resolve({ statusCode: 0, data: { error: 'Timeout Resend' } });
      });
      if (postData) req.write(postData);
      req.end();
    });
  }

  _brandedHtml(body, toEmail) {
    const content = body.replace(/\n/g, '<br>');
    const unsubLink = toEmail
      ? '<br><a href="https://ifind.fr/unsubscribe?email=' + encodeURIComponent(toEmail) + '" style="color:#a8a29e;text-decoration:underline;font-size:11px">Se d&eacute;sabonner</a>'
      : '';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
      + '<body style="margin:0;padding:0;background:#f8f8f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f7;padding:32px 16px"><tr><td align="center">'
      + '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">'
      // Logo header
      + '<tr><td style="padding:0 0 24px 0">'
      + '<table cellpadding="0" cellspacing="0"><tr>'
      + '<td style="background:linear-gradient(135deg,#2563EB,#1e40af);border-radius:7px;width:28px;height:28px;text-align:center;vertical-align:middle">'
      + '<span style="color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:600;line-height:28px">i</span>'
      + '</td>'
      + '<td style="padding-left:5px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:500;color:#1C1917;letter-spacing:-0.01em">find</td>'
      + '</tr></table>'
      + '</td></tr>'
      // Email body
      + '<tr><td style="background:#ffffff;border-radius:12px;padding:32px 36px;font-size:15px;line-height:1.7;color:#1C1917;border:1px solid #e7e5e4">'
      + content
      + '</td></tr>'
      // Footer
      + '<tr><td style="padding:20px 0 0 0;text-align:center;font-size:11px;color:#a8a29e">'
      + 'Envoy&eacute; par ifind.fr'
      + unsubLink
      + '</td></tr>'
      + '</table></td></tr></table></body></html>';
  }

  async sendEmail(to, subject, body, options) {
    options = options || {};
    const toEmail = Array.isArray(to) ? to[0] : to;
    const html = this._brandedHtml(body, toEmail);
    const payload = {
      from: options.fromName
        ? options.fromName + ' <' + this.senderEmail + '>'
        : 'ifind <' + this.senderEmail + '>',
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
      text: body,
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
      const html = this._brandedHtml(e.body, toEmail);
      return {
        from: e.fromName
          ? e.fromName + ' <' + this.senderEmail + '>'
          : 'ifind <' + this.senderEmail + '>',
        to: Array.isArray(e.to) ? e.to : [e.to],
        subject: e.subject,
        html: html,
        text: e.body,
        tags: e.tags || [],
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
