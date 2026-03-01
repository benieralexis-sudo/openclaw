const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const http = require('http');
const log = require('../gateway/logger.js');
const clientRegistry = require('./client-registry.js');

const DEFAULT_ROUTER_URL = process.env.ROUTER_URL || 'http://telegram-router:9090';

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;
if (!process.env.DASHBOARD_PASSWORD) {
  console.error('ERREUR FATALE: DASHBOARD_PASSWORD non défini dans les variables d\'environnement');
  console.error('Définissez DASHBOARD_PASSWORD dans votre fichier .env (min 12 caractères)');
  process.exit(1);
}
if (process.env.DASHBOARD_PASSWORD.length < 12) {
  console.error('ERREUR: DASHBOARD_PASSWORD trop court (minimum 12 caractères)');
  process.exit(1);
}
const PASSWORD = process.env.DASHBOARD_PASSWORD;

// Hash du mot de passe au démarrage (fallback pour admin)
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 12);

// --- Multi-users system ---
const USERS_FILE = process.env.DASHBOARD_DATA_DIR
  ? `${process.env.DASHBOARD_DATA_DIR}/users.json`
  : '/data/dashboard/users.json';

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {}
  // Creer l'admin par defaut
  const defaultUsers = {
    admin: {
      username: 'admin',
      passwordHash: PASSWORD_HASH,
      role: 'admin',
      company: null,
      createdAt: new Date().toISOString()
    }
  };
  saveUsers(defaultUsers);
  return defaultUsers;
}

function saveUsers(users) {
  try {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(USERS_FILE, users);
  } catch (e) {
    log.warn('dashboard', 'Erreur sauvegarde users: ' + e.message);
  }
}

const users = loadUsers();
log.info('dashboard', Object.keys(users).length + ' utilisateur(s) charges');

// Trust nginx proxy
app.set('trust proxy', 1);

// Hide X-Powered-By
app.disable('x-powered-by');

// Sessions persistantes
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h
const SESSIONS_FILE = process.env.DASHBOARD_DATA_DIR
  ? `${process.env.DASHBOARD_DATA_DIR}/sessions.json`
  : '/data/dashboard/sessions.json';

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

function saveSessions() {
  try {
    const obj = {};
    for (const [sid, s] of sessions) obj[sid] = s;
    const tmp = SESSIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, encryptSessions(obj));
    fs.renameSync(tmp, SESSIONS_FILE);
  } catch (err) {
    // /data/dashboard might not exist yet
  }
}

// Load sessions from disk (try encrypted first, fallback to plain JSON for migration)
try {
  const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
  let parsed;
  try {
    parsed = decryptSessions(raw);
  } catch (e) {
    // Fallback: old unencrypted format — migrate on next save
    parsed = JSON.parse(raw);
    log.info('dashboard', 'Migration sessions vers format chiffré');
  }
  const now = Date.now();
  for (const [sid, s] of Object.entries(parsed)) {
    if (now - s.createdAt < SESSION_TTL) sessions.set(sid, s);
  }
  if (sessions.size > 0) {
    log.info('dashboard', `${sessions.size} sessions restaurées`);
    saveSessions(); // Re-save encrypted if migrated
  }
} catch (err) {
  // No sessions file yet
}

// Cache données (5s TTL)
const dataCache = new Map();
const CACHE_TTL = 5000;

// Chemins des fichiers de données
const DATA_PATHS = {
  flowfast: process.env.FLOWFAST_DATA_DIR ? `${process.env.FLOWFAST_DATA_DIR}/flowfast-db.json` : '/data/flowfast/flowfast-db.json',
  automailer: process.env.AUTOMAILER_DATA_DIR ? `${process.env.AUTOMAILER_DATA_DIR}/automailer-db.json` : '/data/automailer/automailer-db.json',
  'crm-pilot': process.env.CRM_PILOT_DATA_DIR ? `${process.env.CRM_PILOT_DATA_DIR}/crm-pilot-db.json` : '/data/crm-pilot/crm-pilot-db.json',
  'lead-enrich': process.env.LEAD_ENRICH_DATA_DIR ? `${process.env.LEAD_ENRICH_DATA_DIR}/lead-enrich-db.json` : '/data/lead-enrich/lead-enrich-db.json',
  'invoice-bot': process.env.INVOICE_BOT_DATA_DIR ? `${process.env.INVOICE_BOT_DATA_DIR}/invoice-bot-db.json` : '/data/invoice-bot/invoice-bot-db.json',
  'proactive-agent': process.env.PROACTIVE_DATA_DIR ? `${process.env.PROACTIVE_DATA_DIR}/proactive-agent-db.json` : '/data/proactive-agent/proactive-agent-db.json',
  'self-improve': process.env.SELF_IMPROVE_DATA_DIR ? `${process.env.SELF_IMPROVE_DATA_DIR}/self-improve-db.json` : '/data/self-improve/self-improve-db.json',
  'web-intelligence': process.env.WEB_INTEL_DATA_DIR ? `${process.env.WEB_INTEL_DATA_DIR}/web-intelligence.json` : '/data/web-intelligence/web-intelligence.json',
  'system-advisor': process.env.SYSTEM_ADVISOR_DATA_DIR ? `${process.env.SYSTEM_ADVISOR_DATA_DIR}/system-advisor.json` : '/data/system-advisor/system-advisor.json',
  'inbox-manager': process.env.INBOX_MANAGER_DATA_DIR ? `${process.env.INBOX_MANAGER_DATA_DIR}/inbox-manager-db.json` : '/data/inbox-manager/inbox-manager-db.json',
  'meeting-scheduler': process.env.MEETING_SCHEDULER_DATA_DIR ? `${process.env.MEETING_SCHEDULER_DATA_DIR}/meeting-scheduler-db.json` : '/data/meeting-scheduler/meeting-scheduler-db.json',
  'autonomous-pilot': process.env.AUTONOMOUS_PILOT_DATA_DIR ? `${process.env.AUTONOMOUS_PILOT_DATA_DIR}/autonomous-pilot.json` : '/data/autonomous-pilot/autonomous-pilot.json'
};

const APP_CONFIG_PATH = process.env.APP_CONFIG_DIR
  ? `${process.env.APP_CONFIG_DIR}/app-config.json`
  : process.env.MOLTBOT_CONFIG_DIR
    ? `${process.env.MOLTBOT_CONFIG_DIR}/app-config.json`
    : '/data/app-config/app-config.json';

// Security headers (HSTS, X-Frame-Options, X-Content-Type-Options handled by nginx)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// --- Rate limiting global /api/* ---
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Trop de requêtes. Réessayez dans 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// --- Session encryption ---
// Secret auto-genere au premier demarrage, persiste sur disque (plus de fallback hardcode)
function _getOrCreateSessionSecret() {
  const secretFile = path.join(process.env.DASHBOARD_DATA_DIR || '/data/dashboard', '.session-secret');
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  } catch (e) {}
  const generated = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(secretFile, generated, { mode: 0o600 }); } catch (e) {
    log.warn('dashboard', 'Impossible de persister session secret — genere en memoire');
  }
  return generated;
}
const SESSION_KEY = crypto.createHash('sha256')
  .update(PASSWORD + _getOrCreateSessionSecret())
  .digest();

function encryptSessions(data) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), data: encrypted, tag: authTag });
}

