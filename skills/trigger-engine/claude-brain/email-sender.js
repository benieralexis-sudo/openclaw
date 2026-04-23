'use strict';

/**
 * Email sender wrapper pour digest + alertes temps réel.
 * Utilise Resend en priorité (déjà configuré RESEND_API_KEY dans .env).
 * Fallback SMTP si besoin plus tard.
 *
 * Usage :
 *   await sendEmail({ to, subject, html, text, from })
 *   → { ok: bool, id?, error? }
 */

const https = require('node:https');

const DEFAULT_FROM = process.env.DIGEST_SENDER_EMAIL
  || process.env.SENDER_EMAIL
  || 'leads@getifind.fr';
const DEFAULT_FROM_NAME = 'iFIND Leads';

function sendViaResend({ to, subject, html, text, from, fromName }) {
  return new Promise((resolve) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return resolve({ ok: false, error: 'no-resend-key' });

    const fromHeader = `${fromName || DEFAULT_FROM_NAME} <${from || DEFAULT_FROM}>`;
    const body = JSON.stringify({
      from: fromHeader,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || subject
    });

    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, id: parsed.id, status: res.statusCode });
          } else {
            resolve({ ok: false, error: parsed.message || parsed.error || 'resend-error', status: res.statusCode });
          }
        } catch {
          resolve({ ok: false, error: 'parse-error', status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

async function sendEmail(args) {
  return sendViaResend(args);
}

module.exports = { sendEmail, sendViaResend, DEFAULT_FROM, DEFAULT_FROM_NAME };
