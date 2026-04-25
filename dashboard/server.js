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
const https = require('https');
const log = require('../gateway/logger.js');
const clientRegistry = require('./client-registry.js');
const notificationManager = require('./notification-manager.js');
const curatedLists = require('./curated-lists.js');
const pdfGenerator = require('./pdf-generator.js');
const { registerTriggerEngineRoutes } = require('./trigger-engine-api.js');

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

app.use(express.json({ limit: '50kb' }));
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
    clientId: session.clientId || null,
    scopeClients: Array.isArray(session.scopeClients) ? session.scopeClients : []
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

// Editor or admin required (blocks viewers from mutations)
function editorRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifie' });
  if (req.user.role === 'viewer') {
    return res.status(403).json({ error: 'Acces en lecture seule — contactez votre administrateur' });
  }
  next();
}

// --- Multi-tenant client resolution ---
function resolveClient(req, res, next) {
  if (req.user.role === 'client' || req.user.role === 'editor' || req.user.role === 'viewer') {
    // Client/editor/viewer users are locked to their own clientId
    req.clientId = req.user.clientId || null;
  } else if (req.user.role === 'commercial') {
    // Commercial peut accéder à plusieurs clients — ?clientId= requis, filtré par scopeClients
    const requested = req.query.clientId;
    const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
    if (requested && scope.includes(requested)) {
      req.clientId = requested;
    } else {
      // Par défaut : premier client de son scope
      req.clientId = scope[0] || null;
    }
  } else if (req.user.role === 'admin' && req.query.clientId) {
    // Admin can switch context via ?clientId=
    req.clientId = req.query.clientId;
  } else {
    req.clientId = null; // Admin default = main router
  }
  next();
}

// --- Commercial access guard : commercial n'accède qu'à ses clients autorisés ---
function commercialScopeRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'commercial') {
    return res.status(403).json({ error: 'Accès réservé aux commerciaux et admins' });
  }
  const requested = req.params.clientId || req.query.clientId;
  const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
  if (requested && !scope.includes(requested)) {
    return res.status(403).json({ error: 'Ce client n\'est pas dans votre périmètre' });
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
      clientId: user ? (user.clientId || null) : null,
      scopeClients: user && Array.isArray(user.scopeClients) ? user.scopeClients : []
    });
    saveSessions();
    res.cookie('sid', sid, { httpOnly: true, maxAge: SESSION_TTL, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https' });
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
    scopeClients: u.scopeClients || [],
    createdAt: u.createdAt
  }));
  res.json({ users: list });
});

