const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.LANDING_PORT || 3080;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1409505520';

// Trust nginx proxy (pour avoir la vraie IP)
app.set('trust proxy', 1);

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  // Handled by nginx to avoid duplicates
  strictTransportSecurity: false,
  xFrameOptions: false,
  xContentTypeOptions: false,
  referrerPolicy: false
}));

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// --- CSRF tokens ---
const csrfTokens = new Map();
const CSRF_TTL = 600000; // 10 min

function generateCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, Date.now());
  return token;
}

function validateCsrfToken(token) {
  if (!token || !csrfTokens.has(token)) return false;
  const created = csrfTokens.get(token);
  csrfTokens.delete(token); // One-time use
  return (Date.now() - created) < CSRF_TTL;
}

// Cleanup expired CSRF tokens every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [t, ts] of csrfTokens) {
    if (now - ts > CSRF_TTL) csrfTokens.delete(t);
  }
}, 600000);

// Serve static files with cache headers
app.use(express.static(path.join(__dirname), {
  maxAge: '1h',
  etag: true
}));

// --- Prospect storage (Map + JSON file) ---
const prospects = new Map();
const PROSPECTS_FILE = path.join(__dirname, 'prospects.json');
const MAX_PROSPECTS = 10000;

// Load existing prospects on startup
try {
  const data = JSON.parse(fs.readFileSync(PROSPECTS_FILE, 'utf8'));
  for (const [id, p] of Object.entries(data)) prospects.set(id, p);
  console.log(`[landing] ${prospects.size} prospects charges depuis prospects.json`);
} catch (e) {
  // File doesn't exist yet, that's fine
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// Atomic write pour eviter la corruption
function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function saveProspect(id, data) {
  prospects.set(id, { ...data, id, createdAt: new Date().toISOString() });
  // Limiter la taille de la Map
  if (prospects.size > MAX_PROSPECTS) {
    const oldest = prospects.keys().next().value;
    prospects.delete(oldest);
  }
  // Save to disk (atomic)
  const obj = {};
  for (const [k, v] of prospects) obj[k] = v;
  try {
    atomicWriteSync(PROSPECTS_FILE, obj);
  } catch (e) {
    console.error('[landing] Erreur sauvegarde prospects.json:', e.message);
  }
}

// --- Rate limiting (in-memory with cleanup) ---
const submissions = new Map();
const RATE_LIMIT_WINDOW = 3600000; // 1h
const RATE_LIMIT_MAX = 3;

function isRateLimited(ip) {
  const now = Date.now();
  const record = submissions.get(ip);
  if (!record) {
    submissions.set(ip, { count: 1, firstAt: now });
    return false;
  }
  if (now - record.firstAt > RATE_LIMIT_WINDOW) {
    submissions.set(ip, { count: 1, firstAt: now });
    return false;
  }
  if (record.count >= RATE_LIMIT_MAX) return true;
  record.count++;
  return false;
}

// Cleanup rate limit entries toutes les 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of submissions) {
    if (now - record.firstAt > RATE_LIMIT_WINDOW * 2) submissions.delete(ip);
  }
}, 1800000);

// --- Email validation ---
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidEmail(email) {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

// --- Telegram API (avec timeout) ---
function telegramAPI(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let respBody = '';
      res.on('data', d => respBody += d);
      res.on('end', () => {
        try { resolve(JSON.parse(respBody)); } catch (e) { resolve(respBody); }
      });
    });
    req.on('error', (e) => {
      console.error('[landing] Erreur Telegram:', e.message);
      reject(e);
    });
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout Telegram API'));
    });
    req.write(data);
    req.end();
  });
}

function sendTelegramWithButton(text, buttons) {
  return telegramAPI('sendMessage', {
    chat_id: ADMIN_CHAT_ID,
    text,
    parse_mode: 'HTML',
    reply_markup: JSON.stringify({ inline_keyboard: buttons })
  });
}

// --- Input validation ---
function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
    .substring(0, maxLen);
}

// --- API: Get prospect by ID (internal only — blocked by nginx for external requests) ---
app.get('/api/prospect/:id', (req, res) => {
  // Only allow requests from Docker internal network or localhost
  const ip = req.ip || '';
  const isInternal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
    ip.startsWith('172.') || ip.startsWith('::ffff:172.');
  if (!isInternal) {
    return res.status(403).json({ error: 'Acces refuse' });
  }
  const id = req.params.id.replace(/[^a-z0-9]/gi, '');
  const prospect = prospects.get(id);
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  res.json(prospect);
});

// --- API: CSRF token endpoint ---
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateCsrfToken() });
});

// --- Telegram notification with retry ---
async function notifyTelegram(message, buttons, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      await sendTelegramWithButton(message, buttons);
      return;
    } catch (err) {
      if (i < retries) {
        console.warn(`[landing] Telegram attempt ${i + 1} failed, retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.error('[landing] Telegram notification failed after retries:', err.message);
        throw err;
      }
    }
  }
}

// --- API: Lead request from landing page form ---
app.post('/api/lead-request', async (req, res) => {
  const ip = req.ip || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown';

  // Honeypot check — bots fill hidden fields
  if (req.body.website) {
    console.log('[landing] Honeypot detecte depuis ' + ip);
    return res.json({ success: true, message: 'Demande envoyee avec succes.' }); // Silent reject
  }

  // CSRF validation
  if (!validateCsrfToken(req.body._csrf)) {
    return res.status(403).json({ error: 'Session expirée, veuillez recharger la page.' });
  }

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Trop de demandes. Reessayez plus tard.' });
  }

  const prenom = sanitize(req.body.prenom, 50);
  const email = sanitize(req.body.email, 100);
  const activite = sanitize(req.body.activite, 200); // optionnel (ancien formulaire)
  const cible = sanitize(req.body.cible, 200);

  if (!prenom || !email || !cible) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  // Valider le format email (sur la version non-sanitisee)
  const rawEmail = (req.body.email || '').trim();
  if (!isValidEmail(rawEmail)) {
    return res.status(400).json({ error: 'Email invalide.' });
  }

  // Generate ID and save prospect
  const id = generateId();
  saveProspect(id, { prenom, email, activite, cible });

  const message = `\u{1F525} <b>NOUVEAU PROSPECT — iFIND</b>\n\n` +
    `\u{1F464} <b>Prenom :</b> ${prenom}\n` +
    `\u{1F4E7} <b>Email :</b> ${email}\n` +
    (activite ? `\u{1F3E2} <b>Activite :</b> ${activite}\n` : '') +
    `\u{1F3AF} <b>Cible :</b> ${cible}\n\n` +
    `\u{23F0} ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`;

  const buttons = [[{
    text: '\u{1F4CA} Generer le rapport pour ' + prenom,
    callback_data: 'rpt_' + id
  }]];

  try {
    await notifyTelegram(message, buttons);
    console.log(`[landing] Prospect ${id}: ${prenom} (${rawEmail}) — ${activite}`);
    res.json({ success: true, message: 'Demande envoyee avec succes.' });
  } catch (err) {
    console.error('[landing] Erreur envoi Telegram:', err.message);
    res.status(500).json({ error: 'Erreur serveur, reessayez.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[iFIND Landing] Serveur demarre sur le port ${PORT}`);
});
