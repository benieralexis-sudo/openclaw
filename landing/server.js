const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const VisitorTracker = require('./tracker.js');

const app = express();
const PORT = process.env.LANDING_PORT || 3080;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

// Trust nginx proxy (pour avoir la vraie IP)
app.set('trust proxy', 1);

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://sc.lfeeder.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://sc.lfeeder.com"],
      connectSrc: ["'self'", "https:", "https://sc.lfeeder.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      scriptSrcAttr: null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
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

// --- /rdv : page booking avec OG propre + redirect vers Cal.eu ---
app.get('/rdv', (req, res) => {
  const bookingUrl = process.env.BOOKING_URL || process.env.GOOGLE_BOOKING_URL || 'https://cal.eu/alexis-benier-sarxqi';
  const clientName = process.env.CLIENT_NAME || 'iFIND';
  // Si c'est un bot/crawler (LinkedIn, Facebook, Twitter) → servir le HTML avec les meta OG
  // Si c'est un humain → redirect direct vers Cal.eu
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = /linkedinbot|facebookexternalhit|twitterbot|slackbot|whatsapp|telegrambot|googlebot|bingbot/i.test(ua);

  if (isBot) {
    res.send(`<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8">
<meta property="og:title" content="${clientName} — Appel d\u00e9couverte 15 min">
<meta property="og:description" content="15 minutes pour voir comment g\u00e9n\u00e9rer 5 \u00e0 15 RDV qualifi\u00e9s par mois. Prospection B2B automatis\u00e9e par IA. Gratuit, sans engagement.">
<meta property="og:image" content="https://${process.env.CLIENT_DOMAIN || 'ifind.fr'}/link-cal.png">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1254">
<meta property="og:type" content="website">
<meta property="og:url" content="https://${process.env.CLIENT_DOMAIN || 'ifind.fr'}/rdv">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://${process.env.CLIENT_DOMAIN || 'ifind.fr'}/link-cal.png">
<title>${clientName} — R\u00e9server un appel</title>
</head><body><p>Redirection...</p><script>window.location.href="${bookingUrl}";</script></body></html>`);
  } else {
    res.redirect(302, bookingUrl);
  }
});

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
  if (!ADMIN_CHAT_ID) return Promise.resolve(null);
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

// --- API: Update prospect status (internal only) ---
app.post('/api/prospect/:id/status', (req, res) => {
  const ip = req.ip || '';
  const isInternal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
    ip.startsWith('172.') || ip.startsWith('::ffff:172.');
  if (!isInternal) return res.status(403).json({ error: 'Acces refuse' });
  const id = req.params.id.replace(/[^a-z0-9]/gi, '');
  const prospect = prospects.get(id);
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  const newStatus = (req.body.status || '').trim();
  if (['pending', 'completed', 'processing'].includes(newStatus)) {
    prospect.status = newStatus;
    if (newStatus === 'completed') prospect.completedAt = new Date().toISOString();
    saveProspect(id, prospect);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Statut invalide' });
  }
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

// --- Envoi email de confirmation via Resend ---
function sendConfirmationEmail(prospect) {
  const resendKey = process.env.RESEND_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  if (!resendKey || !senderEmail || senderEmail === 'onboarding@resend.dev') return Promise.resolve({ success: false });

  const clientName = process.env.CLIENT_NAME || 'iFIND';
  const safePrenom = sanitize(prospect.prenom, 50);
  const prospectLines = (prospect.prospects || '').split('\n').filter(l => l.trim().length > 3);
  const nb = prospectLines.length;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Outfit',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
  <tr><td style="padding:36px 32px 28px;background:#1D4ED8;text-align:center;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:24px;font-weight:800;color:#fff;">${clientName}</span>
  </td></tr>
  <tr><td style="padding:36px 32px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0F172A;">Bonjour ${safePrenom} !</p>
    <p style="margin:0 0 16px;font-size:16px;color:#475569;line-height:1.75;">Votre demande d'audit est bien re&ccedil;ue. Notre &eacute;quipe pr&eacute;pare <strong style="color:#0F172A;">${nb} email${nb > 1 ? 's' : ''} personnalis&eacute;${nb > 1 ? 's' : ''}</strong> pour vos prospects.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0FDF4;border-radius:12px;border:1px solid #BBF7D0;margin:20px 0;">
      <tr><td style="padding:20px;">
        <span style="font-size:14px;font-weight:700;color:#166534;">Ce qui se passe maintenant :</span>
        <table cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
          <tr><td style="padding:4px 0;font-size:14px;color:#15803D;">&#9201; Notre IA analyse chacun de vos prospects</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#15803D;">&#9998; Un email unique est r&eacute;dig&eacute; pour chacun</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#15803D;">&#128232; Vous recevez votre rapport sous 48h</td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.75;">En attendant, si vous avez des questions, r&eacute;pondez directement &agrave; cet email.</p>
  </td></tr>
  <tr><td style="padding:20px 32px;text-align:center;background:#F8FAFC;border-top:1px solid #E2E8F0;">
    <p style="margin:0;font-size:12px;color:#94A3B8;">${clientName} &mdash; Prospection B2B intelligente</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      from: clientName + ' <' + senderEmail + '>',
      to: [prospect.email],
      subject: safePrenom + ', votre audit pipeline est en preparation',
      html: html,
      reply_to: process.env.REPLY_TO_EMAIL || senderEmail
    });
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + resendKey, 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          resolve(res.statusCode < 300 && r.id ? { success: true, id: r.id } : { success: false, error: r.message || 'HTTP ' + res.statusCode });
        } catch (e) { resolve({ success: false, error: 'Parse error' }); }
      });
    });
    req.on('error', e => resolve({ success: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.write(postData);
    req.end();
  });
}