app.post('/api/users', authRequired, adminRequired, async (req, res) => {
  const { username, password, role, company, clientId, scopeClients } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username et password requis' });
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(uname)) return res.status(400).json({ error: 'Username invalide (2-30 chars, a-z0-9_-)' });
  if (users[uname]) return res.status(409).json({ error: 'Utilisateur existe deja' });
  if (password.length < 12) return res.status(400).json({ error: 'Mot de passe trop court (min 12 caractères)' });
  const ALLOWED_ROLES = new Set(['admin', 'client', 'commercial', 'editor', 'viewer']);
  const validRole = ALLOWED_ROLES.has(role) ? role : 'admin';

  // Validate clientId if provided for client role
  if (validRole === 'client' && clientId) {
    const client = clientRegistry.getClient(clientId);
    if (!client) return res.status(400).json({ error: 'Client "' + clientId + '" introuvable' });
  }
  // Validate scopeClients for commercial role
  if (validRole === 'commercial') {
    if (!Array.isArray(scopeClients) || scopeClients.length === 0) {
      return res.status(400).json({ error: 'Un commercial doit avoir scopeClients (array non vide)' });
    }
  }

  const notificationEmail = validRole === 'client' && req.body.notificationEmail
    ? String(req.body.notificationEmail).trim().substring(0, 200)
    : null;

  users[uname] = {
    username: uname,
    passwordHash: await bcrypt.hash(password, 12),
    role: validRole,
    company: validRole === 'client' ? (company || null) : (company || null),
    clientId: validRole === 'client' ? (clientId || null) : null,
    scopeClients: validRole === 'commercial' ? scopeClients.slice(0, 20) : [],
    notificationEmail: notificationEmail,
    createdAt: new Date().toISOString()
  };

  // Register contact for email notifications
  if (validRole === 'client' && clientId && notificationEmail) {
    notificationManager.setClientContact(clientId, notificationEmail, uname);
  }
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
  const { name, domain, description, senderName, senderFullName, senderTitle, senderEmail, clientWebsite } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Nom et domaine requis' });

  try {
    clientRegistry.updateClient(req.clientId, {
      name: name,
      config: {
        clientDomain: domain,
        clientWebsite: clientWebsite || '',
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

  try {
    const icpData = validateIcp(req.body);
    clientRegistry.updateClient(req.clientId, {
      icp: icpData,
      onboarding: { steps: { icp: new Date().toISOString() } }
    });
    _propagateIcpToBot(req.clientId, icpData);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/onboarding/tone', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });

  try {
    const toneData = validateTone(req.body);
    clientRegistry.updateClient(req.clientId, {
      tone: toneData,
      onboarding: { steps: { tone: new Date().toISOString() } }
    });
    _propagateToneToBot(req.clientId, toneData);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/onboarding/integrations', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const { hubspotApiKey, googleBookingUrl, googleCalendarId, imapHost, imapUser, imapPass } = req.body;

  try {
    clientRegistry.updateClient(req.clientId, {
      config: {
        hubspotApiKey: hubspotApiKey || '',
        googleBookingUrl: googleBookingUrl || '',
        googleCalendarId: googleCalendarId || '',
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

// --- Notifications ---

app.get('/api/notifications', authRequired, resolveClient, (req, res) => {
  const clientId = req.clientId || '_admin';
  const notifs = notificationManager.getNotifications(clientId);
  const unread = notificationManager.getUnreadCount(clientId);
  res.json({ notifications: notifs.slice(0, 50), unread });
});

app.post('/api/notifications/:id/read', authRequired, resolveClient, (req, res) => {
  const clientId = req.clientId || '_admin';
  notificationManager.markRead(clientId, req.params.id);
  res.json({ success: true });
});

app.post('/api/notifications/read-all', authRequired, resolveClient, (req, res) => {
  const clientId = req.clientId || '_admin';
  notificationManager.markAllRead(clientId);
  res.json({ success: true });
});

// --- Client Settings ---

// ===== Input validation for ICP and Tone =====
const VALID_COMPANY_SIZES = curatedLists.COMPANY_SIZES;
const VALID_FORMALITIES = curatedLists.FORMALITIES.map(f => f.value);
const VALID_SENIORITIES = curatedLists.SENIORITIES.map(s => s.value);
const VALID_INDUSTRIES = curatedLists.INDUSTRIES;
const VALID_TITLES = curatedLists.TITLES;
const VALID_GEOGRAPHY = curatedLists.GEOGRAPHY;
const VALID_FORBIDDEN = curatedLists.FORBIDDEN_WORDS_STANDARD;
const MAX_VP_LEN = 500;

function validateIcp(body) {
  return {
    industries: Array.isArray(body.industries)
      ? body.industries.filter(s => typeof s === 'string' && VALID_INDUSTRIES.includes(s)).slice(0, 20)
      : [],
    titles: Array.isArray(body.titles)
      ? body.titles.filter(s => typeof s === 'string' && VALID_TITLES.includes(s)).slice(0, 20)
      : [],
    seniorities: Array.isArray(body.seniorities)
      ? body.seniorities.filter(s => VALID_SENIORITIES.includes(s)).slice(0, 11)
      : [],
    companySizes: Array.isArray(body.companySizes)
      ? body.companySizes.filter(s => VALID_COMPANY_SIZES.includes(s)).slice(0, 6)
      : [],
    geography: Array.isArray(body.geography)
      ? body.geography.filter(s => typeof s === 'string' && VALID_GEOGRAPHY.includes(s)).slice(0, 20)
      : []
  };
}

function validateTone(body) {
  return {
    formality: VALID_FORMALITIES.includes(body.formality) ? body.formality : 'decontracte',
    valueProposition: typeof body.valueProposition === 'string'
      ? body.valueProposition.substring(0, MAX_VP_LEN).trim() : '',
    forbiddenWords: Array.isArray(body.forbiddenWords)
      ? body.forbiddenWords.filter(w => typeof w === 'string' && VALID_FORBIDDEN.includes(w)).slice(0, 30)
      : []
  };
}

// ===== Propagate settings to bot's autonomous-pilot storage =====
// Uses atomic write (write .tmp then rename) to avoid corruption

function _atomicWriteJSON(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, filePath);
}

function _loadOrCreateApData(apPath) {
  if (fs.existsSync(apPath)) {
    return JSON.parse(fs.readFileSync(apPath, 'utf8'));
  }
  // Create default structure for new clients
  const dir = path.dirname(apPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return {
    config: { enabled: true, emailPreferences: {} },
    goals: { searchCriteria: {} },
    progress: {},
    actionQueue: [],
    actionHistory: []
  };
}

function _propagateIcpToBot(clientId, icp) {
  try {
    const apPath = clientRegistry.getClientDataPaths(clientId)['autonomous-pilot'];
    if (!apPath) return;
    const apData = _loadOrCreateApData(apPath);
    if (!apData.goals) apData.goals = {};
    if (!apData.goals.searchCriteria) apData.goals.searchCriteria = {};
    apData.goals.searchCriteria.industries = icp.industries;
    apData.goals.searchCriteria.titles = icp.titles;
    apData.goals.searchCriteria.seniorities = icp.seniorities || [];
    apData.goals.searchCriteria.companySize = icp.companySizes;
    apData.goals.searchCriteria.locations = icp.geography;
    _atomicWriteJSON(apPath, apData);
    log.info('dashboard', 'ICP propagated to bot for client ' + clientId);
  } catch (e) {
    log.warn('dashboard', 'Failed to propagate ICP to bot: ' + e.message);
  }
}

function _propagateToneToBot(clientId, tone) {
  try {
    const apPath = clientRegistry.getClientDataPaths(clientId)['autonomous-pilot'];
    if (!apPath) return;
    const apData = _loadOrCreateApData(apPath);
    if (!apData.config) apData.config = {};
    if (!apData.config.emailPreferences) apData.config.emailPreferences = {};
    apData.config.emailPreferences.tone = tone.formality;
    apData.config.emailPreferences.forbiddenWords = tone.forbiddenWords;
    apData.config.emailPreferences.valueProposition = tone.valueProposition;
    _atomicWriteJSON(apPath, apData);
    log.info('dashboard', 'Tone propagated to bot for client ' + clientId);
  } catch (e) {
    log.warn('dashboard', 'Failed to propagate tone to bot: ' + e.message);
  }
}

app.get('/api/settings', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const client = clientRegistry.getClient(req.clientId);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  res.json({
    id: client.id,
    name: client.name,
    plan: client.plan,
    config: {
      senderEmail: client.config.senderEmail,
      senderName: client.config.senderName,
      senderFullName: client.config.senderFullName,
      senderTitle: client.config.senderTitle,
      clientDomain: client.config.clientDomain,
      clientWebsite: client.config.clientWebsite || '',
      clientDescription: client.config.clientDescription
    },
    icp: client.icp || {},
    tone: client.tone || {},
    notificationPrefs: client.notificationPrefs || {},
    icpLocked: !!(client.onboarding && client.onboarding.completed),
    changeRequests: (client.changeRequests || []).slice(0, 10)
  });
});

app.put('/api/settings/icp', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const _c = clientRegistry.getClient(req.clientId);
  if (_c && _c.onboarding && _c.onboarding.completed && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ICP verrouille apres configuration. Utilisez "Demander une modification".' });
  }
  try {
    const icp = validateIcp(req.body);
    if (icp.industries.length === 0 && icp.titles.length === 0) {
      return res.status(400).json({ error: 'Au moins une industrie ou un poste cible requis' });
    }
    clientRegistry.updateClient(req.clientId, { icp });
    _propagateIcpToBot(req.clientId, icp);
    logAudit('icp_changed', req.ip || 'unknown', req.user.username + ' -> ' + req.clientId + ': ' + JSON.stringify(icp));
    // Auto-resolve pending change requests + notify client
    if (req.user.role === 'admin') {
      const _cl = clientRegistry.getClient(req.clientId);
      if (_cl && _cl.changeRequests && _cl.changeRequests.some(r => r.status === 'pending')) {
        const updated = _cl.changeRequests.map(r => r.status === 'pending' ? { ...r, status: 'resolved', resolvedAt: new Date().toISOString() } : r);
        clientRegistry.updateClient(req.clientId, { changeRequests: updated });
        notificationManager.createNotification(req.clientId, 'system', 'Configuration mise a jour', 'Votre demande de modification ICP a ete traitee.', '#settings');
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/settings/tone', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const _c2 = clientRegistry.getClient(req.clientId);
  if (_c2 && _c2.onboarding && _c2.onboarding.completed && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Ton verrouille apres configuration. Utilisez "Demander une modification".' });
  }
  try {
    const tone = validateTone(req.body);
    clientRegistry.updateClient(req.clientId, { tone });
    _propagateToneToBot(req.clientId, tone);
    logAudit('tone_changed', req.ip || 'unknown', req.user.username + ' -> ' + req.clientId + ': ' + JSON.stringify(tone));
    // Auto-resolve pending change requests + notify client
    if (req.user.role === 'admin') {
      const _cl2 = clientRegistry.getClient(req.clientId);
      if (_cl2 && _cl2.changeRequests && _cl2.changeRequests.some(r => r.status === 'pending')) {
        const updated = _cl2.changeRequests.map(r => r.status === 'pending' ? { ...r, status: 'resolved', resolvedAt: new Date().toISOString() } : r);
        clientRegistry.updateClient(req.clientId, { changeRequests: updated });
        notificationManager.createNotification(req.clientId, 'system', 'Configuration mise a jour', 'Votre demande de modification de ton a ete traitee.', '#settings');
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Demande de modification ICP/Tone (client locked) ---

const _changeRequestLimiter = {};
function _checkChangeRequestLimit(clientId) {
  const now = Date.now();
  const key = clientId;
  if (!_changeRequestLimiter[key] || _changeRequestLimiter[key].resetAt < now) {
    _changeRequestLimiter[key] = { count: 0, resetAt: now + 86400000 };
  }
  _changeRequestLimiter[key].count++;
  return _changeRequestLimiter[key].count <= 3;
}

function _sendAdminTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID || '1409505520';
  if (!token || !chatId) return;
  const payload = JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: '/bot' + token + '/sendMessage',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 10000
  });
  req.on('error', (e) => log.error('dashboard', 'Telegram notif error: ' + e.message));
  req.write(payload);
  req.end();
}

app.post('/api/settings/request-change', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim().substring(0, 1000) : '';
  if (!message) return res.status(400).json({ error: 'Message requis' });
  if (!_checkChangeRequestLimit(req.clientId)) {
    return res.status(429).json({ error: 'Maximum 3 demandes par jour' });
  }
  const client = clientRegistry.getClient(req.clientId);
  const clientName = client ? client.name : req.clientId;
  notificationManager.createNotification('admin', 'change_request',
    'Demande modification — ' + clientName,
    message,
    '#settings?clientId=' + req.clientId
  );
  _sendAdminTelegram('<b>Demande modif ICP/Ton</b>\nClient: ' + clientName + '\n\n' + message);
  // Persist change request in client object
  const existing = client ? (client.changeRequests || []) : [];
  existing.unshift({ id: crypto.randomBytes(6).toString('hex'), message, status: 'pending', createdAt: new Date().toISOString() });
  clientRegistry.updateClient(req.clientId, { changeRequests: existing.slice(0, 20) });
  log.info('dashboard', 'Change request from ' + req.clientId + ': ' + message.substring(0, 100));
  res.json({ success: true, message: 'Demande envoyee' });
});

app.get('/api/settings/blacklist', authRequired, resolveClient, async (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const am = await readData('automailer', req.clientId) || {};
  const blacklist = am.blacklist ? Object.entries(am.blacklist).map(([key, val]) => ({
    entry: key,
    reason: val.reason || 'manual',
    addedAt: val.addedAt || null
  })) : [];
  res.json({ blacklist });
});

app.put('/api/settings/notifications', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  try {
    const prefs = {
      draftPending: !!req.body.draftPending,
      hotLead: !!req.body.hotLead,
      campaignMilestone: !!req.body.campaignMilestone,
      emailNotifications: !!req.body.emailNotifications
    };
    // Update notification email if provided
    if (typeof req.body.notificationEmail === 'string') {
      const email = req.body.notificationEmail.trim().substring(0, 200);
      prefs.notificationEmail = email;
      if (email) {
        const client = clientRegistry.getClient(req.clientId);
        notificationManager.setClientContact(req.clientId, email, client ? client.name : req.clientId);
      }
    }
    clientRegistry.updateClient(req.clientId, { notificationPrefs: prefs });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Knowledge Base (per-client) ---

const KB_TEMPLATE = {
  _meta: { version: '1.0', description: 'Knowledge Base client — grounding des reponses IA' },
  company: { name: '', tagline: '', description: '', founder: '', founderTitle: '', website: '', email: '' },
  services: { main: '', includes: [], does_not_include: [] },
  pricing: { setup: 'Pas de frais de setup', monthly_plans: [], engagement: '', guarantee: '' },
  process: { steps: [], what_client_provides: [], onboarding_time: '' },
  differentiators: [],
  faq: [],
  forbidden_claims: [
    'Ne JAMAIS promettre un nombre precis de RDV ou de leads',
    'Ne JAMAIS inventer de chiffres, statistiques ou resultats clients',
    'Ne JAMAIS mentionner : IA, bot, automatisation, SDR, pipeline, machine learning'
  ],
  fallback_phrase: 'Bonne question — je vais me renseigner et je reviens vers toi rapidement.'
};

function _getClientKBPath(clientId) {
  if (!clientId) return null;
  return '/clients/' + clientId + '/data/inbox-manager/knowledge-base.json';
}

function _loadClientKB(clientId) {
  const kbPath = _getClientKBPath(clientId);
  if (!kbPath) return null;
  try {
    if (fs.existsSync(kbPath)) {
      return JSON.parse(fs.readFileSync(kbPath, 'utf8'));
    }
  } catch (e) {
    log.warn('dashboard', 'Erreur lecture KB client ' + clientId + ': ' + e.message);
  }
  return null;
}

function _saveClientKB(clientId, kb) {
  const kbPath = _getClientKBPath(clientId);
  if (!kbPath) throw new Error('Pas de clientId');
  const dir = path.dirname(kbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  kb._meta = kb._meta || {};
  kb._meta.updatedAt = new Date().toISOString();
  kb._meta.version = '1.0';
  const tmp = kbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8');
  fs.renameSync(tmp, kbPath);
}

function _validateKB(body) {
  const kb = {};
  // Company
  if (body.company && typeof body.company === 'object') {
    kb.company = {
      name: String(body.company.name || '').substring(0, 100),
      tagline: String(body.company.tagline || '').substring(0, 200),
      description: String(body.company.description || '').substring(0, 1000),
      founder: String(body.company.founder || '').substring(0, 100),
      founderTitle: String(body.company.founderTitle || '').substring(0, 100),
      website: String(body.company.website || '').substring(0, 200),
      email: String(body.company.email || '').substring(0, 200)
    };
  }
  // Services
  if (body.services && typeof body.services === 'object') {
    kb.services = {
      main: String(body.services.main || '').substring(0, 500),
      includes: Array.isArray(body.services.includes) ? body.services.includes.filter(s => typeof s === 'string').map(s => s.substring(0, 300)).slice(0, 20) : [],
      does_not_include: Array.isArray(body.services.does_not_include) ? body.services.does_not_include.filter(s => typeof s === 'string').map(s => s.substring(0, 300)).slice(0, 20) : []
    };
  }
  // Pricing
  if (body.pricing && typeof body.pricing === 'object') {
    kb.pricing = {
      setup: String(body.pricing.setup || '').substring(0, 300),
      monthly_plans: Array.isArray(body.pricing.monthly_plans) ? body.pricing.monthly_plans.slice(0, 10).map(p => ({
        name: String(p.name || '').substring(0, 50),
        price: String(p.price || '').substring(0, 50),
        volume: String(p.volume || '').substring(0, 100),
        description: String(p.description || '').substring(0, 200)
      })) : [],
      founder_pricing: String(body.pricing.founder_pricing || '').substring(0, 200),
      engagement: String(body.pricing.engagement || '').substring(0, 300),
      guarantee: String(body.pricing.guarantee || '').substring(0, 500)
    };
  }
  // Process
  if (body.process && typeof body.process === 'object') {
    kb.process = {
      steps: Array.isArray(body.process.steps) ? body.process.steps.filter(s => typeof s === 'string').map(s => s.substring(0, 300)).slice(0, 10) : [],
      what_client_provides: Array.isArray(body.process.what_client_provides) ? body.process.what_client_provides.filter(s => typeof s === 'string').map(s => s.substring(0, 300)).slice(0, 10) : [],
      onboarding_time: String(body.process.onboarding_time || '').substring(0, 200)
    };
  }
  // Differentiators
  if (Array.isArray(body.differentiators)) {
    kb.differentiators = body.differentiators.filter(s => typeof s === 'string').map(s => s.substring(0, 300)).slice(0, 10);
  }
  // FAQ
  if (Array.isArray(body.faq)) {
    kb.faq = body.faq.slice(0, 20).map(f => ({
      question: String(f.question || '').substring(0, 300),
      answer: String(f.answer || '').substring(0, 1000)
    })).filter(f => f.question && f.answer);
  }
  // Forbidden claims
  if (Array.isArray(body.forbidden_claims)) {
    kb.forbidden_claims = body.forbidden_claims.filter(s => typeof s === 'string').map(s => s.substring(0, 300)).slice(0, 20);
  }
  // Fallback phrase
  if (typeof body.fallback_phrase === 'string') {
    kb.fallback_phrase = body.fallback_phrase.substring(0, 300);
  }
  // Booking URL (convenience field)
  if (typeof body.booking_url === 'string') {
    kb.booking_url = body.booking_url.substring(0, 300);
  }
  return kb;
}

app.get('/api/settings/kb', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  const kb = _loadClientKB(req.clientId);
  res.json({ kb: kb || KB_TEMPLATE, isDefault: !kb });
});

app.put('/api/settings/kb', authRequired, resolveClient, (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });
  try {
    const validated = _validateKB(req.body);
    if (!validated.company || !validated.company.name) {
      return res.status(400).json({ error: 'Nom de l\'entreprise requis dans la Knowledge Base' });
    }
    _saveClientKB(req.clientId, validated);
    // Mark onboarding step
    clientRegistry.updateClient(req.clientId, {
      onboarding: { steps: { kb: new Date().toISOString() } }
    });
    logAudit('kb_updated', req.ip || 'unknown', req.user.username + ' -> ' + req.clientId);
    log.info('dashboard', 'KB mise a jour pour client ' + req.clientId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/settings/kb/template', authRequired, (req, res) => {
  res.json({ template: KB_TEMPLATE });
});

// --- Curated lists (public for frontend) ---

app.get('/api/curated-lists', authRequired, (req, res) => {
  res.json(curatedLists);
});

// --- AI Website Analysis ---

const _aiAnalysisCount = {};
function _checkAiRateLimit(clientId) {
  const today = new Date().toISOString().substring(0, 10);
  const entry = _aiAnalysisCount[clientId];
  if (!entry || entry.date !== today) {
    _aiAnalysisCount[clientId] = { date: today, count: 0 };
  }
  if (_aiAnalysisCount[clientId].count >= 3) return false;
  _aiAnalysisCount[clientId].count++;
  return true;
}

function _fetchWebsite(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;
    let redirects = 0;

    function doFetch(fetchUrl) {
      const u = new URL(fetchUrl);
      // SSRF protection
      const host = u.hostname;
      if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost)/i.test(host)) {
        return reject(new Error('Adresse privee non autorisee'));
      }
      const reqMod = u.protocol === 'https:' ? https : http;
      const req = reqMod.get(fetchUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; iFIND/1.0)' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (++redirects > 3) return reject(new Error('Trop de redirections'));
          const next = new URL(res.headers.location, fetchUrl).href;
          res.resume();
          return doFetch(next);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let data = '';
        let size = 0;
        res.setEncoding('utf8');
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 512000) { res.destroy(); reject(new Error('Page trop volumineuse')); return; }
          data += chunk;
        });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    }
    doFetch(url);
  });
}

function _extractText(html) {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : '';
  // Strip tags for body text
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let text = bodyMatch ? bodyMatch[1] : html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, description, text: text.substring(0, 4500) };
}

function _callClaudeSonnet(apiKey, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.content && response.content[0]) {
            resolve(response.content[0].text);
          } else if (response.error) {
            reject(new Error('Claude API: ' + (response.error.message || JSON.stringify(response.error))));
          } else {
            reject(new Error('Reponse Claude invalide'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Claude API')); });
    req.write(postData);
    req.end();
  });
}

app.post('/api/ai/analyze-website', authRequired, resolveClient, async (req, res) => {
  if (!req.clientId) return res.status(400).json({ error: 'Aucun client associe' });

  const url = (req.body.url || '').trim();
  if (!url) return res.status(400).json({ error: 'URL requise' });

  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'URL doit etre HTTP ou HTTPS' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'URL invalide' });
  }

  if (!_checkAiRateLimit(req.clientId)) {
    return res.status(429).json({ error: 'Limite de 3 analyses par jour atteinte' });
  }

  try {
    const html = await _fetchWebsite(parsedUrl.href);
    const { title, description, text } = _extractText(html);
    const siteContent = [
      title ? 'TITRE: ' + title : '',
      description ? 'DESCRIPTION: ' + description : '',
      'CONTENU: ' + text
    ].filter(Boolean).join('\n\n');

    const claudeApiKey = process.env.CLAUDE_API_KEY;
    if (!claudeApiKey) return res.status(500).json({ error: 'Configuration IA manquante' });

    const systemPrompt = 'Tu es un expert en prospection B2B. Analyse le contenu d\'un site web d\'entreprise et deduis le profil de client ideal (ICP) pour cette entreprise.\n\nTu dois retourner un JSON strict (pas de markdown, pas de commentaires) avec ces champs:\n{\n  "companyDescription": "description en 1-2 phrases",\n  "suggestedIndustries": ["..."],\n  "suggestedTitles": ["..."],\n  "suggestedSeniorities": ["..."],\n  "suggestedCompanySizes": ["..."],\n  "suggestedGeography": ["..."],\n  "suggestedFormality": "...",\n  "suggestedValueProposition": "...",\n  "suggestedForbiddenWords": ["..."]\n}\n\nREGLES:\n- suggestedIndustries: choisis UNIQUEMENT parmi: ' + JSON.stringify(curatedLists.INDUSTRIES) + '\n- suggestedTitles: choisis UNIQUEMENT parmi: ' + JSON.stringify(curatedLists.TITLES) + '\n- suggestedSeniorities: choisis UNIQUEMENT parmi: ' + curatedLists.SENIORITIES.map(s => s.value).join(', ') + '\n- suggestedCompanySizes: choisis UNIQUEMENT parmi: ' + curatedLists.COMPANY_SIZES.join(', ') + '\n- suggestedGeography: choisis UNIQUEMENT parmi: ' + JSON.stringify(curatedLists.GEOGRAPHY) + '\n- suggestedFormality: choisis UNIQUEMENT parmi: tres-formel, formel, decontracte, familier\n- suggestedValueProposition: genere une proposition de valeur en francais, max 500 chars, du point de vue de l\'entreprise analysee. Ecris a la premiere personne du pluriel ("Nous aidons...")\n- suggestedForbiddenWords: choisis UNIQUEMENT parmi: ' + JSON.stringify(curatedLists.FORBIDDEN_WORDS_STANDARD) + '\n- Selectionne 3-8 industries, 5-10 titres, 2-4 seniorites, 2-3 tailles, 2-5 geographies, 5-10 mots interdits\n- Si le site est francophone, privilegie des geographies francophones\n- Retourne UNIQUEMENT le JSON, rien d\'autre';

    const analysis = await _callClaudeSonnet(claudeApiKey, systemPrompt,
      'Analyse ce site web et retourne le JSON:\n\n' + siteContent);

    let parsed;
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Pas de JSON');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      log.warn('dashboard', 'AI analyze: reponse non-JSON: ' + analysis.substring(0, 200));
      return res.status(500).json({ error: 'Erreur d\'analyse IA. Reessayez.' });
    }

    // Filter strictly against curated lists
    const result = {
      companyDescription: typeof parsed.companyDescription === 'string' ? parsed.companyDescription.substring(0, 500) : '',
      suggestedIndustries: (parsed.suggestedIndustries || []).filter(i => curatedLists.INDUSTRIES.includes(i)),
      suggestedTitles: (parsed.suggestedTitles || []).filter(t => curatedLists.TITLES.includes(t)),
      suggestedSeniorities: (parsed.suggestedSeniorities || []).filter(s => curatedLists.SENIORITIES.some(cs => cs.value === s)),
      suggestedCompanySizes: (parsed.suggestedCompanySizes || []).filter(s => curatedLists.COMPANY_SIZES.includes(s)),
      suggestedGeography: (parsed.suggestedGeography || []).filter(g => curatedLists.GEOGRAPHY.includes(g)),
      suggestedFormality: VALID_FORMALITIES.includes(parsed.suggestedFormality) ? parsed.suggestedFormality : 'decontracte',
      suggestedValueProposition: typeof parsed.suggestedValueProposition === 'string' ? parsed.suggestedValueProposition.substring(0, 500) : '',
      suggestedForbiddenWords: (parsed.suggestedForbiddenWords || []).filter(w => curatedLists.FORBIDDEN_WORDS_STANDARD.includes(w))
    };

    logAudit('ai_analyze_website', req.ip || 'unknown', req.clientId + ' -> ' + parsedUrl.hostname);
    log.info('dashboard', 'AI analysis OK for ' + req.clientId + ': ' + result.suggestedIndustries.length + ' industries, ' + result.suggestedTitles.length + ' titles');
    res.json({ success: true, analysis: result });
  } catch (e) {
    log.error('dashboard', 'AI analyze error: ' + e.message);
    res.status(500).json({ error: 'Erreur lors de l\'analyse: ' + e.message });
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

// --- Reply Mode: Autopilot / Copilot / Manual (F7) ---
app.get('/api/settings/reply-mode', authRequired, resolveClient, (req, res) => {
  let mode = 'copilot';
  if (req.clientId) {
    const client = clientRegistry.getClient(req.clientId);
    mode = (client && client.replyMode) || 'copilot';
  }
  res.json({ mode });
});

app.put('/api/settings/reply-mode', authRequired, resolveClient, (req, res) => {
  const validModes = ['autopilot', 'copilot', 'manual'];
  const mode = validModes.includes(req.body.mode) ? req.body.mode : 'copilot';
  // Autopilot = admin only (security: client can't enable full auto without understanding)
  if (mode === 'autopilot' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Le mode Autopilot ne peut etre active que par un administrateur' });
  }
  if (req.clientId) {
    clientRegistry.updateClient(req.clientId, { replyMode: mode });
  }
  logAudit('reply_mode_changed', req.ip, { mode, by: req.user.username });
  sseEmitToClient(req.clientId, 'badge_update', { type: 'settings' });
  res.json({ success: true, mode });
});

// --- Conductor IA: Priorities (F8) ---
const _prioritiesCache = new Map();
app.get('/api/priorities', authRequired, resolveClient, async (req, res) => {
  try {
    const cacheKey = req.clientId || '_admin';
    const cached = _prioritiesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60000) return res.json(cached.data);

    const [am, im, draftsResult] = await Promise.all([
      readData('automailer', req.clientId),
      readData('inbox-manager', req.clientId),
      proxyToRouter('/api/hitl/drafts', 'GET', null, req.clientId).catch(() => ({ data: [] }))
    ]);

    const priorities = [];
    const receivedEmails = (im || {}).receivedEmails || [];
    const handoffs = (im || {}).handoffs || {};

    // 1. Unread positive replies (score 100)
    const positiveUnread = receivedEmails.filter(r =>
      !r.readAt && (r.sentiment === 'interested' || r.sentiment === 'positive' || r.sentiment === 'meeting')
    );
    for (const r of positiveUnread.slice(0, 3)) {
      priorities.push({
        type: 'hot_lead',
        title: 'Lead chaud : ' + (r.fromName || r.from || 'inconnu'),
        description: (r.subject || '').substring(0, 80),
        score: 100,
        action: 'Voir conversation',
        link: '#unibox'
      });
    }

    // 2. Pending drafts > 30 min (score 80)
    const drafts = Array.isArray(draftsResult.data) ? draftsResult.data : [];
    if (drafts.length > 0) {
      priorities.push({
        type: 'stale_draft',
        title: drafts.length + ' brouillon' + (drafts.length > 1 ? 's' : '') + ' en attente',
        description: 'Approbation requise',
        score: 80,
        action: 'Approuver',
        link: '#drafts'
      });
    }

    // 3. Active handoffs needing attention (score 70)
    const handoffCount = Object.keys(handoffs).length;
    if (handoffCount > 0) {
      priorities.push({
        type: 'handoff',
        title: handoffCount + ' handoff' + (handoffCount > 1 ? 's' : '') + ' actif' + (handoffCount > 1 ? 's' : ''),
        description: 'Conversations en attente de reponse humaine',
        score: 70,
        action: 'Voir',
        link: '#unibox'
      });
    }

    // 4. Low open rate warning (score 50)
    const emails = (am || {}).emails || [];
    const recentSent = emails.filter(e => e.sentAt && (Date.now() - new Date(e.sentAt).getTime()) < 604800000);
    const recentOpened = recentSent.filter(e => e.openedAt);
    if (recentSent.length >= 10) {
      const openRate = recentOpened.length / recentSent.length;
      if (openRate < 0.2) {
        priorities.push({
          type: 'low_campaign',
          title: 'Taux d\'ouverture bas : ' + Math.round(openRate * 100) + '%',
          description: 'Les 7 derniers jours — revoir les sujets',
          score: 50,
          action: 'Voir campagnes',
          link: '#campaigns'
        });
      }
    }

    priorities.sort((a, b) => b.score - a.score);
    const result = { priorities: priorities.slice(0, 5), generatedAt: new Date().toISOString() };
    _prioritiesCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erreur priorities', priorities: [] });
  }
});

// --- Global Search (F22/F25) ---
app.get('/api/search', authRequired, resolveClient, async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json({ results: [], total: 0 });

  try {
    const [am, im, le] = await Promise.all([
      readData('automailer', req.clientId),
      readData('inbox-manager', req.clientId),
      readData('lead-enrich', req.clientId)
    ]);
    const results = [];

    // Search prospects
    const enriched = (le || {}).enrichedLeads || {};
    for (const [, lead] of Object.entries(enriched)) {
      if ((lead.email || '').toLowerCase().includes(q) ||
          (lead.name || '').toLowerCase().includes(q) ||
          (lead.company || '').toLowerCase().includes(q) ||
          (lead.title || '').toLowerCase().includes(q)) {
        results.push({ type: 'prospect', email: lead.email, name: lead.name, company: lead.company, score: lead.score });
      }
    }

    // Search emails
    for (const em of ((am || {}).emails || []).slice(-500)) {
      if ((em.to || '').toLowerCase().includes(q) ||
          (em.subject || '').toLowerCase().includes(q)) {
        results.push({ type: 'email', to: em.to, subject: em.subject, sentAt: em.sentAt });
        if (results.length >= 50) break;
      }
    }

    // Search conversations
    for (const r of ((im || {}).receivedEmails || []).slice(-200)) {
      if ((r.from || '').toLowerCase().includes(q) ||
          (r.fromName || '').toLowerCase().includes(q)) {
        results.push({ type: 'conversation', prospectEmail: r.from, lastMessage: (r.body || '').substring(0, 80), sentiment: r.sentiment });
        if (results.length >= 50) break;
      }
    }

    res.json({ results: results.slice(0, 50), total: results.length });
  } catch (err) {
    res.json({ results: [], total: 0 });
  }
});

// --- Bulk Actions (F18) ---
app.post('/api/drafts/bulk', authRequired, resolveClient, async (req, res) => {
  const { action, ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
    return res.status(400).json({ error: 'ids: array 1-50 requis' });
  }
  const validActions = ['approve', 'reject', 'skip'];
  if (!validActions.includes(action)) return res.status(400).json({ error: 'Action invalide' });

  const results = [];
  for (const id of ids) {
    try {
      const result = await proxyToRouter('/api/hitl/drafts/' + id + '/' + action, 'POST', null, req.clientId);
      results.push({ id, success: result.status === 200 });
    } catch (e) {
      results.push({ id, success: false, error: e.message });
    }
  }
  sseEmitToClient(req.clientId, 'draft_update', { action: 'bulk_' + action, count: ids.length });
  sseEmitToClient(req.clientId, 'badge_update', { type: 'drafts' });
  logAudit('bulk_draft_' + action, req.ip, { count: ids.length, by: req.user.username });
  res.json({ success: true, processed: results.filter(r => r.success).length, errors: results.filter(r => !r.success) });
});

app.post('/api/conversations/bulk', authRequired, resolveClient, async (req, res) => {
  const { action, emails } = req.body || {};
  if (!Array.isArray(emails) || emails.length === 0 || emails.length > 100) {
    return res.status(400).json({ error: 'emails: array 1-100 requis' });
  }
  const validActions = ['mark_read', 'archive'];
  if (!validActions.includes(action)) return res.status(400).json({ error: 'Action invalide' });

  let processed = 0;
  if (action === 'mark_read') {
    // Mark conversations as read by updating last viewed timestamp
    // For now, just acknowledge — the frontend handles the UI state
    processed = emails.length;
  }
  sseEmitToClient(req.clientId, 'conversation_update', { action: 'bulk_' + action, count: emails.length });
  sseEmitToClient(req.clientId, 'badge_update', { type: 'unibox' });
  logAudit('bulk_conversation_' + action, req.ip, { count: emails.length, by: req.user.username });
  res.json({ success: true, processed });
});

// --- AI Learning Feed (F12) ---
app.get('/api/ai-insights', authRequired, resolveClient, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    let learnerPath;
    if (req.clientId) {
      const clientPaths = clientRegistry.getClientDataPaths(req.clientId);
      learnerPath = clientPaths ? clientPaths['inbox-manager'].replace('inbox-manager-db.json', 'realtime-learner.json') : null;
    } else {
      learnerPath = (process.env.INBOX_MANAGER_DATA_DIR || '/data/inbox-manager') + '/realtime-learner.json';
    }
    let insights = [];
    if (learnerPath) {
      try {
        const raw = await fsp.readFile(learnerPath, 'utf8');
        const data = JSON.parse(raw);
        const outcomes = data.outcomes || data.patterns || [];
        insights = outcomes.slice(-limit).reverse().map(o => ({
          date: o.recordedAt || o.date || o.timestamp,
          type: o.outcomeType || o.type || 'pattern_learned',
          description: o.summary || o.insight || o.description || ''
        }));
      } catch (e) { /* file doesn't exist yet */ }
    }
    res.json({ insights });
  } catch (err) {
    res.json({ insights: [] });
  }
});

// --- Heatmap Engagement (F20) ---
app.get('/api/analytics/heatmap', authRequired, resolveClient, async (req, res) => {
  try {
    const am = await readData('automailer', req.clientId) || {};
    const emails = am.emails || [];
    const im = await readData('inbox-manager', req.clientId) || {};
    const received = im.receivedEmails || [];

    // Matrix 7 (days) x 24 (hours) for opens
    const openMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    const replyMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const em of emails) {
      if (em.openedAt) {
        const d = new Date(em.openedAt);
        openMatrix[d.getDay()][d.getHours()]++;
      }
    }
    for (const r of received) {
      const dateField = r.date || r.receivedAt || r.matchedAt;
      if (dateField) {
        const d = new Date(dateField);
        replyMatrix[d.getDay()][d.getHours()]++;
      }
    }

    res.json({ openMatrix, replyMatrix });
  } catch (err) {
    res.json({ openMatrix: [], replyMatrix: [] });
  }
});

// --- White-label Branding (F13) ---
app.get('/api/clients/:id/branding', authRequired, async (req, res) => {
  const client = clientRegistry.getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  res.json({ branding: client.branding || {} });
});

app.put('/api/clients/:id/branding', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin requis' });
  const { logoUrl, primaryColor, secondaryColor, companyName } = req.body || {};
  const branding = {};
  if (companyName) branding.companyName = String(companyName).substring(0, 100);
  if (logoUrl && /^https:\/\//.test(logoUrl)) branding.logoUrl = String(logoUrl).substring(0, 500);
  if (primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) branding.primaryColor = primaryColor;
  if (secondaryColor && /^#[0-9a-fA-F]{6}$/.test(secondaryColor)) branding.secondaryColor = secondaryColor;

  clientRegistry.updateClient(req.params.id, { branding });
  logAudit('branding_updated', req.ip, { clientId: req.params.id, by: req.user.username });
  res.json({ success: true, branding });
});

// --- PDF Weekly Report (F14) ---
app.get('/api/reports/weekly', authRequired, resolveClient, async (req, res) => {
  try {
    const [am, im, proData] = await Promise.all([
      readData('automailer', req.clientId),
      readData('inbox-manager', req.clientId),
      readData('autonomous-pilot', req.clientId).catch(() => null)
    ]);
    const emails = (am || {}).emails || [];
    const received = (im || {}).receivedEmails || [];
    const weekAgo = Date.now() - 604800000;
    const weekEmails = emails.filter(e => e.sentAt && new Date(e.sentAt).getTime() > weekAgo);
    const weekOpened = weekEmails.filter(e => e.openedAt);
    const weekBounced = weekEmails.filter(e => e.status === 'bounced');
    const weekReplies = received.filter(r => {
      const d = r.date || r.receivedAt || r.matchedAt;
      return d && new Date(d).getTime() > weekAgo;
    });

    const hotLeads = ((proData || {}).hotLeads || []).filter(l => (l.opens || 0) >= 3);
    const recommendations = [];
    const openRate = weekEmails.length > 0 ? Math.round((weekOpened.length / weekEmails.length) * 100) : 0;
    const replyRate = weekEmails.length > 0 ? Math.round((weekReplies.length / weekEmails.length) * 100) : 0;
    if (openRate < 20) recommendations.push('Taux ouverture bas (' + openRate + '%) — tester des sujets plus courts et personnalises');
    if (replyRate < 2) recommendations.push('Taux reponse bas (' + replyRate + '%) — augmenter la personnalisation');
    if (weekBounced.length > weekEmails.length * 0.05) recommendations.push('Trop de bounces — verifier la qualite des emails');
    if (hotLeads.length > 0) recommendations.push(hotLeads.length + ' lead(s) chaud(s) a contacter en priorite');
    if (recommendations.length === 0) recommendations.push('Tout va bien ! Continuez comme ca.');

    const clientName = req.clientId ? (clientRegistry.getClient(req.clientId) || {}).name : 'iFIND';
    const stats = {
      sent: weekEmails.length, openRate, replyRate,
      replies: weekReplies.length, hotLeads: hotLeads.length,
      bounced: weekBounced.length, bounceRate: weekEmails.length > 0 ? Math.round((weekBounced.length / weekEmails.length) * 100) : 0,
      hotLeadsList: hotLeads.slice(0, 8).map(l => ({
        name: l.apolloData?.name || l.email, company: l.apolloData?.organization?.name || '',
        opens: l.opens || 0, score: l.aiClassification?.score || 0
      })),
      recommendations
    };

    const pdfBuffer = await pdfGenerator.generateWeeklyReport(stats, clientName);
    const week = req.query.week || new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport-hebdo-' + week + '.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    log.error('dashboard', 'PDF report error: ' + err.message);
    res.status(500).json({ error: 'Erreur generation PDF', details: err.message });
  }
});

// --- Export Conversation PDF (F15) ---
app.get('/api/conversations/:email/export', authRequired, resolveClient, async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email requis' });

    const threadData = await buildConversationThread(email, req.clientId);
    if (!threadData || !threadData.messages || threadData.messages.length === 0) {
      return res.status(404).json({ error: 'Conversation introuvable' });
    }

    const pdfBuffer = await pdfGenerator.generateConversationExport(threadData.prospect, threadData.messages);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="conversation-' + email.split('@')[0] + '.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Erreur export PDF', details: err.message });
  }
});