function decryptSessions(raw) {
  const { iv, data, tag } = JSON.parse(raw);
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// --- Audit log (persistant sur disque) ---
const auditLog = [];
const MAX_AUDIT_ENTRIES = 500;
const AUDIT_FILE = process.env.DASHBOARD_DATA_DIR
  ? `${process.env.DASHBOARD_DATA_DIR}/audit.ndjson`
  : '/data/dashboard/audit.ndjson';

function logAudit(action, ip, details) {
  const entry = { action, ip, details, at: new Date().toISOString() };
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  // Persistance asynchrone (append NDJSON)
  fsp.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n').catch(() => {});
}

async function loadAuditFromDisk() {
  try {
    const raw = await fsp.readFile(AUDIT_FILE, 'utf8');
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// --- Auth middleware ---
function authRequired(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid || !sessions.has(sid)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non autorisé' });
    return res.redirect('/login');
  }
  const session = sessions.get(sid);
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(sid);
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expirée' });
    return res.redirect('/login');
  }
  // Attacher l'info utilisateur a la requete
  req.user = {
    username: session.username || 'admin',
    role: session.role || 'admin',
    company: session.company || null,
    clientId: session.clientId || null
  };
  // Audit log pour les requêtes API
  if (req.path.startsWith('/api/')) {
    logAudit('api_request', req.ip || 'unknown', req.user.username + ' ' + req.path);
  }
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

// --- Multi-tenant client resolution ---
function resolveClient(req, res, next) {
  if (req.user.role === 'client') {
    // Client users are locked to their own clientId
    req.clientId = req.user.clientId || null;
  } else if (req.user.role === 'admin' && req.query.clientId) {
    // Admin can switch context via ?clientId=
    req.clientId = req.query.clientId;
  } else {
    req.clientId = null; // Admin default = main router
  }
  next();
}

// --- Rate limiting sur /login ---
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de connexion. Reessayez dans 1 minute.',
  standardHeaders: true,
  legacyHeaders: false
});

// --- Login routes ---
app.get('/login', (req, res) => {
  const csrfToken = generateCsrfToken();
  res.send(loginPage(null, csrfToken));
});

app.post('/login', loginLimiter, async (req, res) => {
  if (!validateCsrfToken(req.body._csrf)) {
    log.warn('dashboard', 'CSRF invalide from ' + (req.ip || 'unknown'));
    const csrfToken = generateCsrfToken();
    return res.send(loginPage('Session expirée, veuillez réessayer.', csrfToken));
  }

  const inputUser = (req.body.username || 'admin').trim().toLowerCase();
  const inputPass = req.body.password || '';

  // Chercher l'utilisateur
  const user = users[inputUser];
  let match = false;

  if (user) {
    match = await bcrypt.compare(inputPass, user.passwordHash);
  } else if (inputUser === 'admin') {
    // Fallback : ancien mot de passe unique (compatibilite)
    match = await bcrypt.compare(inputPass, PASSWORD_HASH);
  }

  if (match) {
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, {
      createdAt: Date.now(),
      username: user ? user.username : 'admin',
      role: user ? user.role : 'admin',
      company: user ? user.company : null,
      clientId: user ? (user.clientId || null) : null
    });
    saveSessions();
    res.cookie('sid', sid, { httpOnly: true, maxAge: SESSION_TTL, sameSite: 'lax', secure: true });
    logAudit('login_success', req.ip || 'unknown', (user ? user.username : 'admin') + ' (' + (user ? user.role : 'admin') + ')');
    log.info('dashboard', 'Login OK: ' + (user ? user.username : 'admin') + ' from ' + (req.ip || 'unknown'));
    return res.redirect('/');
  }

  logAudit('login_failed', req.ip || 'unknown', 'Utilisateur: ' + inputUser);
  log.warn('dashboard', 'Login FAIL: ' + inputUser + ' from ' + (req.ip || 'unknown'));
  const csrfToken = generateCsrfToken();
  res.send(loginPage('Identifiants incorrects', csrfToken));
});

app.get('/logout', (req, res) => {
  const sid = req.cookies.sid;
  if (sid) { sessions.delete(sid); saveSessions(); }
  res.clearCookie('sid');
  res.redirect('/login');
});

// --- Public static (no auth needed) ---
app.get('/public/js/login.js', (req, res) => {
  res.type('application/javascript').send(`document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('toggle-pw'),p=document.getElementById('password');if(!b||!p)return;b.addEventListener('click',function(){var show=p.type==='password';p.type=show?'text':'password';b.innerHTML=show?'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';});});`);
});

// --- Static files ---
app.use('/public', authRequired, express.static(path.join(__dirname, 'public')));

// --- Data reading helper (async I/O) ---
async function readData(skill, clientId) {
  const cacheKey = clientId ? clientId + ':' + skill : skill;
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  let filePath;
  if (clientId) {
    const clientPaths = clientRegistry.getClientDataPaths(clientId);
    filePath = clientPaths ? clientPaths[skill] : null;
  } else {
    filePath = DATA_PATHS[skill];
  }
  if (!filePath) return null;

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    dataCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

async function readAllData(clientId) {
  const skills = Object.keys(DATA_PATHS);
  const results = await Promise.all(skills.map(skill => readData(skill, clientId)));
  const result = {};
  skills.forEach((skill, i) => { result[skill] = results[i]; });
  return result;
}

// --- Client data filter helper ---
function filterByCompany(items, user, companyField) {
  if (!user || user.role === 'admin' || !user.company) return items;
  const company = user.company.toLowerCase();
  return items.filter(item => {
    const val = (item[companyField || 'company'] || item.entreprise || '').toLowerCase();
    return val.includes(company) || company.includes(val);
  });
}

// --- Pagination helper ---
function paginate(arr, req) {
  if (!Array.isArray(arr)) return { items: arr, total: 0 };
  const total = arr.length;
  const limit = req.query.limit != null ? Math.min(parseInt(req.query.limit) || 50, 500) : null;
  const offset = parseInt(req.query.offset) || 0;
  if (limit != null) {
    return { items: arr.slice(offset, offset + limit), total };
  }
  return { items: arr, total };
}

// --- API Routes ---

// Info session courante
app.get('/api/me', authRequired, (req, res) => {
  const response = { username: req.user.username, role: req.user.role, company: req.user.company };
  if (req.user.clientId) {
    response.clientId = req.user.clientId;
    const client = clientRegistry.getClient(req.user.clientId);
    response.onboardingDone = client ? !!client.onboarding.completed : false;
    response.clientName = client ? client.name : null;
  }
  res.json(response);
});

// --- Gestion utilisateurs (admin only) ---
app.get('/api/users', authRequired, adminRequired, (req, res) => {
  const list = Object.values(users).map(u => ({
    username: u.username,
    role: u.role,
    company: u.company,
    clientId: u.clientId || null,
    createdAt: u.createdAt
  }));
  res.json({ users: list });
});

app.post('/api/users', authRequired, adminRequired, async (req, res) => {
  const { username, password, role, company, clientId } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username et password requis' });
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(uname)) return res.status(400).json({ error: 'Username invalide (2-30 chars, a-z0-9_-)' });
  if (users[uname]) return res.status(409).json({ error: 'Utilisateur existe deja' });
  if (password.length < 12) return res.status(400).json({ error: 'Mot de passe trop court (min 12 caractères)' });
  const validRole = (role === 'client') ? 'client' : 'admin';

  // Validate clientId if provided for client role
  if (validRole === 'client' && clientId) {
    const client = clientRegistry.getClient(clientId);
    if (!client) return res.status(400).json({ error: 'Client "' + clientId + '" introuvable' });
  }

  users[uname] = {
    username: uname,
    passwordHash: await bcrypt.hash(password, 12),
    role: validRole,
    company: validRole === 'client' ? (company || null) : null,
    clientId: validRole === 'client' ? (clientId || null) : null,
    createdAt: new Date().toISOString()
  };
  saveUsers(users);
  logAudit('user_created', req.ip, uname + ' (' + validRole + ')');
  log.info('dashboard', 'Utilisateur cree: ' + uname + ' (' + validRole + ')');
  res.json({ success: true, username: uname, role: validRole });
});

app.delete('/api/users/:username', authRequired, adminRequired, (req, res) => {
  const uname = req.params.username.toLowerCase();
  if (uname === 'admin') return res.status(400).json({ error: 'Impossible de supprimer admin' });
  if (!users[uname]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  delete users[uname];
  saveUsers(users);
  // Invalider ses sessions
  for (const [sid, s] of sessions) {
    if (s.username === uname) sessions.delete(sid);
  }
  saveSessions();
  logAudit('user_deleted', req.ip, uname);
  log.info('dashboard', 'Utilisateur supprime: ' + uname);
  res.json({ success: true });
});

// --- Changement de mot de passe ---
app.post('/api/me/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
  if (newPassword.length < 12) return res.status(400).json({ error: 'Nouveau mot de passe trop court (min 12 caractères)' });

  const user = users[req.user.username];
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  saveUsers(users);
  logAudit('password_changed', req.ip || 'unknown', req.user.username);
  log.info('dashboard', 'Mot de passe changé: ' + req.user.username);
  res.json({ success: true });
});

// --- Onboarding Wizard (client users) ---

