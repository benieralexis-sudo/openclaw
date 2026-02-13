const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.LANDING_PORT || 3080;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1409505520';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname)));

// --- Prospect storage (Map + JSON file) ---
const prospects = new Map();
const PROSPECTS_FILE = path.join(__dirname, 'prospects.json');

// Load existing prospects on startup
try {
  const data = JSON.parse(fs.readFileSync(PROSPECTS_FILE, 'utf8'));
  for (const [id, p] of Object.entries(data)) prospects.set(id, p);
  console.log(`[landing] ${prospects.size} prospects charges depuis prospects.json`);
} catch (e) {
  // File doesn't exist yet, that's fine
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function saveProspect(id, data) {
  prospects.set(id, { ...data, id, createdAt: new Date().toISOString() });
  // Save to disk
  const obj = {};
  for (const [k, v] of prospects) obj[k] = v;
  try {
    fs.writeFileSync(PROSPECTS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[landing] Erreur sauvegarde prospects.json:', e.message);
  }
}

// --- Rate limiting (in-memory) ---
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

// --- Telegram API ---
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
    req.on('error', reject);
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
  return str.replace(/[<>&"]/g, '').trim().substring(0, maxLen);
}

// --- API: Get prospect by ID (for inter-container communication) ---
app.get('/api/prospect/:id', (req, res) => {
  const prospect = prospects.get(req.params.id);
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  res.json(prospect);
});

// --- API: Lead request from landing page form ---
app.post('/api/lead-request', async (req, res) => {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Trop de demandes. Reessayez plus tard.' });
  }

  const prenom = sanitize(req.body.prenom, 50);
  const email = sanitize(req.body.email, 100);
  const activite = sanitize(req.body.activite, 200);
  const cible = sanitize(req.body.cible, 200);

  if (!prenom || !email || !activite || !cible) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  // Generate ID and save prospect
  const id = generateId();
  saveProspect(id, { prenom, email, activite, cible });

  const message = `\u{1F525} <b>NOUVEAU PROSPECT — KREST</b>\n\n` +
    `\u{1F464} <b>Prenom :</b> ${prenom}\n` +
    `\u{1F4E7} <b>Email :</b> ${email}\n` +
    `\u{1F3E2} <b>Activite :</b> ${activite}\n` +
    `\u{1F3AF} <b>Cible :</b> ${cible}\n\n` +
    `\u{23F0} ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`;

  const buttons = [[{
    text: '\u{1F4CA} Generer le rapport pour ' + prenom,
    callback_data: 'rpt_' + id
  }]];

  try {
    await sendTelegramWithButton(message, buttons);
    console.log(`[landing] Prospect ${id}: ${prenom} (${email}) — ${activite}`);
    res.json({ success: true, message: 'Demande envoyee avec succes.' });
  } catch (err) {
    console.error('[landing] Erreur Telegram:', err.message);
    res.status(500).json({ error: 'Erreur serveur, reessayez.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Krest Landing] Serveur demarre sur le port ${PORT}`);
});