// Helper: build conversation thread (reused from /api/conversations/:email)
async function buildConversationThread(email, clientId) {
  const [am, im] = await Promise.all([
    readData('automailer', clientId),
    readData('inbox-manager', clientId)
  ]);
  const allEmails = (am || {}).emails || [];
  const sentToProspect = allEmails.filter(e => (e.to || '').toLowerCase().trim() === email);
  const receivedEmails = ((im || {}).receivedEmails || []).filter(r => (r.from || '').toLowerCase().trim() === email);
  const autoReplies = ((im || {}).autoReplies || []).filter(r => (r.to || '').toLowerCase().trim() === email);

  const messages = [];
  for (const e of sentToProspect) { messages.push({ type: 'sent', date: e.sentAt || e.createdAt, subject: e.subject, body: e.body, status: e.status, openedAt: e.openedAt, stepNumber: e.step }); }
  for (const r of receivedEmails) { messages.push({ type: 'received', date: r.date || r.receivedAt, subject: r.subject, body: r.body, sentiment: r.sentiment }); }
  for (const a of autoReplies) { messages.push({ type: 'auto_reply', date: a.sentAt || a.date, subject: a.subject, body: a.body, confidence: a.confidence }); }
  messages.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const prospect = { email, name: sentToProspect[0]?.contactName || email.split('@')[0], company: sentToProspect[0]?.company || '' };
  return { prospect, messages };
}

