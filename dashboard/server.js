const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'MoltBot2026!';

// Sessions en mémoire
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h

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
  'system-advisor': process.env.SYSTEM_ADVISOR_DATA_DIR ? `${process.env.SYSTEM_ADVISOR_DATA_DIR}/system-advisor.json` : '/data/system-advisor/system-advisor.json'
};

const MOLTBOT_CONFIG_PATH = process.env.MOLTBOT_CONFIG_DIR
  ? `${process.env.MOLTBOT_CONFIG_DIR}/moltbot-config.json`
  : '/data/moltbot-config/moltbot-config.json';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
  res.send(loginPage());
});

app.post('/login', loginLimiter, (req, res) => {
  if (req.body.password === PASSWORD) {
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, { createdAt: Date.now() });
    res.cookie('sid', sid, { httpOnly: true, maxAge: SESSION_TTL, sameSite: 'lax' });
    console.log('[dashboard] Login OK from ' + (req.ip || 'unknown'));
    return res.redirect('/');
  }
  console.log('[dashboard] Login FAIL from ' + (req.ip || 'unknown'));
  res.send(loginPage('Mot de passe incorrect'));
});

app.get('/logout', (req, res) => {
  const sid = req.cookies.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie('sid');
  res.redirect('/login');
});

// --- Static files ---
app.use('/public', authRequired, express.static(path.join(__dirname, 'public')));

