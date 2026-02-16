// FlowFast - Client API SendGrid
const https = require('https');

class SendGridClient {
  constructor(apiKey, senderEmail) {
    this.apiKey = apiKey;
    this.senderEmail = senderEmail || 'noreply@flowfast.io';
  }

  sendEmail(to, subject, body, senderName) {
    senderName = senderName || 'FlowFast';
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.senderEmail, name: senderName },
        subject: subject,
        content: [
          { type: 'text/plain', value: body },
          { type: 'text/html', value: body.replace(/\n/g, '<br>') }
        ]
      });

      const req = https.request({
        hostname: 'api.sendgrid.com',
        path: '/v3/mail/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          // SendGrid retourne 202 Accepted en cas de succes (body vide)
          if (res.statusCode === 202 || res.statusCode === 200) {
            const messageId = res.headers['x-message-id'] || null;
            resolve({ success: true, messageId: messageId, statusCode: res.statusCode });
          } else {
            let errorMsg = 'SendGrid erreur ' + res.statusCode;
            try {
              const parsed = JSON.parse(data);
              if (parsed.errors && parsed.errors[0]) {
                errorMsg = parsed.errors[0].message;
              }
            } catch (e) {}
            resolve({ success: false, error: errorMsg, statusCode: res.statusCode });
          }
        });
      });
      req.on('error', (e) => {
        console.error('[sendgrid] Erreur reseau:', e.message);
        resolve({ success: false, error: e.message });
      });
      req.setTimeout(15000, () => {
        req.destroy();
        console.error('[sendgrid] Timeout API (15s)');
        resolve({ success: false, error: 'Timeout SendGrid' });
      });
      req.write(postData);
      req.end();
    });
  }
}

module.exports = SendGridClient;