// --- Meeting Scheduling (F10) ---
app.post('/api/conversations/:email/propose-meeting', authRequired, resolveClient, async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email requis' });
    const { duration, timezone } = req.body || {};

    const payload = JSON.stringify({
      prospectEmail: email,
      duration: Math.min(parseInt(duration) || 30, 120),
      timezone: timezone || 'Europe/Paris'
    });

    const result = await proxyToRouter('/api/meeting/propose', 'POST', payload, req.clientId);
    if (result.status >= 200 && result.status < 300) {
      res.json(result.data);
    } else {
      // Fallback: generate generic meeting text
      const slots = [];
      const now = new Date();
      for (let i = 1; i <= 3; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        if (d.getDay() === 0) d.setDate(d.getDate() + 1);
        if (d.getDay() === 6) d.setDate(d.getDate() + 2);
        d.setHours(10, 0, 0, 0);
        slots.push({ start: d.toISOString(), label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' a 10h' });
        d.setHours(14, 0, 0, 0);
        slots.push({ start: d.toISOString(), label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' a 14h' });
      }
      res.json({ slots: slots.slice(0, 4), text: 'Seriez-vous disponible ' + slots.slice(0, 3).map(s => s.label).join(', ') + ' ?' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erreur meeting', details: err.message });
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

// Niche Health Monitor
app.get('/api/niche-health', authRequired, resolveClient, async (req, res) => {
  const ap = await readData('autonomous-pilot', req.clientId) || {};
  const nicheHealth = ap.nicheHealth || {};
  const nichePerf = ap.nichePerformance || {};

  const slugs = [...new Set([...Object.keys(nicheHealth), ...Object.keys(nichePerf)])].filter(k => !k.startsWith('_'));

  const niches = slugs.map(slug => {
    const h = nicheHealth[slug] || {};
    const p = nichePerf[slug] || {};
    return {
      slug,
      totalAvailable: h.totalAvailable || 0,
      contacted: h.contacted || 0,
      exhaustionPct: h.exhaustionPct || 0,
      status: h.status || 'unknown',
      lastScanAt: h.lastScanAt || null,
      sent: p.sent || 0,
      opened: p.opened || 0,
      replied: p.replied || 0,
      leads: p.leads || 0,
      openRate: p.sent > 0 ? Math.round((p.opened / p.sent) * 100) : 0,
      replyRate: p.sent > 0 ? Math.round((p.replied / p.sent) * 100) : 0,
      history: h.history || []
    };
  });

  res.json({
    niches: niches.sort((a, b) => b.exhaustionPct - a.exhaustionPct),
    lastFullScan: nicheHealth._lastFullScanAt || null
  });
});

// AutoMailer / Emails

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


// Lead Enrich

// Invoice Bot (admin only)

// Proactive Agent

// Self-Improve (admin only)

// Web Intelligence

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

// --- Unibox: Conversations list ---
app.get('/api/conversations', authRequired, resolveClient, async (req, res) => {
  try {
    const [am, im] = await Promise.all([
      readData('automailer', req.clientId),
      readData('inbox-manager', req.clientId)
    ]);

    const emails = (am || {}).emails || [];
    const receivedEmails = (im || {}).receivedEmails || [];
    const autoReplies = (im || {}).autoReplies || [];

    // Group by prospect email (normalized lowercase)
    const convMap = new Map();

    function getOrCreate(email) {
      const key = (email || '').toLowerCase().trim();
      if (!key) return null;
      if (!convMap.has(key)) {
        convMap.set(key, {
          prospectEmail: key,
          prospectName: null,
          company: null,
          sentEmails: [],
          received: [],
          autoReplied: [],
          lastSentiment: null,
          lastSentimentScore: null
        });
      }
      return convMap.get(key);
    }

    // Index sent emails
    for (const e of emails) {
      const conv = getOrCreate(e.to);
      if (!conv) continue;
      conv.sentEmails.push(e);
      if (!conv.prospectName && e.contactName) conv.prospectName = e.contactName;
      if (!conv.company && e.company) conv.company = e.company;
    }

    // Index received emails
    for (const r of receivedEmails) {
      const conv = getOrCreate(r.from);
      if (!conv) continue;
      conv.received.push(r);
      if (r.sentiment) conv.lastSentiment = r.sentiment;
      if (r.sentimentScore != null) conv.lastSentimentScore = r.sentimentScore;
    }

    // Index auto-replies
    for (const ar of autoReplies) {
      const conv = getOrCreate(ar.prospectEmail);
      if (!conv) continue;
      conv.autoReplied.push(ar);
    }

    // Build conversation summaries
    let conversations = [];
    for (const [, conv] of convMap) {
      // Skip warmup/spam conversations (received only, no sent emails = not a real prospect)
      if (conv.sentEmails.length === 0 && conv.autoReplied.length === 0) continue;

      // Collect all messages with dates for sorting
      const allMessages = [];
      for (const e of conv.sentEmails) {
        allMessages.push({ date: e.sentAt || e.createdAt || '', type: 'sent', body: e.body || e.subject || '' });
      }
      for (const r of conv.received) {
        allMessages.push({ date: r.date || r.processedAt || '', type: 'received', body: r.snippet || r.subject || '', sentiment: r.sentiment, sentimentScore: r.sentimentScore });
      }
      for (const ar of conv.autoReplied) {
        allMessages.push({ date: ar.sentAt || '', type: 'auto_reply', body: ar.replyBody || ar.replySubject || '' });
      }

      if (allMessages.length === 0) continue;

      allMessages.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const last = allMessages[allMessages.length - 1];

      // Determine status
      let status = 'contacted';
      const hasOpened = conv.sentEmails.some(e => e.openedAt);
      const hasReply = conv.received.length > 0;
      if (hasOpened) status = 'opened';
      if (hasReply) status = 'replied';
      // Check sentiment for higher statuses
      const latestReply = conv.received.length > 0
        ? conv.received.sort((a, b) => (b.date || b.processedAt || '').localeCompare(a.date || a.processedAt || ''))[0]
        : null;
      const sentiment = latestReply ? latestReply.sentiment : null;
      if (sentiment === 'interested' || sentiment === 'positive') status = 'interested';
      if (sentiment === 'meeting' || sentiment === 'booking') status = 'meeting';

      // Unread = last received with no sent/auto_reply after it
      let unread = false;
      if (conv.received.length > 0) {
        const lastReceivedDate = conv.received.reduce((max, r) => {
          const d = r.date || r.processedAt || '';
          return d > max ? d : max;
        }, '');
        const lastSentDate = [...conv.sentEmails, ...conv.autoReplied].reduce((max, e) => {
          const d = e.sentAt || e.createdAt || '';
          return d > max ? d : max;
        }, '');
        unread = lastReceivedDate > lastSentDate;
      }

      conversations.push({
        prospectEmail: conv.prospectEmail,
        prospectName: conv.prospectName || null,
        company: conv.company || null,
        lastMessage: (last.body || '').substring(0, 200),
        lastMessageAt: last.date || null,
        lastMessageType: last.type,
        sentiment: sentiment || null,
        sentimentScore: latestReply ? (latestReply.sentimentScore != null ? latestReply.sentimentScore : null) : null,
        totalSent: conv.sentEmails.length,
        totalReceived: conv.received.length,
        unread,
        status
      });
    }

    // Filter by sentiment/status
    const filter = (req.query.filter || '').toLowerCase();
    if (filter && filter !== 'all') {
      conversations = conversations.filter(c =>
        c.sentiment === filter || c.status === filter
      );
    }

    // Search query (enhanced: also search in lastMessage and lastSubject)
    const q = (req.query.q || '').toLowerCase().trim();
    if (q) {
      conversations = conversations.filter(c =>
        (c.prospectEmail || '').toLowerCase().includes(q) ||
        (c.prospectName || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.lastMessage || '').toLowerCase().includes(q) ||
        (c.lastSubject || '').toLowerCase().includes(q)
      );
    }

    // Advanced filters (F3)
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    if (dateFrom) {
      conversations = conversations.filter(c => (c.lastMessageAt || '') >= dateFrom);
    }
    if (dateTo) {
      conversations = conversations.filter(c => (c.lastMessageAt || '') <= dateTo + 'T23:59:59');
    }
    const confMin = parseFloat(req.query.sentimentConfidence);
    if (!isNaN(confMin) && confMin > 0) {
      conversations = conversations.filter(c => (c.sentimentScore || 0) >= confMin);
    }

    // Filter by company for client users
    conversations = filterByCompany(conversations, req.user, 'company');

    // Sort by lastMessageAt DESC
    conversations.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

    const total = conversations.length;

    // Paginate with page/limit
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const startIdx = (page - 1) * limit;
    const paginated = conversations.slice(startIdx, startIdx + limit);

    res.json({ conversations: paginated, total });
  } catch (err) {
    log.error('dashboard', 'Conversations list error: ' + err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- Unibox: Conversation thread for a specific prospect ---
app.get('/api/conversations/:email', authRequired, resolveClient, async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }

    const [am, im, le] = await Promise.all([
      readData('automailer', req.clientId),
      readData('inbox-manager', req.clientId),
      readData('lead-enrich', req.clientId)
    ]);

    const allEmails = (am || {}).emails || [];
    const receivedEmails = (im || {}).receivedEmails || [];
    const autoReplies = (im || {}).autoReplies || [];

    // Filter for this prospect
    const sentForProspect = allEmails.filter(e => (e.to || '').toLowerCase().trim() === email);
    const receivedForProspect = receivedEmails.filter(r => (r.from || '').toLowerCase().trim() === email);
    const autoRepliesForProspect = autoReplies.filter(ar => (ar.prospectEmail || '').toLowerCase().trim() === email);

    // Build prospect info from available data
    const firstSent = sentForProspect[0] || {};
    let prospectName = firstSent.contactName || null;
    let prospectCompany = firstSent.company || null;
    let prospectTitle = null;
    let prospectScore = firstSent.score != null ? firstSent.score : null;

    // Try to enrich from lead-enrich data
    if (le) {
      const leads = le.leads || le.enrichedLeads || [];
      const enriched = Array.isArray(leads)
        ? leads.find(l => (l.email || '').toLowerCase() === email)
        : null;
      if (enriched) {
        if (!prospectName && enriched.name) prospectName = enriched.name;
        if (!prospectCompany && enriched.company) prospectCompany = enriched.company;
        if (enriched.title) prospectTitle = enriched.title;
        if (enriched.jobTitle) prospectTitle = enriched.jobTitle;
      }
    }

    // Determine sentiment from latest received
    const sortedReceived = receivedForProspect.sort((a, b) => (b.date || b.processedAt || '').localeCompare(a.date || a.processedAt || ''));
    const latestReply = sortedReceived[0] || null;
    const sentiment = latestReply ? (latestReply.sentiment || null) : null;

    // Determine status
    let status = 'contacted';
    if (sentForProspect.some(e => e.openedAt)) status = 'opened';
    if (receivedForProspect.length > 0) status = 'replied';
    if (sentiment === 'interested' || sentiment === 'positive') status = 'interested';
    if (sentiment === 'meeting' || sentiment === 'booking') status = 'meeting';

    // Build messages array
    const messages = [];

    for (const e of sentForProspect) {
      messages.push({
        id: e.id || null,
        type: 'sent',
        subject: e.subject || null,
        body: e.body || null,
        date: e.sentAt || e.createdAt || null,
        stepNumber: e.stepNumber != null ? e.stepNumber : null,
        status: e.status || null,
        openedAt: e.openedAt || null,
        campaignId: e.campaignId || null,
        abVariant: e.abVariant || null
      });
    }

    for (const r of receivedForProspect) {
      messages.push({
        id: r.id || null,
        type: 'received',
        subject: r.subject || null,
        body: r.snippet || r.body || null,
        date: r.date || r.processedAt || null,
        sentiment: r.sentiment || null,
        sentimentScore: r.sentimentScore != null ? r.sentimentScore : null,
        actionTaken: r.actionTaken || null
      });
    }

    for (const ar of autoRepliesForProspect) {
      messages.push({
        id: ar.id || null,
        type: 'auto_reply',
        subject: ar.replySubject || null,
        body: ar.replyBody || null,
        date: ar.sentAt || null,
        confidence: ar.confidence != null ? ar.confidence : null,
        sentiment: ar.sentiment || null
      });
    }

    // Sort chronologically ASC
    messages.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Check for handoff (look in inbox-manager data)
    let handoff = null;
    if (im && im.handoffs) {
      const h = Array.isArray(im.handoffs)
        ? im.handoffs.find(ho => (ho.prospectEmail || '').toLowerCase() === email)
        : im.handoffs[email] || null;
      if (h) {
        handoff = { at: h.at || h.handoffAt || null, by: h.by || h.handoffBy || null };
      }
    }

    res.json({
      prospect: {
        email,
        name: prospectName,
        company: prospectCompany,
        title: prospectTitle,
        sentiment,
        score: prospectScore,
        status
      },
      messages,
      handoff
    });
  } catch (err) {
    log.error('dashboard', 'Conversation thread error: ' + err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- Unibox: Reply from dashboard ---
app.post('/api/conversations/:email/reply', authRequired, editorRequired, resolveClient, async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase().trim();
    const { body: replyBody, subject } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email requis' });
    if (!replyBody || !replyBody.trim()) return res.status(400).json({ error: 'Corps du message requis' });
    if (replyBody.length > 5000) return res.status(400).json({ error: 'Message trop long (max 5000 caractères)' });

    // Find the original email to get threading info (inReplyTo, references)
    const am = await readData('automailer', req.clientId);
    const allEmails = (am || {}).emails || [];
    const sentToProspect = allEmails.filter(e => (e.to || '').toLowerCase().trim() === email);
    const lastSent = sentToProspect.sort((a, b) => (b.sentAt || b.createdAt || '').localeCompare(a.sentAt || a.createdAt || ''))[0];

    // Also check inbox-manager for last received (to reply to that)
    const im = await readData('inbox-manager', req.clientId);
    const receivedFromProspect = ((im || {}).receivedEmails || []).filter(r => (r.from || '').toLowerCase().trim() === email);
    const lastReceived = receivedFromProspect.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

    // Determine reply-to messageId (prefer last received, fallback to last sent)
    const replyToMsg = lastReceived || lastSent;
    const inReplyTo = replyToMsg ? (replyToMsg.messageId || replyToMsg.id || null) : null;
    const replySubject = subject || (replyToMsg ? 'Re: ' + (replyToMsg.subject || '').replace(/^Re:\s*/i, '') : 'Re: ');

    // Proxy to router for actual sending
    const sendPayload = JSON.stringify({
      to: email,
      subject: replySubject,
      body: replyBody.trim(),
      inReplyTo: inReplyTo,
      references: inReplyTo,
      source: 'dashboard_reply',
      replyBy: req.user.username
    });
    const result = await proxyToRouter('/api/send-reply', 'POST', sendPayload, req.clientId);

    if (result.status >= 200 && result.status < 300 && result.data && result.data.success) {
      logAudit('conversation_reply', req.ip, { to: email, subject: replySubject, bodyLength: replyBody.length, by: req.user.username });
      sseEmitToClient(req.clientId, 'conversation_update', { email, action: 'reply' });
      sseEmitToClient(req.clientId, 'badge_update', { type: 'unibox' });
      res.json({ success: true, to: email });
    } else {
      // Fallback: if router doesn't have /api/send-reply, try direct SMTP via HITL edit pattern
      res.status(result.status || 500).json(result.data || { error: 'Envoi échoué' });
    }
  } catch (err) {
    log.error('dashboard', 'Reply error: ' + err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- Unibox: AI reply suggestions ---
app.post('/api/conversations/:email/suggest', authRequired, resolveClient, async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Build conversation context
    const [am, im] = await Promise.all([
      readData('automailer', req.clientId),
      readData('inbox-manager', req.clientId)
    ]);

    const sentEmails = ((am || {}).emails || []).filter(e => (e.to || '').toLowerCase().trim() === email);
    const received = ((im || {}).receivedEmails || []).filter(r => (r.from || '').toLowerCase().trim() === email);
    const autoReplies = ((im || {}).autoReplies || []).filter(ar => (ar.prospectEmail || '').toLowerCase().trim() === email);

    // Build thread for context
    const allMessages = [];
    sentEmails.forEach(e => allMessages.push({ role: 'sent', body: e.body || '', date: e.sentAt || '' }));
    received.forEach(r => allMessages.push({ role: 'received', body: r.snippet || '', date: r.date || '' }));
    autoReplies.forEach(ar => allMessages.push({ role: 'auto_reply', body: ar.replyBody || '', date: ar.sentAt || '' }));
    allMessages.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Get KB for client
    let kb = null;
    try {
      let kbPath;
      if (req.clientId) {
        const clientPaths = clientRegistry.getClientDataPaths(req.clientId);
        kbPath = clientPaths ? clientPaths['inbox-manager'].replace('-db.json', '/knowledge-base.json').replace('inbox-manager-db.json', 'knowledge-base.json') : null;
        if (!kbPath) {
          // Try direct path
          kbPath = path.join('/opt/moltbot/clients', req.clientId, 'data/inbox-manager/knowledge-base.json');
        }
      } else {
        kbPath = (DATA_PATHS['inbox-manager'] || '').replace('inbox-manager-db.json', 'knowledge-base.json');
      }
      if (kbPath) kb = JSON.parse(await fsp.readFile(kbPath, 'utf8'));
    } catch (e) {}

    const threadText = allMessages.map(m => (m.role === 'received' ? 'PROSPECT: ' : 'NOUS: ') + m.body).join('\n\n');
    const kbText = kb ? JSON.stringify(kb.company || {}) + '\n' + JSON.stringify(kb.services || {}) : '';

    // Proxy to router for AI generation
    const suggestPayload = JSON.stringify({
      thread: threadText,
      kb: kbText,
      prospectEmail: email
    });
    const result = await proxyToRouter('/api/ai-suggest', 'POST', suggestPayload, req.clientId);

    if (result.status >= 200 && result.status < 300) {
      res.json(result.data);
    } else {
      // Fallback: generate simple suggestions locally
      const lastMsg = received.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const sentiment = lastMsg ? lastMsg.sentiment : 'unknown';
      const suggestions = generateFallbackSuggestions(sentiment, sentEmails[0]);
      res.json({ suggestions });
    }
  } catch (err) {
    log.error('dashboard', 'AI suggest error: ' + err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

function generateFallbackSuggestions(sentiment, firstEmail) {
  const name = firstEmail ? (firstEmail.contactName || '').split(' ')[0] : '';
  const prefix = name ? name + ', ' : '';
  if (sentiment === 'interested' || sentiment === 'positive') {
    return [
      { body: prefix + 'super, je te propose qu\'on en discute rapidement. Voici mon lien pour réserver un créneau :', tone: 'direct', confidence: 0.8 },
      { body: prefix + 'merci pour ton retour ! Une question rapide avant qu\'on se cale un call : c\'est quoi ton plus gros frein côté prospection aujourd\'hui ?', tone: 'curieux', confidence: 0.75 },
      { body: prefix + 'content que ça t\'intéresse. Je t\'envoie 2-3 infos par email et on se cale un appel cette semaine ?', tone: 'décontracté', confidence: 0.7 }
    ];
  } else if (sentiment === 'question') {
    return [
      { body: prefix + 'bonne question ! En résumé, on s\'occupe de tout : recherche de prospects, rédaction personnalisée, envoi et relances. Tu reçois des RDV dans ton calendrier.', tone: 'informatif', confidence: 0.8 },
      { body: prefix + 'je comprends la question. Le plus simple serait qu\'on en parle 10 min — je pourrai te montrer concrètement comment ça marche.', tone: 'direct', confidence: 0.75 }
    ];
  } else if (sentiment === 'objection') {
    return [
      { body: prefix + 'je comprends. C\'est souvent la réaction au début. Ce qui convainc en général, c\'est de voir les résultats sur les premières semaines. On peut en discuter ?', tone: 'empathique', confidence: 0.7 },
      { body: prefix + 'merci pour ton honnêteté. Si le timing n\'est pas bon, je peux revenir vers toi dans quelques semaines ?', tone: 'respectueux', confidence: 0.7 }
    ];
  }
  return [
    { body: prefix + 'merci pour ton retour. On peut en discuter plus en détail si tu veux ?', tone: 'neutre', confidence: 0.6 }
  ];
}

// --- Unibox: Handoff IA → Humain ---
app.post('/api/conversations/:email/handoff', authRequired, editorRequired, resolveClient, async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email requis' });
    const { active } = req.body || {};

    // Read inbox-manager data and update handoffs
    let filePath;
    if (req.clientId) {
      const clientPaths = clientRegistry.getClientDataPaths(req.clientId);
      filePath = clientPaths ? clientPaths['inbox-manager'] : null;
    } else {
      filePath = DATA_PATHS['inbox-manager'];
    }
    if (!filePath) return res.status(500).json({ error: 'Chemin données introuvable' });

    let data = {};
    try { data = JSON.parse(await fsp.readFile(filePath, 'utf8')); } catch (e) {}
    if (!data.handoffs) data.handoffs = {};

    if (active === false) {
      delete data.handoffs[email];
    } else {
      data.handoffs[email] = {
        at: new Date().toISOString(),
        by: req.user.username,
        reason: 'dashboard_manual'
      };
    }

    // Atomic write
    const tmpPath = filePath + '.tmp.' + Date.now();
    await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fsp.rename(tmpPath, filePath);
    // Invalidate cache
    const cacheKey = req.clientId ? req.clientId + ':inbox-manager' : 'inbox-manager';
    dataCache.delete(cacheKey);

    logAudit(active === false ? 'handoff_release' : 'handoff_activate', req.ip, { email, by: req.user.username });
    sseEmitToClient(req.clientId, 'conversation_update', { email, action: active === false ? 'handoff_release' : 'handoff_activate' });
    res.json({ success: true, handoff: data.handoffs[email] || null });
  } catch (err) {
    log.error('dashboard', 'Handoff error: ' + err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- SSE: Real-time event stream ---
const sseClients = new Map();

app.get('/api/events', authRequired, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const clientKey = req.user.username + '_' + Date.now();
  sseClients.set(clientKey, { res, user: req.user });

  // Send initial connection event
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { res.write('event: heartbeat\ndata: {"t":' + Date.now() + '}\n\n'); }
    catch (e) { clearInterval(heartbeat); sseClients.delete(clientKey); }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientKey);
  });
});

// Helper: broadcast SSE event to all connected clients
function sseBroadcast(event, data) {
  for (const [key, client] of sseClients) {
    try {
      client.res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    } catch (e) {
      sseClients.delete(key);
    }
  }
}

// Helper: broadcast SSE to specific client (by clientId)
function sseEmitToClient(clientId, event, data) {
  for (const [key, client] of sseClients) {
    try {
      const cId = client.user.clientId || '_admin';
      if (cId === (clientId || '_admin') || client.user.role === 'admin') {
        client.res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
      }
    } catch (e) {
      sseClients.delete(key);
    }
  }
}

// --- HITL Drafts (proxy vers telegram-router) ---
function proxyToRouter(routerPath, method, body, clientId) {
  return new Promise((resolve, reject) => {
    const routerUrl = clientId ? clientRegistry.getClientRouterUrl(clientId) : DEFAULT_ROUTER_URL;
    const url = new URL(routerUrl + routerPath);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, timeout: 15000, headers: { 'x-api-token': process.env.DASHBOARD_PASSWORD || '' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(body); }
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

app.post('/api/drafts/:id/approve', authRequired, editorRequired, resolveClient, async (req, res) => {
  try {
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/approve', 'POST', null, req.clientId);
    if (result.status === 200 && result.data.success && req.clientId) {
      notificationManager.sendDraftSentConfirmation(req.clientId, {
        prospectEmail: result.data.to,
        prospectName: result.data.to,
        subject: req.body.subject || '',
        body: req.body.body || ''
      });
    }
    // SSE: notify draft approved
    sseEmitToClient(req.clientId, 'draft_update', { action: 'approved', id: req.params.id });
    sseEmitToClient(req.clientId, 'badge_update', { type: 'drafts' });
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

app.post('/api/drafts/:id/skip', authRequired, resolveClient, async (req, res) => {
  try {
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/skip', 'POST', null, req.clientId);
    sseEmitToClient(req.clientId, 'draft_update', { action: 'skipped', id: req.params.id });
    sseEmitToClient(req.clientId, 'badge_update', { type: 'drafts' });
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

app.post('/api/drafts/:id/reject', authRequired, editorRequired, resolveClient, async (req, res) => {
  try {
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/reject', 'POST', null, req.clientId);
    sseEmitToClient(req.clientId, 'draft_update', { action: 'rejected', id: req.params.id });
    sseEmitToClient(req.clientId, 'badge_update', { type: 'drafts' });
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: 'Bot indisponible', details: e.message });
  }
});

app.post('/api/drafts/:id/edit', authRequired, editorRequired, resolveClient, async (req, res) => {
  try {
    const body = JSON.stringify({ body: req.body.body });
    const result = await proxyToRouter('/api/hitl/drafts/' + req.params.id + '/edit', 'POST', body, req.clientId);
    if (result.status === 200 && result.data.success && req.clientId) {
      notificationManager.sendDraftSentConfirmation(req.clientId, {
        prospectEmail: result.data.to,
        prospectName: result.data.to,
        subject: '',
        body: req.body.body || ''
      });
    }
    sseEmitToClient(req.clientId, 'draft_update', { action: 'edited', id: req.params.id });
    sseEmitToClient(req.clientId, 'badge_update', { type: 'drafts' });
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

// --- Campaign Health Score /100 (F4) ---

// --- A/B Test Results (F11) ---


// Finance (admin only)

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
      resendApiKey, gmailMailboxes, googleBookingUrl, googleCalendarId,
      imapHost, imapUser, imapPass, dailyBudget } = req.body;

    if (!name) return res.status(400).json({ error: 'Nom du client requis' });

    const client = clientRegistry.createClient({
      name, plan, senderEmail, senderName, senderFullName, senderTitle,
      clientDomain, clientDescription, replyToEmail, telegramBotToken, adminChatId,
      hubspotApiKey, apolloApiKey, fullenrichApiKey, claudeApiKey, openaiApiKey,
      resendApiKey, gmailMailboxes, googleBookingUrl, googleCalendarId,
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

// --- Draft polling for all clients (checks for new drafts every 2 min) ---
setInterval(() => {
  try {
    const clients = clientRegistry.listClients();
    for (const client of clients) {
      if (client.status !== 'active') continue;
      const routerUrl = clientRegistry.getClientRouterUrl(client.id);
      notificationManager.checkForNewDrafts(client.id, routerUrl).catch(() => {});
    }
    // Also check main router (admin = ifind)
    notificationManager.checkForNewDrafts('_admin', DEFAULT_ROUTER_URL).catch(() => {});
  } catch (e) {
    log.warn('dashboard', 'Draft polling error: ' + e.message);
  }
}, 2 * 60 * 1000); // Every 2 minutes

// --- Load client contacts for email notifications ---
function _initClientContacts() {
  try {
    const clients = clientRegistry.listClients();
    for (const client of clients) {
      // Priority 1: notificationPrefs.notificationEmail
      const notifEmail = client.notificationPrefs && client.notificationPrefs.notificationEmail;
      if (notifEmail) {
        notificationManager.setClientContact(client.id, notifEmail, client.name);
        continue;
      }
      // Priority 2: User with notificationEmail for this client
      let foundUser = false;
      for (const [, user] of Object.entries(users)) {
        if (user.clientId === client.id && user.notificationEmail) {
          notificationManager.setClientContact(client.id, user.notificationEmail, user.username);
          foundUser = true;
          break;
        }
      }
      // Priority 3: Client sender email
      if (!foundUser && client.config && client.config.senderEmail) {
        notificationManager.setClientContact(client.id, client.config.senderEmail, client.config.senderName || client.name);
      }
    }
    log.info('dashboard', 'Client contacts charges pour notifications email');
  } catch (e) {
    log.warn('dashboard', 'Erreur chargement contacts clients: ' + e.message);
  }
}

// Register Trigger Engine routes (read-only from SQLite DB)
try {
  registerTriggerEngineRoutes(app, authRequired);
  log.info('dashboard', 'Trigger Engine API routes registered');
} catch (e) {
  log.warn('dashboard', 'Trigger Engine API registration failed: ' + e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  log.info('dashboard', `Dashboard demarre sur le port ${PORT}`);
  _initClientContacts();
});