app.get('/api/onboarding', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const client = clientRegistry.getClient(req.clientId);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  res.json({
    completed: client.onboarding.completed,
    steps: client.onboarding.steps,
    config: client.config,
    icp: client.icp || {},
    tone: client.tone || {}
  });
});

app.post('/api/onboarding/company', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const { name, domain, description, senderName, senderFullName, senderTitle, senderEmail } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Nom et domaine requis' });

  try {
    clientRegistry.updateClient(req.clientId, {
      name: name,
      config: {
        clientDomain: domain,
        clientDescription: description || '',
        senderName: senderName || '',
        senderFullName: senderFullName || '',
        senderTitle: senderTitle || 'Fondateur',
        senderEmail: senderEmail || '',
        replyToEmail: senderEmail || ''
      },
      onboarding: { steps: { company: new Date().toISOString() } }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/onboarding/icp', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const { industries, titles, companySizes, geography } = req.body;

  try {
    clientRegistry.updateClient(req.clientId, {
      icp: {
        industries: industries || [],
        titles: titles || [],
        companySizes: companySizes || [],
        geography: geography || []
      },
      onboarding: { steps: { icp: new Date().toISOString() } }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/onboarding/tone', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const { formality, valueProposition, forbiddenWords } = req.body;

  try {
    clientRegistry.updateClient(req.clientId, {
      tone: {
        formality: formality || 'decontracte',
        valueProposition: valueProposition || '',
        forbiddenWords: forbiddenWords || []
      },
      onboarding: { steps: { tone: new Date().toISOString() } }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/onboarding/integrations', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const { hubspotApiKey, calcomApiKey, calcomUsername, imapHost, imapUser, imapPass } = req.body;

  try {
    clientRegistry.updateClient(req.clientId, {
      config: {
        hubspotApiKey: hubspotApiKey || '',
        calcomApiKey: calcomApiKey || '',
        calcomUsername: calcomUsername || '',
        imapHost: imapHost || '',
        imapUser: imapUser || '',
        imapPass: imapPass || ''
      },
      onboarding: { steps: { integrations: new Date().toISOString() } }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/onboarding/complete', authRequired, resolveClient, async (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });

  try {
    const client = clientRegistry.getClient(req.clientId);
    if (!client) return res.status(404).json({ error: 'Client introuvable' });

    // Mark onboarding complete
    clientRegistry.updateClient(req.clientId, {
      onboarding: { completed: true }
    });

    // Regenerate .env and docker-compose
    clientRegistry.generateClientEnv(req.clientId, client.config);
    clientRegistry.generateDockerCompose();

    logAudit('onboarding_completed', req.ip || 'unknown', req.clientId);
    log.info('dashboard', 'Onboarding complete: ' + req.clientId);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Audit log (admin only) ---
app.get('/api/audit', authRequired, adminRequired, async (req, res) => {
  try {
    const logs = await loadAuditFromDisk();
    const { items, total } = paginate(logs.reverse(), req);
    res.json({ logs: items, total });
  } catch (e) {
    res.json({ logs: [], total: 0 });
  }
});

app.get('/api/audit/export', authRequired, adminRequired, async (req, res) => {
  try {
    const logs = await loadAuditFromDisk();
    const csv = ['Action,IP,Details,Timestamp',
      ...logs.map(l => `"${(l.action || '').replace(/"/g, '""')}","${(l.ip || '').replace(/"/g, '""')}","${(l.details || '').replace(/"/g, '""')}","${l.at}"`)
    ].join('\n');
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="audit-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: 'Export échoué' });
  }
});

// Overview / KPIs globaux
app.get('/api/overview', authRequired, resolveClient, async (req, res) => {
  const all = await readAllData(req.clientId);
  const period = req.query.period || '30d';
  const now = Date.now();
  const periodMs = period === '1d' ? 86400000 : period === '7d' ? 604800000 : 2592000000;
  const cutoff = new Date(now - periodMs).toISOString();
  const prevCutoff = new Date(now - periodMs * 2).toISOString();

  // Leads (filtre par entreprise pour les clients)
  const ff = all.flowfast || {};
  const leads = filterByCompany(ff.leads ? Object.values(ff.leads) : [], req.user, 'entreprise');
  const leadsInPeriod = leads.filter(l => l.createdAt >= cutoff).length;
  const leadsPrev = leads.filter(l => l.createdAt >= prevCutoff && l.createdAt < cutoff).length;

  // Emails (filtre par entreprise pour les clients)
  const am = all.automailer || {};
  const emails = filterByCompany(am.emails || [], req.user, 'company');
  const emailsInPeriod = emails.filter(e => e.createdAt >= cutoff).length;
  const emailsPrev = emails.filter(e => e.createdAt >= prevCutoff && e.createdAt < cutoff).length;
  const opened = emails.filter(e => e.createdAt >= cutoff && e.openedAt).length;
  const openRate = emailsInPeriod > 0 ? Math.round((opened / emailsInPeriod) * 100) : 0;
  const openedPrev = emails.filter(e => e.createdAt >= prevCutoff && e.createdAt < cutoff && e.openedAt).length;
  const openRatePrev = emailsPrev > 0 ? Math.round((openedPrev / emailsPrev) * 100) : 0;

  // Revenue (admin only)
  const isAdmin = req.user.role === 'admin';
  const inv = all['invoice-bot'] || {};
  const invoices = isAdmin ? (inv.invoices ? Object.values(inv.invoices) : []) : [];
  const paidInPeriod = invoices.filter(i => i.paidAt && i.paidAt >= cutoff).reduce((s, i) => s + (i.total || 0), 0);
  const paidPrev = invoices.filter(i => i.paidAt && i.paidAt >= prevCutoff && i.paidAt < cutoff).reduce((s, i) => s + (i.total || 0), 0);

  // Hot leads
  const pa = all['proactive-agent'] || {};
  let hotLeads = pa.hotLeads ? Object.entries(pa.hotLeads).map(([email, data]) => ({
    email,
    ...data,
    // Enrich from lead-enrich
    ...(all['lead-enrich']?.enrichedLeads?.[email.toLowerCase()] || {})
  })).filter(l => l.opens >= 3).slice(0, 10) : [];
  if (!isAdmin) hotLeads = []; // Clients ne voient pas les hot leads

  // Activity feed (48h)
  const feed = buildActivityFeed(all, now - 172800000);

  // Charts: adapter au filtre de periode
  const chartDays = period === '1d' ? 1 : period === '7d' ? 7 : 30;
  const chartData = buildChartData(all, chartDays);

  // Next actions
  const nextActions = buildNextActions(all);

  // iFIND status
  let appStatus = { mode: 'unknown', cronsActive: false };
  try {
    const raw = await fsp.readFile(APP_CONFIG_PATH, 'utf8');
    appStatus = JSON.parse(raw);
  } catch (e) {}

  res.json({
    ownerName: process.env.DASHBOARD_OWNER || '',
    clientName: process.env.CLIENT_NAME || 'iFIND',
    appStatus,
    kpis: {
      leads: { value: leadsInPeriod, total: leads.length, change: calcChange(leadsInPeriod, leadsPrev) },
      emails: { value: emailsInPeriod, total: emails.length, change: calcChange(emailsInPeriod, emailsPrev) },
      openRate: { value: openRate, change: openRate - openRatePrev },
      revenue: { value: paidInPeriod, change: calcChange(paidInPeriod, paidPrev) }
    },
    hotLeads,
    feed: feed.slice(0, 20),
    chartData,
    nextActions
  });
});

// Prospection (FlowFast + Autonomous Pilot)
app.get('/api/prospection', authRequired, resolveClient, async (req, res) => {
  const [ff, le, ap] = await Promise.all([readData('flowfast', req.clientId), readData('lead-enrich', req.clientId), readData('autonomous-pilot', req.clientId)]);
  const ffData = ff || {};
  const leData = le || {};
  const apData = ap || {};
  const leads = ffData.leads ? Object.values(ffData.leads).map(l => ({ ...l, source: l.source || 'flowfast' })) : [];
  const enriched = leData.enrichedLeads || {};

  // Ajouter les leads du Autonomous Pilot (prospect research cache)
  const knownEmails = new Set(leads.map(l => (l.email || '').toLowerCase()).filter(Boolean));
  if (apData.prospectResearch) {
    for (const [email, research] of Object.entries(apData.prospectResearch)) {
      if (knownEmails.has(email.toLowerCase())) continue;
      leads.push({
        email: email,
        nom: '',
        entreprise: research.company || '',
        score: research.leadEnrichData?.score || null,
        source: 'brain',
        createdAt: research.researchedAt || null
      });
    }
  }

  // Enrichir les leads avec les données lead-enrich
  const enrichedLeads = leads.map(l => {
    const e = enriched[(l.email || '').toLowerCase()] || {};
    return {
      ...l,
      aiClassification: e.aiClassification || null,
      apolloData: e.apolloData || null
    };
  });

  const searches = ffData.searches || [];
  const stats = ffData.stats || {};

  // Leads par jour (30 jours)
  const dailyLeads = buildDailyCount(leads, 'createdAt', 30);

  // Pagination optionnelle sur les leads enrichis
  const { items: paginatedLeads, total: totalLeads } = paginate(enrichedLeads, req);

  res.json({
    leads: paginatedLeads,
    total: totalLeads,
    searches,
    stats: {
      total: leads.length,
      fromBrain: leads.filter(l => l.source === 'brain').length,
      qualified: leads.filter(l => (l.score || 0) >= 6).length,
      avgScore: leads.length > 0 ? Math.round(leads.reduce((s, l) => s + (l.score || 0), 0) / leads.length * 10) / 10 : 0,
      pushedToHubspot: leads.filter(l => l.pushedToHubspot).length,
      ...stats
    },
    dailyLeads
  });
});

// AutoMailer / Emails
app.get('/api/emails', authRequired, resolveClient, async (req, res) => {
  const am = await readData('automailer', req.clientId) || {};
  const emails = am.emails || [];
  const campaigns = am.campaigns ? Object.values(am.campaigns) : [];
  const contactLists = am.contactLists ? Object.values(am.contactLists) : [];
  const stats = am.stats || {};

  const sent = emails.filter(e => ['sent', 'delivered', 'opened', 'clicked'].includes(e.status) || e.openedAt).length;
  const delivered = emails.filter(e => ['delivered', 'opened', 'clicked'].includes(e.status) || e.openedAt).length;
  const opened = emails.filter(e => e.openedAt).length;
  const bounced = emails.filter(e => e.status === 'bounced').length;

  const dailyOpenRate = buildDailyRate(emails, 'createdAt', 'opened', 30);

  // Top emails par ouverture
  const topEmails = emails
    .filter(e => e.openedAt)
    .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))
    .slice(0, 5);

  // Filtrer par entreprise pour les clients + pagination optionnelle
  const filteredEmails = filterByCompany(emails, req.user, 'company');
  const { items: paginatedEmails, total: totalEmails } = paginate(filteredEmails, req);

  res.json({
    stats: {
      sent,
      delivered,
      opened,
      bounced,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
      totalCampaigns: campaigns.length,
      totalContacts: contactLists.reduce((s, cl) => s + (cl.contacts?.length || 0), 0),
      ...stats
    },
    campaigns,
    contactLists,
    emails: paginatedEmails,
    totalEmails,
    dailyOpenRate,
    topEmails
  });
});

// CRM Pilot — avec fallback direct HubSpot si cache vide
const HUBSPOT_TOKEN = process.env.HUBSPOT_API_KEY || '';
const HUBSPOT_DEAL_PROPS = 'dealname,dealstage,pipeline,amount,closedate,createdate,hs_lastmodifieddate';
const HUBSPOT_CONTACT_PROPS = 'firstname,lastname,email,company,phone,createdate,hs_lastmodifieddate';

let _hubspotCache = { deals: null, contacts: null, pipeline: null, ts: 0 };
const HUBSPOT_CACHE_TTL = 5 * 60 * 1000; // 5min

async function fetchHubSpotDirect() {
  if (!HUBSPOT_TOKEN) return { deals: [], contacts: [], pipeline: null };
  if (_hubspotCache.ts && Date.now() - _hubspotCache.ts < HUBSPOT_CACHE_TTL) {
    return _hubspotCache;
  }
  const headers = { Authorization: 'Bearer ' + HUBSPOT_TOKEN };
  const base = 'https://api.hubapi.com';
  try {
    const [dealsRes, contactsRes, pipelineRes] = await Promise.all([
      fetch(base + '/crm/v3/objects/deals?limit=100&properties=' + HUBSPOT_DEAL_PROPS, { headers }).then(r => r.json()).catch(() => ({})),
      fetch(base + '/crm/v3/objects/contacts?limit=100&properties=' + HUBSPOT_CONTACT_PROPS, { headers }).then(r => r.json()).catch(() => ({})),
      fetch(base + '/crm/v3/pipelines/deals/default', { headers }).then(r => r.json()).catch(() => null)
    ]);
    const deals = (dealsRes.results || []).map(d => ({
      id: d.id,
      properties: {
        dealname: d.properties?.dealname || '',
        dealstage: d.properties?.dealstage || '',
        pipeline: d.properties?.pipeline || 'default',
        amount: parseFloat(d.properties?.amount) || 0,
        company: d.properties?.company || '',
        createdAt: d.properties?.createdate || d.createdAt,
        updatedAt: d.properties?.hs_lastmodifieddate
      }
    }));
    const contacts = (contactsRes.results || []).map(c => ({
      id: c.id,
      properties: {
        firstname: c.properties?.firstname || '',
        lastname: c.properties?.lastname || '',
        email: c.properties?.email || '',
        company: c.properties?.company || '',
        phone: c.properties?.phone || '',
        createdAt: c.properties?.createdate || c.createdAt
      }
    }));
    _hubspotCache = { deals, contacts, pipeline: pipelineRes, ts: Date.now() };
    return _hubspotCache;
  } catch (e) {
    log.warn('dashboard', 'HubSpot fetch failed: ' + e.message);
    return { deals: [], contacts: [], pipeline: null };
  }
}

app.get('/api/crm', authRequired, resolveClient, async (req, res) => {
  const crm = await readData('crm-pilot', req.clientId) || {};
  const activityLog = (crm.activityLog || []).slice(-100);
  const stats = crm.stats || {};

  // Pipeline data from skill cache
  let allDeals = crm.cache?.deals ? Object.values(crm.cache.deals).flatMap(c => c.data || []) : [];
  let allContacts = crm.cache?.contacts ? Object.values(crm.cache.contacts).flatMap(c => c.data || []) : [];
  let pipeline = crm.cache?.pipeline?.data || null;

  // Fallback : appel direct HubSpot si cache skill vide
  if (allDeals.length === 0 && HUBSPOT_TOKEN) {
    const hs = await fetchHubSpotDirect();
    allDeals = hs.deals;
    allContacts = hs.contacts;
    pipeline = hs.pipeline;
  }

  // Filtrer par entreprise pour les clients
  const deals = filterByCompany(allDeals, req.user, 'company');
  const contacts = filterByCompany(allContacts, req.user, 'company');

  // Pagination optionnelle sur contacts et deals
  const { items: paginatedContacts, total: totalContacts } = paginate(contacts, req);
  const { items: paginatedDeals, total: totalDeals } = paginate(deals, req);

  res.json({
    stats: {
      totalActions: stats.totalActions || 0,
      contactsCreated: stats.totalContactsCreated || contacts.length,
      dealsCreated: stats.totalDealsCreated || deals.length,
      notesAdded: stats.totalNotesAdded || 0,
      tasksCreated: stats.totalTasksCreated || 0
    },
    pipeline,
    deals: paginatedDeals,
    totalDeals,
    contacts: paginatedContacts,
    totalContacts,
    activityLog
  });
});

// Lead Enrich
app.get('/api/enrichment', authRequired, resolveClient, async (req, res) => {
  const le = await readData('lead-enrich', req.clientId) || {};
  const enriched = le.enrichedLeads ? Object.values(le.enrichedLeads) : [];
  const apollo = le.enrichUsage || le.apolloUsage || { creditsUsed: 0, provider: 'fullenrich' };
  const stats = le.stats || {};
  const activityLog = (le.activityLog || []).slice(-50);

  // Pagination optionnelle sur les leads enrichis
  const { items: paginatedEnriched, total: totalEnriched } = paginate(enriched.slice(-100), req);

  res.json({
    stats: {
      total: enriched.length,
      avgScore: enriched.length > 0 ? Math.round(enriched.reduce((s, e) => s + (e.aiClassification?.score || 0), 0) / enriched.length * 10) / 10 : 0,
      ...stats
    },
    apollo,
    enriched: paginatedEnriched,
    totalEnriched,
    activityLog
  });
});

// Invoice Bot (admin only)
app.get('/api/invoices', authRequired, adminRequired, resolveClient, async (req, res) => {
  const inv = await readData('invoice-bot', req.clientId) || {};
  const invoices = inv.invoices ? Object.values(inv.invoices) : [];
  const clients = inv.clients ? Object.values(inv.clients) : [];
  const stats = inv.stats || {};

  // Revenue par mois
  const monthlyRevenue = {};
  invoices.forEach(i => {
    if (i.paidAt) {
      const month = i.paidAt.substring(0, 7);
      monthlyRevenue[month] = (monthlyRevenue[month] || 0) + (i.total || 0);
    }
  });

  const paid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
  const pending = invoices.filter(i => ['draft', 'sent'].includes(i.status)).reduce((s, i) => s + (i.total || 0), 0);
  const overdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0);

  const sortedInvoices = invoices.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const { items: paginatedInvoices, total: totalInvoices } = paginate(sortedInvoices, req);

  res.json({
    stats: {
      totalInvoices: invoices.length,
      paid,
      pending,
      overdue,
      totalClients: clients.length,
      ...stats
    },
    invoices: paginatedInvoices,
    totalInvoices,
    clients,
    monthlyRevenue
  });
});

// Proactive Agent
app.get('/api/proactive', authRequired, resolveClient, async (req, res) => {
  const pa = await readData('proactive-agent', req.clientId) || {};
  const config = pa.config || {};
  const alerts = (pa.alertHistory || []).slice(-50);
  const hotLeads = pa.hotLeads ? Object.entries(pa.hotLeads).map(([email, d]) => ({ email, ...d })) : [];
  const stats = pa.stats || {};
  const briefing = pa.nightlyBriefing || null;
  const snapshots = pa.metrics?.dailySnapshots || [];

  res.json({
    config,
    stats,
    alerts,
    hotLeads,
    briefing,
    snapshots: snapshots.slice(-30)
  });
});

// Self-Improve (admin only)
app.get('/api/self-improve', authRequired, adminRequired, resolveClient, async (req, res) => {
  const si = await readData('self-improve', req.clientId) || {};
  const config = si.config || {};
  const analysis = si.analysis || {};
  const feedback = si.feedback || {};
  const stats = si.stats || {};
  const backups = (si.backups || []).slice(-10);

  res.json({
    config,
    stats,
    lastAnalysis: analysis.lastAnalysis || null,
    pendingRecommendations: analysis.pendingRecommendations || [],
    appliedRecommendations: analysis.appliedRecommendations || [],
    accuracyHistory: feedback.accuracyHistory || [],
    predictions: (feedback.predictions || []).slice(-20),
    backups
  });
});

// Web Intelligence
app.get('/api/web-intelligence', authRequired, resolveClient, async (req, res) => {
  const wi = await readData('web-intelligence', req.clientId) || {};
  const watches = wi.watches ? Object.values(wi.watches) : [];
  const articles = (wi.articles || []).slice(-100);
  const analyses = (wi.analyses || []).slice(-20);
  const stats = wi.stats || {};

  const sortedArticles = articles.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));
  const { items: paginatedArticles, total: totalArticles } = paginate(sortedArticles, req);

  res.json({
    config: wi.config || {},
    stats,
    watches,
    articles: paginatedArticles,
    totalArticles,
    analyses
  });
});

// System Advisor (admin only)
app.get('/api/system', authRequired, adminRequired, resolveClient, async (req, res) => {
  const sa = await readData('system-advisor', req.clientId) || {};
  const config = sa.config || {};
  const systemMetrics = sa.systemMetrics || {};
  const skillMetrics = sa.skillMetrics || {};
  const healthChecks = sa.healthChecks || {};
  const activeAlerts = sa.activeAlerts || [];
  const alertHistory = (sa.alertHistory || []).slice(-50);
  const stats = sa.stats || {};

  // Dernier snapshot
  const snapshots = systemMetrics.snapshots || [];
  const lastSnapshot = snapshots[snapshots.length - 1] || null;

  // 24h de snapshots pour charts
  const now = Date.now();
  const recentSnapshots = snapshots.filter(s => new Date(s.timestamp).getTime() > now - 86400000);

  res.json({
    config,
    stats,
    lastSnapshot,
    recentSnapshots,
    hourlyAggregates: (systemMetrics.hourlyAggregates || []).slice(-24),
    skillUsage: skillMetrics.usage || {},
    responseTimes: skillMetrics.responseTimes || {},
    errors: skillMetrics.errors || {},
    cronExecutions: (skillMetrics.cronExecutions || []).slice(-50),
    healthChecks: (healthChecks.history || []).slice(-24),
    lastHealthCheck: healthChecks.lastCheck || null,
    activeAlerts,
    alertHistory
  });
});

// Chat API — proxy vers telegram-router
app.post('/api/chat', authRequired, resolveClient, async (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message || message.length > 2000) {
    return res.status(400).json({ error: 'message requis (max 2000 chars)' });
  }
  const userId = req.user?.username || 'admin';
  try {
    const routerUrl = req.clientId ? clientRegistry.getClientRouterUrl(req.clientId) : DEFAULT_ROUTER_URL;
    const parsedUrl = new URL(routerUrl);
    const ROUTER_HOST = parsedUrl.hostname;
    const ROUTER_PORT = parseInt(parsedUrl.port) || 9090;
    const payload = JSON.stringify({ message, userId });

    const result = await new Promise((resolve, reject) => {
      const options = { hostname: ROUTER_HOST, port: ROUTER_PORT, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 50000 };
      const r = http.request(options, (resp) => {
        let data = '';
        resp.on('data', (c) => data += c);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Reponse invalide: ' + data.substring(0, 200))); }
        });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Timeout (50s)')); });
      r.write(payload);
      r.end();
    });

    res.json(result);
  } catch (err) {
    log.error('dashboard', 'Chat proxy error: ' + err.message);
    res.status(502).json({ error: 'Le bot ne repond pas: ' + err.message });
  }
});

// Inbox Manager
app.get('/api/inbox', authRequired, resolveClient, async (req, res) => {
  const im = await readData('inbox-manager', req.clientId) || {};
  const config = im.config || {};
  const stats = im.stats || {};
  const receivedEmails = (im.receivedEmails || []).slice(-100);
  const matchedReplies = (im.matchedReplies || []).slice(-50);

  const sortedEmails = receivedEmails.sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
  const { items: paginatedEmails, total: totalEmails } = paginate(sortedEmails, req);

  res.json({
    config,
    stats,
    emails: paginatedEmails,
    totalEmails,
    replies: matchedReplies.reverse()
  });
});

// --- HITL Drafts (proxy vers telegram-router) ---
function proxyToRouter(routerPath, method, body, clientId) {
  return new Promise((resolve, reject) => {
    const routerUrl = clientId ? clientRegistry.getClientRouterUrl(clientId) : DEFAULT_ROUTER_URL;
    const url = new URL(routerUrl + routerPath);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, timeout: 15000 };
    if (body) opts.headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    const req = http.request(opts, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: resp.statusCode, data: { error: 'Parse error' } }); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

app.get('/api/drafts', authRequired, resolveClient, async (req, res) => {
  try {
    const result = await proxyToRouter('/api/hitl/drafts', 'GET', null, req.clientId);
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

app.post('/api/drafts/:id/approve', authRequired, resolveClient, async (req, res) => {
  try {
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/approve', 'POST', null, req.clientId);
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

app.post('/api/drafts/:id/reject', authRequired, resolveClient, async (req, res) => {
  try {
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/reject', 'POST', null, req.clientId);
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

app.post('/api/drafts/:id/edit', authRequired, resolveClient, async (req, res) => {
  try {
    const body = JSON.stringify({ body: req.body.body });
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/edit', 'POST', body, req.clientId);
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

// Meeting Scheduler
app.get('/api/meetings', authRequired, resolveClient, async (req, res) => {
  const ms = await readData('meeting-scheduler', req.clientId) || {};
  const config = ms.config || {};
  const stats = ms.stats || {};
  const meetings = ms.meetings || [];
  const eventTypes = ms.eventTypes || [];

  const now = new Date().toISOString();
  const upcoming = meetings
    .filter(m => m.status === 'booked' && m.scheduledAt && m.scheduledAt > now)
    .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));

  const sortedMeetings = meetings.sort((a, b) => (b.proposedAt || '').localeCompare(a.proposedAt || ''));
  const { items: paginatedMeetings, total: totalMeetings } = paginate(sortedMeetings, req);

  res.json({
    config,
    stats: { ...stats, upcoming: upcoming.length, totalMeetings: meetings.length },
    meetings: paginatedMeetings,
    totalMeetings,
    upcoming,
    eventTypes
  });
});

// Health / Email Operations (admin only)
app.get('/api/email-health', authRequired, adminRequired, resolveClient, async (req, res) => {
  const am = await readData('automailer', req.clientId) || {};
  const emails = am.emails || [];
  const stats = am.stats || {};

  // --- Warmup progress ---
  const firstSendDate = stats.firstSendDate || null;
  let warmupDay = 0;
  let warmupLimit = 5;
  const warmupSchedule = [5, 10, 15, 20, 25, 30, 35, 50, 50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 100];
  if (firstSendDate) {
    warmupDay = Math.floor((Date.now() - new Date(firstSendDate).getTime()) / 86400000);
    warmupLimit = Math.min(warmupSchedule[Math.min(warmupDay, warmupSchedule.length - 1)] || 100, 100);
  }
  const today = new Date().toISOString().substring(0, 10);
  const todaySent = (stats.dailySends && stats.dailySends[today]) || 0;
  const warmupMaxDay = warmupSchedule.length - 1;
  const warmupProgress = Math.min(Math.round((warmupDay / warmupMaxDay) * 100), 100);

  // --- Bounce rate ---
  const totalSent = emails.filter(e => ['sent', 'delivered', 'opened', 'clicked', 'replied'].includes(e.status) || e.sentAt).length;
  const totalBounced = emails.filter(e => e.status === 'bounced').length;
  const bounceRate = totalSent > 0 ? Math.round((totalBounced / totalSent) * 10000) / 100 : 0;
  const totalComplained = emails.filter(e => e.status === 'complained').length;
  const complaintRate = totalSent > 0 ? Math.round((totalComplained / totalSent) * 10000) / 100 : 0;

  // --- Deliverability breakdown ---
  const delivered = emails.filter(e => ['delivered', 'opened', 'clicked', 'replied'].includes(e.status) || e.deliveredAt).length;
  const opened = emails.filter(e => e.openedAt).length;
  const deliveryRate = totalSent > 0 ? Math.round((delivered / totalSent) * 10000) / 100 : 0;
  const openRate = delivered > 0 ? Math.round((opened / delivered) * 10000) / 100 : 0;

  // --- Retry queue status ---
  const MAX_RETRIES = 3;
  const failedEmails = emails.filter(e => e.status === 'failed');
  const retriable = failedEmails.filter(e => (e.retryCount || 0) < MAX_RETRIES);
  const abandoned = failedEmails.filter(e => (e.retryCount || 0) >= MAX_RETRIES);
  const lastRetried = failedEmails
    .filter(e => e.lastRetryAt)
    .sort((a, b) => (b.lastRetryAt || '').localeCompare(a.lastRetryAt || ''))[0];

  // --- Blacklist stats ---
  const blacklist = am.blacklist ? Object.values(am.blacklist) : [];
  const blacklistByReason = {};
  for (const b of blacklist) {
    const r = b.reason || 'unknown';
    blacklistByReason[r] = (blacklistByReason[r] || 0) + 1;
  }

  // --- Archive stats ---
  let archiveStats = { count: 0, oldestDate: null, newestDate: null };
  const archivePath = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/automailer-archive.json';
  try {
    const archiveRaw = await fsp.readFile(archivePath, 'utf8');
    const archive = JSON.parse(archiveRaw);
    archiveStats = {
      count: archive.length,
      oldestDate: archive.length > 0 ? (archive[0].sentAt || archive[0].createdAt) : null,
      newestDate: archive.length > 0 ? (archive[archive.length - 1].sentAt || archive[archive.length - 1].createdAt) : null
    };
  } catch (e) { /* archive file doesn't exist yet */ }

  // --- Daily send history (7j) ---
  const dailySends = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10);
    dailySends.push({
      date: dateStr,
      sent: (stats.dailySends && stats.dailySends[dateStr]) || 0
    });
  }

  res.json({
    warmup: {
      firstSendDate,
      day: warmupDay,
      dailyLimit: warmupLimit,
      maxLimit: 100,
      todaySent,
      remaining: Math.max(0, warmupLimit - todaySent),
      progress: warmupProgress,
      phase: warmupDay < 7 ? 'ramp-up' : warmupDay < 14 ? 'building' : warmupDay < 28 ? 'maturing' : 'full'
    },
    deliverability: {
      totalSent,
      delivered,
      deliveryRate,
      opened,
      openRate,
      bounced: totalBounced,
      bounceRate,
      complained: totalComplained,
      complaintRate,
      healthy: bounceRate < 5 && complaintRate < 0.1
    },
    retryQueue: {
      totalFailed: failedEmails.length,
      retriable: retriable.length,
      abandoned: abandoned.length,
      lastRetryAt: lastRetried ? lastRetried.lastRetryAt : null
    },
    blacklist: {
      total: blacklist.length,
      byReason: blacklistByReason
    },
    archive: archiveStats,
    storage: {
      activeEmails: emails.length,
      maxActive: 10000,
      usage: Math.round((emails.length / 10000) * 100)
    },
    dailySends
  });
});

// Finance (admin only)
app.get('/api/finance', authRequired, adminRequired, resolveClient, async (req, res) => {
  // Lire le fichier app-config.json pour les donnees de budget et service usage
  let appConfig = {};
  try {
    const raw = await fsp.readFile(APP_CONFIG_PATH, 'utf8');
    appConfig = JSON.parse(raw);
  } catch (e) {}

  const budget = appConfig.budget || {};
  const serviceUsage = appConfig.serviceUsage || {};
  const serviceHistory = appConfig.serviceUsageHistory || [];
  const today = new Date().toISOString().substring(0, 10);
  const todayUsage = serviceUsage[today] || {};

  // Budget historique (30 jours)
  const budgetHistory = budget.history || [];

  // Calculer les totaux du mois en cours
  const currentMonth = today.substring(0, 7);
  const monthDays = [...budgetHistory.filter(d => d.date && d.date.startsWith(currentMonth))];
  if (budget.todayDate === today) {
    monthDays.push({ date: today, spent: budget.todaySpent || 0 });
  }
  const monthlyLLMTotal = monthDays.reduce((s, d) => s + (d.spent || 0), 0);

  // Service usage du mois (depuis history + today)
  const monthServiceData = {};
  const services = ['claude', 'openai', 'apollo', 'fullenrich', 'gmail', 'resend'];
  for (const s of services) monthServiceData[s] = { calls: 0, cost: 0, credits: 0, emails: 0, searches: 0, reveals: 0 };

  // History entries for current month
  for (const entry of serviceHistory) {
    if (entry.date && entry.date.startsWith(currentMonth)) {
      for (const s of services) {
        if (entry[s]) {
          const d = entry[s];
          monthServiceData[s].calls += d.calls || 0;
          monthServiceData[s].cost += d.cost || 0;
          monthServiceData[s].credits += d.credits || 0;
          monthServiceData[s].emails += d.emails || 0;
          monthServiceData[s].searches += d.searches || 0;
          monthServiceData[s].reveals += d.reveals || 0;
        }
      }
    }
  }
  // Add today
  for (const s of services) {
    if (todayUsage[s]) {
      const d = todayUsage[s];
      monthServiceData[s].calls += d.calls || 0;
      monthServiceData[s].cost += d.cost || 0;
      monthServiceData[s].credits += d.credits || 0;
      monthServiceData[s].emails += d.emails || 0;
      monthServiceData[s].searches += d.searches || 0;
      monthServiceData[s].reveals += d.reveals || 0;
    }
  }

  // Couts fixes
  const fixedCosts = {
    googleWorkspace: { amount: 7.00, currency: 'USD', label: 'Google Workspace' },
    domain: { amount: 0.58, currency: 'EUR', label: 'Domaine ' + (process.env.CLIENT_DOMAIN || 'ifind.fr') }
  };
  const fixedTotal = 7.00 + 0.58;

  // Cout variable total du mois
  const variableTotal = Object.values(monthServiceData).reduce((s, d) => s + (d.cost || 0), 0);
  const grandTotal = variableTotal + fixedTotal;

  // Projections (cout par email = LLM cost / emails sent, extrapoler)
  const totalEmailsSent = (monthServiceData.gmail.emails || 0) + (monthServiceData.resend.emails || 0);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const daysPassed = new Date().getDate();
  const costPerEmail = totalEmailsSent > 0 ? variableTotal / totalEmailsSent : 0.15; // Estimation par defaut
  const brainCycleCostPerDay = 0.25; // ~2 brain cycles Claude Opus/jour

  const projections = [5, 10, 20, 50].map(emailsPerDay => {
    const emailCostMonth = costPerEmail * emailsPerDay * 30;
    const brainCostMonth = brainCycleCostPerDay * 30;
    const total = emailCostMonth + brainCostMonth + fixedTotal;
    return {
      scale: emailsPerDay + ' emails/jour',
      emailCost: Math.round(emailCostMonth * 100) / 100,
      brainCost: Math.round(brainCostMonth * 100) / 100,
      fixedCost: Math.round(fixedTotal * 100) / 100,
      total: Math.round(total * 100) / 100
    };
  });

  // Historique journalier (30 derniers jours) pour chart
  const dailyCosts = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10);
    const budgetDay = budgetHistory.find(h => h.date === dateStr);
    let cost = budgetDay ? budgetDay.spent : 0;
    if (dateStr === today) cost = budget.todaySpent || 0;
    dailyCosts.push({ date: dateStr, cost: Math.round(cost * 10000) / 10000 });
  }

  res.json({
    today: {
      date: today,
      spent: Math.round((budget.todaySpent || 0) * 10000) / 10000,
      limit: budget.dailyLimit || 5,
      services: todayUsage
    },
    month: {
      period: currentMonth,
      llmTotal: Math.round(monthlyLLMTotal * 100) / 100,
      variableTotal: Math.round(variableTotal * 100) / 100,
      fixedTotal: Math.round(fixedTotal * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      services: monthServiceData,
      daysPassed,
      daysInMonth
    },
    fixedCosts,
    projections,
    dailyCosts,
    totalEmailsSent
  });
});

// --- Client Management (admin only) ---

app.get('/api/clients', authRequired, adminRequired, (req, res) => {
  const clients = clientRegistry.listClients();
  res.json({ clients: clients.map(c => ({
    id: c.id,
    name: c.name,
    plan: c.plan,
    status: c.status,
    routerService: c.routerService,
    onboardingCompleted: c.onboarding?.completed || false,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt || null
  })) });
});

app.post('/api/clients', authRequired, adminRequired, async (req, res) => {
  try {
    const { name, plan, senderEmail, senderName, senderFullName, senderTitle,
      clientDomain, clientDescription, replyToEmail, telegramBotToken, adminChatId,
      hubspotApiKey, apolloApiKey, fullenrichApiKey, claudeApiKey, openaiApiKey,
      resendApiKey, gmailMailboxes, calcomApiKey, calcomUsername,
      imapHost, imapUser, imapPass, dailyBudget } = req.body;

    if (!name) return res.status(400).json({ error: 'Nom du client requis' });

    const client = clientRegistry.createClient({
      name, plan, senderEmail, senderName, senderFullName, senderTitle,
      clientDomain, clientDescription, replyToEmail, telegramBotToken, adminChatId,
      hubspotApiKey, apolloApiKey, fullenrichApiKey, claudeApiKey, openaiApiKey,
      resendApiKey, gmailMailboxes, calcomApiKey, calcomUsername,
      imapHost, imapUser, imapPass, dailyBudget
    });

    // Regenerate docker-compose.clients.yml
    clientRegistry.generateDockerCompose();

    logAudit('client_created', req.ip || 'unknown', client.id + ' (' + client.name + ')');
    res.json({ success: true, client });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/clients/:id', authRequired, adminRequired, (req, res) => {
  const client = clientRegistry.getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  res.json({ client });
});

app.put('/api/clients/:id', authRequired, adminRequired, (req, res) => {
  try {
    const client = clientRegistry.updateClient(req.params.id, req.body);

    // Regenerate compose if config changed
    if (req.body.config || req.body.status) {
      clientRegistry.generateDockerCompose();
    }

    logAudit('client_updated', req.ip || 'unknown', req.params.id);
    res.json({ success: true, client });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/clients/:id', authRequired, adminRequired, (req, res) => {
  try {
    clientRegistry.deleteClient(req.params.id);
    clientRegistry.generateDockerCompose();
    logAudit('client_deleted', req.ip || 'unknown', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/clients/:id/restart', authRequired, adminRequired, async (req, res) => {
  try {
    const result = await clientRegistry.restartClientRouter(req.params.id);
    logAudit('client_restart', req.ip || 'unknown', req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/clients/:id/health', authRequired, adminRequired, async (req, res) => {
  const health = await clientRegistry.getClientHealth(req.params.id);
  res.json(health);
});

// --- Helper functions ---

function calcChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function buildDailyCount(items, dateField, days) {
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10);
    const count = items.filter(item => (item[dateField] || '').substring(0, 10) === dateStr).length;
    result.push({ date: dateStr, count });
  }
  return result;
}

function buildDailyRate(items, dateField, targetStatus, days) {
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10);
    const dayItems = items.filter(item => (item[dateField] || '').substring(0, 10) === dateStr);
    const opened = targetStatus === 'opened' ? dayItems.filter(item => item.openedAt).length : dayItems.filter(item => item.status === targetStatus).length;
    const rate = dayItems.length > 0 ? Math.round((opened / dayItems.length) * 100) : 0;
    result.push({ date: dateStr, total: dayItems.length, opened, rate });
  }
  return result;
}

function buildChartData(all, days) {
  const ff = all.flowfast || {};
  const am = all.automailer || {};
  const leads = ff.leads ? Object.values(ff.leads) : [];
  const emails = am.emails || [];

  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10);
    result.push({
      date: dateStr,
      leads: leads.filter(l => (l.createdAt || '').substring(0, 10) === dateStr).length,
      emailsSent: emails.filter(e => (e.createdAt || '').substring(0, 10) === dateStr).length,
      emailsOpened: emails.filter(e => (e.openedAt || '').substring(0, 10) === dateStr).length
    });
  }
  return result;
}

function buildActivityFeed(all, since) {
  const feed = [];
  const sinceStr = new Date(since).toISOString();

  // FlowFast leads
  const ffLeads = all.flowfast?.leads ? Object.values(all.flowfast.leads) : [];
  ffLeads.filter(l => l.createdAt >= sinceStr).forEach(l => {
    feed.push({ time: l.createdAt, icon: 'target', text: `Nouveau lead : ${l.nom || l.email} (score ${l.score || '?'})`, skill: 'flowfast' });
  });

  // Emails
  const emails = all.automailer?.emails || [];
  emails.filter(e => e.createdAt >= sinceStr).forEach(e => {
    if (e.openedAt) {
      feed.push({ time: e.openedAt, icon: 'eye', text: `Email ouvert par ${e.to}`, skill: 'automailer' });
    }
    if (e.sentAt) {
      feed.push({ time: e.sentAt, icon: 'mail', text: `Email envoyé à ${e.to}`, skill: 'automailer' });
    }
  });

  // Enrichments
  const enriched = all['lead-enrich']?.enrichedLeads ? Object.values(all['lead-enrich'].enrichedLeads) : [];
  enriched.filter(e => e.enrichedAt >= sinceStr).forEach(e => {
    feed.push({ time: e.enrichedAt, icon: 'search', text: `Lead enrichi : ${e.email} (score ${e.aiClassification?.score || '?'})`, skill: 'lead-enrich' });
  });


  // Invoices
  const invoices = all['invoice-bot']?.invoices ? Object.values(all['invoice-bot'].invoices) : [];
  invoices.filter(i => i.createdAt >= sinceStr).forEach(i => {
    feed.push({ time: i.createdAt, icon: 'file-text', text: `Facture ${i.number} créée — ${i.total || 0}€`, skill: 'invoice-bot' });
  });

  // Alerts
  const alerts = all['proactive-agent']?.alertHistory || [];
  alerts.filter(a => a.sentAt >= sinceStr).forEach(a => {
    feed.push({ time: a.sentAt, icon: 'bell', text: a.message?.substring(0, 80) || 'Alerte proactive', skill: 'proactive-agent' });
  });

  return feed.sort((a, b) => b.time.localeCompare(a.time));
}

function buildNextActions(all) {
  const actions = [];
  const pa = all['proactive-agent'] || {};
  const config = pa.config || {};
  const alerts = config.alerts || {};

  if (alerts.morningReport?.enabled) {
    actions.push({ label: 'Rapport matinal', time: `${alerts.morningReport.hour || 8}h00` });
  }
  if (alerts.pipelineAlerts?.enabled) {
    actions.push({ label: 'Alertes pipeline', time: `${alerts.pipelineAlerts.hour || 9}h00` });
  }
  if (alerts.nightlyAnalysis?.enabled) {
    actions.push({ label: 'Analyse nocturne', time: `${alerts.nightlyAnalysis.hour || 2}h00` });
  }
  if (alerts.emailStatusCheck?.enabled) {
    actions.push({ label: 'Vérification emails', time: `Toutes les ${alerts.emailStatusCheck.intervalMinutes || 30} min` });
  }

  return actions;
}

// --- Login page ---
function loginPage(error = null, csrfToken = '') {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mission Control — Connexion</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#09090b;color:#fafafa;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden}

/* Animated gradient orbs */
.orb{position:fixed;border-radius:50%;filter:blur(100px);opacity:.4;pointer-events:none;z-index:0}
.orb-1{width:500px;height:500px;background:rgba(59,130,246,0.15);top:-150px;right:-100px;animation:orbMove 8s ease-in-out infinite}
.orb-2{width:400px;height:400px;background:rgba(139,92,246,0.12);bottom:-100px;left:-100px;animation:orbMove 10s ease-in-out infinite reverse}
.orb-3{width:300px;height:300px;background:rgba(6,182,212,0.08);top:50%;left:60%;animation:orbMove 12s ease-in-out infinite 2s}
@keyframes orbMove{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-40px)}}

.login-container{width:100%;max-width:420px;padding:40px;position:relative;z-index:1;animation:loginFade .6s ease-out}
@keyframes loginFade{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}

.login-card{background:rgba(17,17,19,0.7);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:52px 44px;text-align:center;position:relative;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.4)}
.login-card::before{content:'';position:absolute;inset:-1px;border-radius:20px;background:linear-gradient(135deg,rgba(59,130,246,0.15),transparent 50%,rgba(139,92,246,0.1));z-index:-1;pointer-events:none}

.logo-mark{margin-bottom:20px}
.logo{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;background:linear-gradient(135deg,#a1a1aa,#fafafa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px}
.title{font-family:'DM Sans',sans-serif;font-size:28px;font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#fafafa,#d4d4d8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.subtitle{color:#71717a;font-size:14px;margin-bottom:36px}

.input-group{margin-bottom:24px;text-align:left}
.input-group label{display:block;font-size:13px;font-weight:500;color:#71717a;margin-bottom:8px}
.input-group input{width:100%;padding:14px 18px;background:rgba(9,9,11,0.6);border:1.5px solid rgba(255,255,255,0.06);border-radius:10px;color:#fafafa;font-size:14px;font-family:'Inter',sans-serif;outline:none;transition:all 0.25s}
.input-group input:focus{border-color:rgba(59,130,246,0.5);box-shadow:0 0 0 4px rgba(59,130,246,0.08)}
.input-group input::placeholder{color:#52525b}

.btn{width:100%;padding:14px;background:linear-gradient(135deg,#3b82f6,#7c3aed);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;transition:all 0.25s;position:relative;overflow:hidden}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(59,130,246,0.3)}
.btn::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.1) 45%,rgba(255,255,255,0.1) 55%,transparent 60%);transform:translateX(-100%)}
.btn:hover::after{transform:translateX(100%);transition:transform .6s ease}

.error{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#ef4444;font-size:13px;padding:12px 16px;border-radius:10px;margin-bottom:20px;animation:shake .4s ease}
@keyframes shake{0%,100%{transform:translateX(0)}15%,45%,75%{transform:translateX(-4px)}30%,60%{transform:translateX(4px)}}
.btn:active{transform:scale(0.97)}

.footer-text{margin-top:32px;font-size:11px;color:#3f3f46;letter-spacing:0.5px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<div class="orb orb-1"></div>
<div class="orb orb-2"></div>
<div class="orb orb-3"></div>
<div class="login-container">
<div class="login-card">
  <div class="logo-mark">
    <div style="display:inline-flex;align-items:center;gap:5px"><div style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;background:linear-gradient(135deg,#2563EB,#1e40af);border-radius:9px;box-shadow:0 1px 3px rgba(29,78,216,0.3)"><span style="color:#fff;font-family:Inter,system-ui,sans-serif;font-weight:600;font-size:22px;line-height:1">i</span></div><span style="font-family:Inter,system-ui,sans-serif;font-weight:500;font-size:24px;letter-spacing:-0.01em;background:linear-gradient(135deg,#fafafa,#d4d4d8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">find</span></div>
  </div>
  <div class="logo">Mission Control</div>
  <h1 class="title">Connexion</h1>
  <p class="subtitle">Acc&eacute;dez &agrave; votre tableau de bord</p>
  ${error ? '<div class="error" role="alert">' + error.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</div>' : ''}
  <form method="POST" action="/login">
    <input type="hidden" name="_csrf" value="${csrfToken}">
    <div class="input-group">
      <label for="username">Identifiant</label>
      <input type="text" id="username" name="username" placeholder="admin" value="admin" autocomplete="username" required>
    </div>
    <div class="input-group">
      <label for="password">Mot de passe</label>
      <div style="position:relative">
        <input type="password" id="password" name="password" placeholder="Entrez votre mot de passe" autofocus required autocomplete="current-password" style="padding-right:44px">
        <button type="button" id="toggle-pw" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#71717a;cursor:pointer;padding:4px" aria-label="Afficher le mot de passe">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
      </div>
    </div>
    <button type="submit" class="btn">Se connecter</button>
  </form>
  <div class="footer-text">Propuls&eacute; par ${process.env.CLIENT_NAME || 'iFIND'}</div>
</div>
<script src="/public/js/login.js"></script>
</div>
</body>
</html>`;
}

// --- Main page (SPA shell) ---
app.get('/', authRequired, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA routes
app.get('*', authRequired, (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/public/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Nettoyage des sessions expirées + limites mémoire
setInterval(() => {
  const now = Date.now();
  let cleaned = false;
  for (const [sid, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) { sessions.delete(sid); cleaned = true; }
  }
  // Limite sessions en mémoire (max 1000)
  if (sessions.size > 1000) {
    const sorted = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < sorted.length - 1000; i++) { sessions.delete(sorted[i][0]); cleaned = true; }
  }
  if (cleaned) saveSessions();
  // Limite CSRF tokens (max 10000)
  if (csrfTokens.size > 10000) {
    const sorted = [...csrfTokens.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < sorted.length - 10000; i++) csrfTokens.delete(sorted[i][0]);
  }
  // Rotation audit log sur disque (garder max 50000 lignes)
  fsp.stat(AUDIT_FILE).then(stat => {
    if (stat.size > 10 * 1024 * 1024) { // > 10MB
      fsp.readFile(AUDIT_FILE, 'utf8').then(raw => {
        const lines = raw.split('\n').filter(l => l.trim());
        if (lines.length > 50000) {
          fsp.writeFile(AUDIT_FILE, lines.slice(-25000).join('\n') + '\n').catch(() => {});
        }
      }).catch(() => {});
    }
  }).catch(() => {});
}, 3600000);

app.listen(PORT, '0.0.0.0', () => {
  log.info('dashboard', `Dashboard démarré sur le port ${PORT}`);
});
