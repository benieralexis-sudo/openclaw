// iFIND - Verification signature Svix/Resend (HMAC-SHA256) — extrait de telegram-router.js
'use strict';

const crypto = require('crypto');
const log = require('./logger.js');

/**
 * Verifie la signature Svix d'un webhook Resend.
 * @param {Object} headers - req.headers
 * @param {string} body - corps brut de la requete
 * @param {string} webhookSecret - RESEND_WEBHOOK_SECRET
 * @returns {{ valid: boolean, error?: string, statusCode?: number }}
 */
function verifySvixSignature(headers, body, webhookSecret) {
  if (!webhookSecret) {
    log.error('webhook', 'RESEND_WEBHOOK_SECRET non configure — webhook REJETE');
    return { valid: false, error: 'webhook_secret_not_configured', statusCode: 403 };
  }

  const svixId = headers['svix-id'];
  const svixTimestamp = headers['svix-timestamp'];
  const svixSignature = headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) {
    log.warn('webhook', 'Headers Svix absents — webhook rejete (configurez Resend pour envoyer les headers svix-*)');
    return { valid: false, error: 'unauthorized', statusCode: 401 };
  }

  // Verifier le timestamp (tolerance 5 min pour anti-replay)
  const ts = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    log.warn('webhook', 'Timestamp Svix expire (delta: ' + (now - ts) + 's)');
    return { valid: false, error: 'timestamp expired', statusCode: 401 };
  }

  // Calculer le HMAC-SHA256
  const signedContent = svixId + '.' + svixTimestamp + '.' + body;
  let secretBytes;
  if (webhookSecret.startsWith('whsec_')) {
    secretBytes = Buffer.from(webhookSecret.slice(6), 'base64');
  } else {
    secretBytes = Buffer.from(webhookSecret, 'hex');
  }
  const expectedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  // svix-signature contient "v1,<sig1> v1,<sig2> ..." — verifier contre chaque
  const signatures = svixSignature.split(' ').map(s => s.replace('v1,', ''));
  const valid = signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig));
    } catch (e) { return false; }
  });

  if (!valid) {
    log.warn('webhook', 'Signature Svix invalide — webhook rejete');
    return { valid: false, error: 'invalid signature', statusCode: 401 };
  }

  return { valid: true };
}

module.exports = { verifySvixSignature };
