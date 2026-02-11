// AutoMailer - Client API Resend
const https = require('https');

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
      req.on('error', (e) => resolve({ statusCode: 0, data: { error: e.message } }));
      req.setTimeout(15000, () => { req.destroy(); resolve({ statusCode: 0, data: { error: 'Timeout Resend' } }); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  async sendEmail(to, subject, body, options) {
    options = options || {};
    const html = body.replace(/\n/g, '<br>');
    const payload = {
      from: options.fromName
        ? options.fromName + ' <' + this.senderEmail + '>'
        : 'AutoMailer <' + this.senderEmail + '>',
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
      text: body
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
      const html = e.body.replace(/\n/g, '<br>');
      return {
        from: e.fromName
          ? e.fromName + ' <' + this.senderEmail + '>'
          : 'AutoMailer <' + this.senderEmail + '>',
        to: Array.isArray(e.to) ? e.to : [e.to],
        subject: e.subject,
        html: html,
        text: e.body,
        tags: e.tags || []
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