// --- API: Lead request from landing page form ---
app.post('/api/lead-request', async (req, res) => {
  const ip = req.ip || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown';

  // Honeypot check — bots fill hidden fields
  if (req.body.website) {
    console.log('[landing] Honeypot detecte depuis ' + ip);
    return res.json({ success: true, message: 'Demande envoyee avec succes.' });
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
  const entreprise = sanitize(req.body.entreprise, 300);
  const prospectsRaw = sanitize(req.body.prospects, 2000);

  if (!prenom || !email || !prospectsRaw) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  // Valider le format email
  const rawEmail = (req.body.email || '').trim();
  if (!isValidEmail(rawEmail)) {
    return res.status(400).json({ error: 'Email invalide.' });
  }

  // Parser les prospects (1 par ligne)
  const prospectLines = prospectsRaw.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  if (prospectLines.length < 1) {
    return res.status(400).json({ error: 'Ajoutez au moins 1 prospect.' });
  }
  if (prospectLines.length > 5) {
    return res.status(400).json({ error: '5 prospects maximum.' });
  }

  // Generate ID and save prospect (nouveau format avec prospects separes)
  const id = generateId();
  saveProspect(id, { prenom, email, entreprise, prospects: prospectsRaw, status: 'pending' });

  const clientName = process.env.CLIENT_NAME || 'iFIND';
  const message = `\u{1F525} <b>NOUVEL AUDIT — ${clientName}</b>\n\n` +
    `\u{1F464} <b>Prenom :</b> ${prenom}\n` +
    `\u{1F4E7} <b>Email :</b> ${email}\n` +
    (entreprise ? `\u{1F3E2} <b>Entreprise :</b> ${entreprise}\n` : '') +
    `\n<b>\u{1F3AF} ${prospectLines.length} prospect(s) :</b>\n` +
    prospectLines.map((l, i) => `  ${i + 1}. ${l}`).join('\n') +
    `\n\n\u{23F0} ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`;

  const buttons = [[{
    text: '\u{2728} Generer le rapport pour ' + prenom + ' (' + prospectLines.length + ' prospects)',
    callback_data: 'rpt_' + id
  }]];

  try {
    await notifyTelegram(message, buttons);
    console.log(`[landing] Audit ${id}: ${prenom} (${rawEmail}) — ${prospectLines.length} prospects`);

    // Envoi email de confirmation immediat via Resend
    sendConfirmationEmail({ prenom, email: rawEmail, prospects: prospectsRaw })
      .then(r => {
        if (r.success) console.log('[landing] Email confirmation envoye a ' + rawEmail);
        else console.warn('[landing] Email confirmation echoue:', r.error);
      })
      .catch(e => console.warn('[landing] Email confirmation erreur:', e.message));

    res.json({ success: true, message: 'Demande envoyee avec succes.' });
  } catch (err) {
    console.error('[landing] Erreur envoi Telegram:', err.message);
    res.status(500).json({ error: 'Erreur serveur, reessayez.' });
  }
});

// --- Relance auto : rappel Telegram si audit non traite apres 24h ---
setInterval(() => {
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  for (const [id, p] of prospects) {
    if (p.status === 'pending' && p.createdAt) {
      const age = now - new Date(p.createdAt).getTime();
      if (age > TWENTY_FOUR_HOURS && age < TWENTY_FOUR_HOURS + 3600000) {
        // Envoyer rappel Telegram (une seule fois dans la fenetre d'1h)
        const msg = `\u{23F0} <b>RAPPEL — Audit en attente depuis 24h</b>\n\n` +
          `\u{1F464} ${p.prenom} (${p.email})\n` +
          `Le prospect attend son rapport !`;
        const buttons = [[{ text: '\u{2728} Generer maintenant', callback_data: 'rpt_' + id }]];
        notifyTelegram(msg, buttons).catch(() => {});
      }
    }
  }
}, 3600000); // Check toutes les heures

// --- Visitor Tracking ---
const tracker = new VisitorTracker({
  telegramNotify: async (text) => {
    if (!BOT_TOKEN) return;
    await telegramAPI('sendMessage', {
      chat_id: ADMIN_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    });
  }
});
tracker.setupRoutes(app);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${process.env.CLIENT_NAME || 'iFIND'} Landing] Serveur demarre sur le port ${PORT}`);
});
