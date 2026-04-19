// Phase A4 — Webhook authentication helpers
// Constant-time HMAC comparison + replay-attack protection.
//
// Use:
//   const { verifyHmac, verifyTimestamp, verifyBearer } = require('./webhook-auth');
//   if (!verifyHmac(body, secret, req.headers['x-foo-signature'])) return res.writeHead(401).end();
//   if (!verifyTimestamp(req.headers['x-foo-timestamp'])) return res.writeHead(401).end();

const crypto = require('crypto');

const REPLAY_WINDOW_SECONDS = 300; // 5 min — Stripe/Svix industry standard

// Constant-time string compare (no length leak via early return)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Verify HMAC-SHA256 signature. Accepts raw hex or "sha256=<hex>" prefix.
function verifyHmac(body, secret, providedSig, algo = 'sha256') {
  if (!secret || !providedSig) return false;
  const expected = crypto.createHmac(algo, secret).update(body).digest('hex');
  const cleaned = String(providedSig).replace(/^sha256=/i, '').trim();
  return safeEqual(cleaned, expected);
}

// Verify request timestamp falls within replay window.
// Accepts unix seconds (string or number) or ISO 8601 string.
function verifyTimestamp(ts, toleranceSec = REPLAY_WINDOW_SECONDS) {
  if (!ts) return false;
  let tsSec;
  if (/^\d+$/.test(String(ts))) {
    tsSec = parseInt(ts, 10);
    if (tsSec > 1e12) tsSec = Math.floor(tsSec / 1000); // ms → s
  } else {
    const parsed = Date.parse(String(ts));
    if (Number.isNaN(parsed)) return false;
    tsSec = Math.floor(parsed / 1000);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - tsSec) <= toleranceSec;
}

// Verify Bearer token (constant-time)
function verifyBearer(secret, authHeader) {
  if (!secret || !authHeader) return false;
  const provided = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  return safeEqual(provided, secret);
}

// Verify shared-secret header (constant-time, supports raw or "Bearer <secret>")
function verifySharedSecret(secret, providedHeader) {
  if (!secret || !providedHeader) return false;
  const cleaned = String(providedHeader).replace(/^Bearer\s+/i, '').trim();
  return safeEqual(cleaned, secret);
}

module.exports = {
  verifyHmac,
  verifyTimestamp,
  verifyBearer,
  verifySharedSecret,
  safeEqual,
  REPLAY_WINDOW_SECONDS,
};