// --- Data reading helper ---
function readData(skill) {
  const cached = dataCache.get(skill);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const filePath = DATA_PATHS[skill];
  if (!filePath) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    dataCache.set(skill, { data, ts: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

function readAllData() {
  const result = {};
  for (const skill of Object.keys(DATA_PATHS)) {
    result[skill] = readData(skill);
  }
  return result;
}

// --- API Routes ---

// Overview / KPIs globaux
app.get('/api/overview', authRequired, (req, res) => {
  const all = readAllData();
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

  // MoltBot status
  let moltbotStatus = { mode: 'unknown', cronsActive: false };
  try {
    const raw = fs.readFileSync(MOLTBOT_CONFIG_PATH, 'utf8');
    moltbotStatus = JSON.parse(raw);
  } catch (e) {}

  res.json({
    moltbotStatus,
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

// FlowFast / Prospection
app.get('/api/prospection', authRequired, (req, res) => {
  const ff = readData('flowfast') || {};
  const le = readData('lead-enrich') || {};
  const leads = ff.leads ? Object.values(ff.leads) : [];
  const enriched = le.enrichedLeads || {};

  // Enrichir les leads avec les données lead-enrich
  const enrichedLeads = leads.map(l => {
    const e = enriched[l.email?.toLowerCase()] || {};
    return {
      ...l,
      aiClassification: e.aiClassification || null,
      apolloData: e.apolloData || null
    };
  });

  const searches = ff.searches || [];
  const stats = ff.stats || {};

  // Leads par jour (30 jours)
  const dailyLeads = buildDailyCount(leads, 'createdAt', 30);

  res.json({
    leads: enrichedLeads,
    searches,
    stats: {
      total: leads.length,
      qualified: leads.filter(l => (l.score || 0) >= 6).length,
      avgScore: leads.length > 0 ? Math.round(leads.reduce((s, l) => s + (l.score || 0), 0) / leads.length * 10) / 10 : 0,
      pushedToHubspot: leads.filter(l => l.pushedToHubspot).length,
      ...stats
    },
    dailyLeads
  });
});

// AutoMailer / Emails
app.get('/api/emails', authRequired, (req, res) => {
  const am = readData('automailer') || {};
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
    emails: emails.slice(-200),
    dailyOpenRate,
    topEmails
  });
});

// CRM Pilot
app.get('/api/crm', authRequired, (req, res) => {
  const crm = readData('crm-pilot') || {};
  const activityLog = (crm.activityLog || []).slice(-100);
  const stats = crm.stats || {};
  const users = crm.users ? Object.values(crm.users) : [];

  // Pipeline data from cache
  const pipeline = crm.cache?.pipeline?.data || null;
  const deals = crm.cache?.deals ? Object.values(crm.cache.deals).flatMap(c => c.data || []) : [];
  const contacts = crm.cache?.contacts ? Object.values(crm.cache.contacts).flatMap(c => c.data || []) : [];

  res.json({
    stats: {
      totalActions: stats.totalActions || 0,
      contactsCreated: stats.totalContactsCreated || 0,
      dealsCreated: stats.totalDealsCreated || 0,
      notesAdded: stats.totalNotesAdded || 0,
      tasksCreated: stats.totalTasksCreated || 0
    },
    pipeline,
    deals,
    contacts,
    activityLog
  });
});

// Lead Enrich
app.get('/api/enrichment', authRequired, (req, res) => {
  const le = readData('lead-enrich') || {};
  const enriched = le.enrichedLeads ? Object.values(le.enrichedLeads) : [];
  const apollo = le.apolloUsage || { creditsUsed: 0, creditsLimit: 100 };
  const stats = le.stats || {};
  const activityLog = (le.activityLog || []).slice(-50);

  res.json({
    stats: {
      total: enriched.length,
      avgScore: enriched.length > 0 ? Math.round(enriched.reduce((s, e) => s + (e.aiClassification?.score || 0), 0) / enriched.length * 10) / 10 : 0,
      ...stats
    },
    apollo,
    enriched: enriched.slice(-100),
    activityLog
  });
});

// Content Gen
app.get('/api/content', authRequired, (req, res) => {
  const cg = readData('content-gen') || {};
  const allContents = cg.generatedContents ? Object.values(cg.generatedContents).flat() : [];
  const stats = cg.stats || {};

  res.json({
    stats: {
      total: allContents.length,
      byType: stats.byType || {},
      ...stats
    },
    contents: allContents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 50)
  });
});

// Invoice Bot
app.get('/api/invoices', authRequired, (req, res) => {
  const inv = readData('invoice-bot') || {};
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

  res.json({
    stats: {
      totalInvoices: invoices.length,
      paid,
      pending,
      overdue,
      totalClients: clients.length,
      ...stats
    },
    invoices: invoices.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    clients,
    monthlyRevenue
  });
});

// Proactive Agent
app.get('/api/proactive', authRequired, (req, res) => {
  const pa = readData('proactive-agent') || {};
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
app.get('/api/self-improve', authRequired, (req, res) => {
  const si = readData('self-improve') || {};
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
app.get('/api/web-intelligence', authRequired, (req, res) => {
  const wi = readData('web-intelligence') || {};
  const watches = wi.watches ? Object.values(wi.watches) : [];
  const articles = (wi.articles || []).slice(-100);
  const analyses = (wi.analyses || []).slice(-20);
  const stats = wi.stats || {};

  res.json({
    config: wi.config || {},
    stats,
    watches,
    articles: articles.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || '')),
    analyses
  });
});

// System Advisor
app.get('/api/system', authRequired, (req, res) => {
  const sa = readData('system-advisor') || {};
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
function loginPage(error = null) {
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
body{background:#09090b;color:#fafafa;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-container{width:100%;max-width:400px;padding:40px}
.login-card{background:rgba(17,17,19,0.8);backdrop-filter:blur(20px);border:1px solid #1c1c1e;border-radius:16px;padding:48px 40px;text-align:center}
.logo{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#71717a;margin-bottom:8px}
.title{font-family:'DM Sans',sans-serif;font-size:28px;font-weight:700;margin-bottom:8px}
.subtitle{color:#71717a;font-size:14px;margin-bottom:36px}
.input-group{margin-bottom:24px;text-align:left}
.input-group label{display:block;font-size:13px;font-weight:500;color:#71717a;margin-bottom:8px}
.input-group input{width:100%;padding:12px 16px;background:#09090b;border:1px solid #1c1c1e;border-radius:8px;color:#fafafa;font-size:14px;font-family:'Inter',sans-serif;outline:none;transition:border-color 0.2s}
.input-group input:focus{border-color:#3b82f6}
.btn{width:100%;padding:12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;transition:opacity 0.2s}
.btn:hover{opacity:0.9}
.error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:13px;padding:10px 16px;border-radius:8px;margin-bottom:20px}
.glow{position:absolute;top:-200px;left:50%;transform:translateX(-50%);width:600px;height:400px;background:radial-gradient(ellipse,rgba(59,130,246,0.08) 0%,transparent 70%);pointer-events:none}
.login-wrapper{position:relative}
</style>
</head>
<body>
<div class="login-container">
<div class="login-wrapper">
<div class="glow"></div>
<div class="login-card">
  <div class="logo">Mission Control</div>
  <h1 class="title">Connexion</h1>
  <p class="subtitle">Accédez au tableau de bord MoltBot</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/login">
    <div class="input-group">
      <label for="password">Mot de passe</label>
      <input type="password" id="password" name="password" placeholder="Entrez votre mot de passe" autofocus required>
    </div>
    <button type="submit" class="btn">Se connecter</button>
  </form>
</div>
</div>
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
  for (const [sid, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(sid);
  }
}, 3600000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Mission Control] Dashboard démarré sur le port ${PORT}`);
});
