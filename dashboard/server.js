const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const log = require('../gateway/logger.js');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'iFIND2026!';

// Hash du mot de passe au démarrage
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 12);

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
  'content-gen': process.env.CONTENT_GEN_DATA_DIR ? `${process.env.CONTENT_GEN_DATA_DIR}/content-gen-db.json` : '/data/content-gen/content-gen-db.json',
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
const SESSION_KEY = crypto.createHash('sha256')
  .update(PASSWORD + (process.env.SESSION_SECRET || 'moltbot-session-2026'))
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

// --- Audit log ---
const auditLog = [];
const MAX_AUDIT_ENTRIES = 500;

function logAudit(action, ip, details) {
  auditLog.push({ action, ip, details, at: new Date().toISOString() });
  if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
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
  // Audit log pour les requêtes API
  if (req.path.startsWith('/api/')) {
    logAudit('api_request', req.ip || 'unknown', req.path);
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
  const match = await bcrypt.compare(req.body.password || '', PASSWORD_HASH);
  if (match) {
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, { createdAt: Date.now() });
    saveSessions();
    res.cookie('sid', sid, { httpOnly: true, maxAge: SESSION_TTL, sameSite: 'lax', secure: true });
    logAudit('login_success', req.ip || 'unknown', 'Login OK');
    log.info('dashboard', 'Login OK from ' + (req.ip || 'unknown'));
    return res.redirect('/');
  }
  logAudit('login_failed', req.ip || 'unknown', 'Mot de passe incorrect');
  log.warn('dashboard', 'Login FAIL from ' + (req.ip || 'unknown'));
  const csrfToken = generateCsrfToken();
  res.send(loginPage('Mot de passe incorrect', csrfToken));
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
async function readData(skill) {
  const cached = dataCache.get(skill);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const filePath = DATA_PATHS[skill];
  if (!filePath) return null;

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    dataCache.set(skill, { data, ts: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

async function readAllData() {
  const skills = Object.keys(DATA_PATHS);
  const results = await Promise.all(skills.map(skill => readData(skill)));
  const result = {};
  skills.forEach((skill, i) => { result[skill] = results[i]; });
  return result;
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

// Overview / KPIs globaux
app.get('/api/overview', authRequired, async (req, res) => {
  const all = await readAllData();
  const period = req.query.period || '30d';
  const now = Date.now();
  const periodMs = period === '1d' ? 86400000 : period === '7d' ? 604800000 : 2592000000;
  const cutoff = new Date(now - periodMs).toISOString();
  const prevCutoff = new Date(now - periodMs * 2).toISOString();

  // Leads
  const ff = all.flowfast || {};
  const leads = ff.leads ? Object.values(ff.leads) : [];
  const leadsInPeriod = leads.filter(l => l.createdAt >= cutoff).length;
  const leadsPrev = leads.filter(l => l.createdAt >= prevCutoff && l.createdAt < cutoff).length;

  // Emails
  const am = all.automailer || {};
  const emails = am.emails || [];
  const emailsInPeriod = emails.filter(e => e.createdAt >= cutoff).length;
  const emailsPrev = emails.filter(e => e.createdAt >= prevCutoff && e.createdAt < cutoff).length;
  const opened = emails.filter(e => e.createdAt >= cutoff && e.status === 'opened').length;
  const openRate = emailsInPeriod > 0 ? Math.round((opened / emailsInPeriod) * 100) : 0;
  const openedPrev = emails.filter(e => e.createdAt >= prevCutoff && e.createdAt < cutoff && e.status === 'opened').length;
  const openRatePrev = emailsPrev > 0 ? Math.round((openedPrev / emailsPrev) * 100) : 0;

  // Revenue
  const inv = all['invoice-bot'] || {};
  const invoices = inv.invoices ? Object.values(inv.invoices) : [];
  const paidInPeriod = invoices.filter(i => i.paidAt && i.paidAt >= cutoff).reduce((s, i) => s + (i.total || 0), 0);
  const paidPrev = invoices.filter(i => i.paidAt && i.paidAt >= prevCutoff && i.paidAt < cutoff).reduce((s, i) => s + (i.total || 0), 0);

  // Hot leads
  const pa = all['proactive-agent'] || {};
  const hotLeads = pa.hotLeads ? Object.entries(pa.hotLeads).map(([email, data]) => ({
    email,
    ...data,
    // Enrich from lead-enrich
    ...(all['lead-enrich']?.enrichedLeads?.[email.toLowerCase()] || {})
  })).filter(l => l.opens >= 3).slice(0, 10) : [];

  // Activity feed (48h)
  const feed = buildActivityFeed(all, now - 172800000);

  // Charts: 30 days data
  const chartData = buildChartData(all, 30);

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
app.get('/api/prospection', authRequired, async (req, res) => {
  const [ff, le, ap] = await Promise.all([readData('flowfast'), readData('lead-enrich'), readData('autonomous-pilot')]);
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
app.get('/api/emails', authRequired, async (req, res) => {
  const am = await readData('automailer') || {};
  const emails = am.emails || [];
  const campaigns = am.campaigns ? Object.values(am.campaigns) : [];
  const contactLists = am.contactLists ? Object.values(am.contactLists) : [];
  const stats = am.stats || {};

  const sent = emails.filter(e => ['sent', 'delivered', 'opened'].includes(e.status)).length;
  const delivered = emails.filter(e => ['delivered', 'opened'].includes(e.status)).length;
  const opened = emails.filter(e => e.status === 'opened').length;
  const bounced = emails.filter(e => e.status === 'bounced').length;

  const dailyOpenRate = buildDailyRate(emails, 'createdAt', 'opened', 30);

  // Top emails par ouverture
  const topEmails = emails
    .filter(e => e.status === 'opened')
    .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))
    .slice(0, 5);

  // Pagination optionnelle sur les emails
  const { items: paginatedEmails, total: totalEmails } = paginate(emails.slice(-200), req);

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

// CRM Pilot
app.get('/api/crm', authRequired, async (req, res) => {
  const crm = await readData('crm-pilot') || {};
  const activityLog = (crm.activityLog || []).slice(-100);
  const stats = crm.stats || {};
  const users = crm.users ? Object.values(crm.users) : [];

  // Pipeline data from cache
  const pipeline = crm.cache?.pipeline?.data || null;
  const deals = crm.cache?.deals ? Object.values(crm.cache.deals).flatMap(c => c.data || []) : [];
  const contacts = crm.cache?.contacts ? Object.values(crm.cache.contacts).flatMap(c => c.data || []) : [];

  // Pagination optionnelle sur contacts et deals
  const { items: paginatedContacts, total: totalContacts } = paginate(contacts, req);
  const { items: paginatedDeals, total: totalDeals } = paginate(deals, req);

  res.json({
    stats: {
      totalActions: stats.totalActions || 0,
      contactsCreated: stats.totalContactsCreated || 0,
      dealsCreated: stats.totalDealsCreated || 0,
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
app.get('/api/enrichment', authRequired, async (req, res) => {
  const le = await readData('lead-enrich') || {};
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

// Content Gen
app.get('/api/content', authRequired, async (req, res) => {
  const cg = await readData('content-gen') || {};
  const allContents = cg.generatedContents ? Object.values(cg.generatedContents).flat() : [];
  const stats = cg.stats || {};

  const sortedContents = allContents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 50);
  const { items: paginatedContents, total: totalContents } = paginate(sortedContents, req);

  res.json({
    stats: {
      total: allContents.length,
      byType: stats.byType || {},
      ...stats
    },
    contents: paginatedContents,
    totalContents
  });
});

// Invoice Bot
app.get('/api/invoices', authRequired, async (req, res) => {
  const inv = await readData('invoice-bot') || {};
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
app.get('/api/proactive', authRequired, async (req, res) => {
  const pa = await readData('proactive-agent') || {};
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

// Self-Improve
app.get('/api/self-improve', authRequired, async (req, res) => {
  const si = await readData('self-improve') || {};
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
app.get('/api/web-intelligence', authRequired, async (req, res) => {
  const wi = await readData('web-intelligence') || {};
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

// System Advisor
app.get('/api/system', authRequired, async (req, res) => {
  const sa = await readData('system-advisor') || {};
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

// Inbox Manager
app.get('/api/inbox', authRequired, async (req, res) => {
  const im = await readData('inbox-manager') || {};
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

// Meeting Scheduler
app.get('/api/meetings', authRequired, async (req, res) => {
  const ms = await readData('meeting-scheduler') || {};
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
    const opened = dayItems.filter(item => item.status === targetStatus).length;
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
    if (e.status === 'opened' && e.openedAt) {
      feed.push({ time: e.openedAt, icon: 'eye', text: `Email ouvert par ${e.to}`, skill: 'automailer' });
    } else if (e.status === 'sent' && e.sentAt) {
      feed.push({ time: e.sentAt, icon: 'mail', text: `Email envoyé à ${e.to}`, skill: 'automailer' });
    }
  });

  // Enrichments
  const enriched = all['lead-enrich']?.enrichedLeads ? Object.values(all['lead-enrich'].enrichedLeads) : [];
  enriched.filter(e => e.enrichedAt >= sinceStr).forEach(e => {
    feed.push({ time: e.enrichedAt, icon: 'search', text: `Lead enrichi : ${e.email} (score ${e.aiClassification?.score || '?'})`, skill: 'lead-enrich' });
  });

  // Content
  const contents = all['content-gen']?.generatedContents ? Object.values(all['content-gen'].generatedContents).flat() : [];
  contents.filter(c => c.createdAt >= sinceStr).forEach(c => {
    feed.push({ time: c.createdAt, icon: 'pen-tool', text: `Contenu ${c.type} généré`, skill: 'content-gen' });
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
      <label for="password">Mot de passe</label>
      <div style="position:relative">
        <input type="password" id="password" name="password" placeholder="Entrez votre mot de passe" autofocus required style="padding-right:44px">
        <button type="button" id="toggle-pw" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#71717a;cursor:pointer;padding:4px" aria-label="Afficher le mot de passe">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
      </div>
    </div>
    <button type="submit" class="btn">Se connecter</button>
  </form>
  <div class="footer-text">Propuls&eacute; par iFIND</div>
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

// Nettoyage des sessions expirées
setInterval(() => {
  const now = Date.now();
  let cleaned = false;
  for (const [sid, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) { sessions.delete(sid); cleaned = true; }
  }
  if (cleaned) saveSessions();
}, 3600000);

app.listen(PORT, '0.0.0.0', () => {
  log.info('dashboard', `Dashboard démarré sur le port ${PORT}`);
});
