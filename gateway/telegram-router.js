// iFIND - Routeur Telegram central (dispatch 13 skills : AutoMailer + CRM Pilot + Lead Enrich + Content Gen + Invoice Bot + Proactive Agent + Self-Improve + Web Intelligence + System Advisor + Autonomous Pilot + Inbox Manager + Meeting Scheduler)

// --- Sentry : doit etre charge en PREMIER pour auto-instrumentation ---
const Sentry = require('./instrument.js');

// --- Securite : refuser de tourner en root ---
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  console.error('FATAL: Bot refuse de tourner en root (uid 0). Utilisez runuser ou USER dans Dockerfile.');
  process.exit(1);
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const { retryAsync, truncateInput, atomicWriteSync } = require('./utils.js');

// --- HTTPS Agent avec keepAlive (connection pooling) ---
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, timeout: 60000 });
const { callOpenAI } = require('./shared-nlp.js');
const { getBreaker, getAllStatus: getAllBreakerStatus } = require('./circuit-breaker.js');
const log = require('./logger.js');

// Phase B4 — refuse boot if STRICT credentials missing for current tenant.
// Safe to call early: validateOnBoot() only inspects process.env (no network/file IO).
require('./credential-manager.js').validateOnBoot();
const AutoMailerHandler = require('../skills/automailer/automailer-handler.js');
const CRMPilotHandler = require('../skills/crm-pilot/crm-handler.js');
const InvoiceBotHandler = require('../skills/invoice-bot/invoice-handler.js');
const ProactiveEngine = require('../skills/proactive-agent/proactive-engine.js');
const ProactiveHandler = require('../skills/proactive-agent/proactive-handler.js');
const SelfImproveHandler = require('../skills/self-improve/self-improve-handler.js');
const WebIntelligenceHandler = require('../skills/web-intelligence/web-intelligence-handler.js');
const SystemAdvisorHandler = require('../skills/system-advisor/system-advisor-handler.js');
const AutonomousHandler = require('../skills/autonomous-pilot/autonomous-handler.js');
const BrainEngine = require('../skills/autonomous-pilot/brain-engine.js');
const InboxHandler = require('../skills/inbox-manager/inbox-handler.js');
let InboxListener;
try { InboxListener = require('../skills/inbox-manager/inbox-listener.js'); } catch (e) { InboxListener = null; }
const MeetingHandler = require('../skills/meeting-scheduler/meeting-handler.js');
const { classifyReply, subClassifyObjection, generateObjectionReply, generateQuestionReplyViaClaude, generateInterestedReplyViaClaude, parseOOOReturnDate, checkGrounding, REPLY_TEMPLATES } = require('../skills/inbox-manager/reply-classifier.js');
const appConfig = require('./app-config.js');
const { ReportWorkflow, fetchProspectData } = require('./report-workflow.js');

// --- Modules extraits (refactoring God Object) ---
const { createTelegramClient } = require('./telegram-client.js');
const { fastClassify, classifySkill, checkStickiness } = require('./skill-router.js');
const { createUserContext } = require('./user-context.js');
const { createCronManager } = require('./cron-manager.js');
const { createResendHandler, RESEND_EVENT_MAP } = require('./resend-handler.js');
const { createUnsubscribeHandler } = require('./unsubscribe-handler.js');
const { createEmailTracking } = require('./email-tracking.js');
const { createHitlApi } = require('./hitl-api.js');
const { verifySvixSignature } = require('./resend-webhook-auth.js');
const { createReplyPipeline } = require('./reply-pipeline.js');

// --- Metriques globales (partage memoire pour System Advisor) ---
const METRICS_FILE = (process.env.APP_CONFIG_DIR || '/data/app-config') + '/ifind-metrics.json';

function _loadMetrics() {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      const raw = fs.readFileSync(METRICS_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      log.info('router', 'Metriques restaurees depuis disque');
      // Remettre startedAt a maintenant (nouveau process)
      saved.startedAt = new Date().toISOString();
      return saved;
    }
  } catch (e) {
    log.warn('router', 'Impossible de charger metriques:', e.message);
  }
  return null;
}

function _saveMetrics() {
  try {
    const dir = require('path').dirname(METRICS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(METRICS_FILE, global.__ifindMetrics);
  } catch (e) {
    log.warn('router', 'Impossible de sauvegarder metriques:', e.message);
  }
  // Sauvegarder l'etat volatile (bans + historique) en meme temps
  if (typeof _saveVolatileState === 'function') _saveVolatileState();
}

global.__ifindMetrics = _loadMetrics() || {
  skillUsage: {},
  responseTimes: {},
  errors: {},
  fastClassifyHits: 0,
  nlpFallbacks: 0,
  humanizationSkipped: 0,
  humanizationApplied: 0,
  emailMetrics: {
    attempted: 0,
    sent: 0,
    failed: 0,
    bounced: 0,
    lastReset: new Date().toISOString()
  },
  startedAt: new Date().toISOString()
};

// Sauvegarde periodique des metriques toutes les 5 minutes
const _metricsSaveInterval = setInterval(_saveMetrics, 5 * 60 * 1000);

function recordSkillUsage(skill) {
  const m = global.__ifindMetrics.skillUsage;
  if (!m[skill]) m[skill] = { count: 0, lastUsedAt: null };
  m[skill].count++;
  m[skill].lastUsedAt = new Date().toISOString();
}

function recordResponseTime(skill, ms) {
  const m = global.__ifindMetrics.responseTimes;
  if (!m[skill]) m[skill] = { times: [] };
  m[skill].times.push(ms);
  if (m[skill].times.length > 100) m[skill].times = m[skill].times.slice(-100);
}

function recordSkillError(skill, errMsg) {
  const m = global.__ifindMetrics.errors;
  if (!m[skill]) m[skill] = { count: 0, recent: [] };
  m[skill].count++;
  m[skill].recent.push({ message: (errMsg || '').substring(0, 200), at: new Date().toISOString() });
  if (m[skill].recent.length > 20) m[skill].recent = m[skill].recent.slice(-20);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const HUBSPOT_KEY = process.env.HUBSPOT_API_KEY;
const APOLLO_KEY = process.env.APOLLO_API_KEY || '';
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || SENDER_EMAIL;
const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASS = process.env.IMAP_PASS || '';
// Google Calendar : credentials lues directement par GoogleCalendarClient via process.env
// Phase B6 — admin chat ID resolved via dedicated module (per-tenant aware)
const { getAdminChatId: _getAdminChatId } = require('./admin-resolver.js');
const ADMIN_CHAT_ID = _getAdminChatId();

// Escape Telegram Markdown v1 — empeche l'injection de formatage par contenu externe
function escTg(text) {
  if (!text) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 2000);
}

if (!TOKEN) {
  log.error('router', 'TELEGRAM_BOT_TOKEN manquant !');
  process.exit(1);
}

// --- Telegram Client (module extrait) ---
const tgClient = createTelegramClient(TOKEN, httpsAgent);
const { telegramAPI, sendMessage, sendTyping, sendMessageWithButtons } = tgClient;

// Connecter le logger aux alertes Telegram (erreurs critiques → notification immediate)
log.setSendTelegram(async (chatId, text) => {
  try { await sendMessage(chatId, text, 'Markdown'); } catch (e) { /* evite boucle infinie */ }
});

// === VALIDATION .ENV AU BOOT — liste toutes les cles manquantes ===
{
  const _required = [
    ['TELEGRAM_BOT_TOKEN', TOKEN, true],
    ['OPENAI_API_KEY', OPENAI_KEY, true],
    ['SENDER_EMAIL', SENDER_EMAIL, true],
    ['ADMIN_CHAT_ID', ADMIN_CHAT_ID, false]
  ];
  const _recommended = [
    ['CLAUDE_API_KEY', CLAUDE_KEY, 'redaction IA desactivee'],
    ['INSTANTLY_API_KEY', process.env.INSTANTLY_API_KEY, 'envoi via Instantly desactive — fallback Gmail'],
    ['INSTANTLY_CAMPAIGN_ID', process.env.INSTANTLY_CAMPAIGN_ID, 'pas de campagne Instantly configuree'],
    ['GMAIL_MAILBOXES', process.env.GMAIL_MAILBOXES, 'rotation mailboxes desactivee'],
    ['CLIENT_DOMAIN', process.env.CLIENT_DOMAIN, 'fallback ifind.fr'],
    ['OWN_DOMAINS', process.env.OWN_DOMAINS, 'fallback domaines iFIND hardcodes']
  ];
  const _missing = _required.filter(([name, val, fatal]) => !val || val.trim() === '');
  const _warnings = _recommended.filter(([name, val]) => !val || val.trim() === '');
  if (_missing.length > 0) {
    const fatalMissing = _missing.filter(([, , fatal]) => fatal);
    for (const [name] of _missing) log.error('router', 'ENV MANQUANTE: ' + name);
    if (fatalMissing.length > 0) {
      log.error('router', 'FATAL: ' + fatalMissing.length + ' variable(s) requise(s) manquante(s) — arret');
      process.exit(1);
    }
  }
  for (const [name, , reason] of _warnings) log.warn('router', 'ENV absente: ' + name + ' — ' + reason);
  if (_missing.length === 0 && _warnings.length === 0) log.info('router', 'Validation .env: toutes les cles presentes');
  else if (_missing.length === 0) log.info('router', 'Validation .env: OK (' + _warnings.length + ' recommandee(s) absente(s))');
}

// === DISK FULL PROTECTION — alerte si < 500 Mo libre ===
{
  try {
    const _diskCheck = require('child_process').execSync("df -BM --output=avail / | tail -1", { encoding: 'utf-8' }).trim();
    const _availMB = parseInt(_diskCheck.replace(/[^0-9]/g, ''), 10);
    if (_availMB < 500) {
      log.error('router', 'DISK CRITICAL: seulement ' + _availMB + ' Mo libre — risque de corruption storage');
    } else if (_availMB < 2000) {
      log.warn('router', 'DISK WARNING: ' + _availMB + ' Mo libre — penser a nettoyer');
    } else {
      log.info('router', 'Disk OK: ' + _availMB + ' Mo libre');
    }
  } catch (e) { log.warn('router', 'Disk check echoue: ' + e.message); }
}

// === MEMORY MONITORING — alerte periodique si RAM > 400 Mo ===
const _memoryCheckInterval = setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  if (rssMB > 400) {
    log.warn('router', 'MEMORY WARNING: RSS=' + rssMB + 'Mo, Heap=' + heapMB + 'Mo — limite container 512Mo');
  }
  // Log toutes les heures pour monitoring (pas d'alerte si OK)
}, 15 * 60 * 1000); // check toutes les 15 min

// --- User Context (module extrait) ---
const userCtx = createUserContext();
const { isRateLimited, addToHistory, getHistoryContext } = userCtx;
// Aliases pour acces direct depuis le code existant
const conversationHistory = userCtx.conversationHistory;
const messageRates = userCtx.messageRates;
const _bans = userCtx.bans;

// --- Handlers ---

const automailerHandler = new AutoMailerHandler(OPENAI_KEY, CLAUDE_KEY, RESEND_KEY, SENDER_EMAIL);
const crmPilotHandler = new CRMPilotHandler(OPENAI_KEY, HUBSPOT_KEY);
const invoiceBotHandler = new InvoiceBotHandler(OPENAI_KEY, RESEND_KEY, SENDER_EMAIL);

// Demarrer les schedulers
automailerHandler.start();
crmPilotHandler.start();
invoiceBotHandler.start();

// Report Workflow (prospection personnalisee depuis la landing page)
const reportWorkflow = new ReportWorkflow({
  claudeKey: CLAUDE_KEY,
  resendKey: RESEND_KEY,
  senderEmail: SENDER_EMAIL,
  adminChatId: ADMIN_CHAT_ID,
  bookingUrl: process.env.BOOKING_URL || '',
  sendTelegram: async (chatId, text) => {
    await sendMessage(chatId, text, 'Markdown');
  }
});

// Inbox Manager + Meeting Scheduler
const inboxHandler = new InboxHandler(OPENAI_KEY);
const meetingHandler = new MeetingHandler(OPENAI_KEY);
inboxHandler.start();
meetingHandler.start();

// Inbox Listener (IMAP) — instancie apres les handlers pour le callback
let inboxListeners = [];

// Self-Improve (instancie apres les autres pour le sendTelegram callback)
let selfImproveHandler = null;

let offset = 0;

// --- HITL : Brouillons de reponses en attente de validation humaine ---
const _pendingDrafts = new Map();      // draftId -> { replyData, autoReply, classification, ... }
const _hitlModifyState = new Map();    // chatId -> { draftId, ts }
function _hitlId() {
  // Cap a 100 drafts (purger les plus anciens si depasse)
  if (_pendingDrafts.size >= 100) {
    let oldest = null, oldestTs = Infinity;
    for (const [id, d] of _pendingDrafts) {
      if ((d.createdAt || 0) < oldestTs) { oldest = id; oldestTs = d.createdAt || 0; }
    }
    if (oldest) _pendingDrafts.delete(oldest);
  }
  return 'h' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
}

// Persistance HITL drafts sur disque
const HITL_DRAFTS_FILE = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/hitl-drafts.json';

function _saveHitlDrafts() {
  try {
    const obj = {};
    for (const [id, draft] of _pendingDrafts) obj[id] = draft;
    atomicWriteSync(HITL_DRAFTS_FILE, obj);
  } catch (e) { log.warn('hitl', 'Erreur sauvegarde drafts: ' + e.message); }
}

function _loadHitlDrafts() {
  try {
    if (fs.existsSync(HITL_DRAFTS_FILE)) {
      const raw = fs.readFileSync(HITL_DRAFTS_FILE, 'utf-8');
      const drafts = JSON.parse(raw);
      const now = Date.now();
      let loaded = 0;
      for (const [id, draft] of Object.entries(drafts)) {
        if (now - (draft.createdAt || 0) < 24 * 60 * 60 * 1000) {
          _pendingDrafts.set(id, draft);
          loaded++;
        }
      }
      if (loaded > 0) log.info('hitl', loaded + ' draft(s) HITL restaure(s) depuis disque');
    }
  } catch (e) { log.warn('hitl', 'Erreur chargement drafts: ' + e.message); }
}
_loadHitlDrafts();

// Sauvegarde periodique des drafts HITL (toutes les 60s)
const _hitlSaveInterval = setInterval(_saveHitlDrafts, 60 * 1000);

// --- Persistance etat volatile (bans + historique) ---
const VOLATILE_STATE_FILE = (process.env.APP_CONFIG_DIR || '/data/app-config') + '/volatile-state.json';

function _loadVolatileState() {
  try {
    if (fs.existsSync(VOLATILE_STATE_FILE)) {
      const raw = fs.readFileSync(VOLATILE_STATE_FILE, 'utf-8');
      const state = JSON.parse(raw);
      const now = Date.now();
      // Restaurer les bans encore actifs
      if (state.bans) {
        for (const id of Object.keys(state.bans)) {
          if (state.bans[id].until > now) {
            _bans[id] = state.bans[id];
          }
        }
        const activeBans = Object.keys(_bans).length;
        if (activeBans > 0) log.info('router', activeBans + ' ban(s) actif(s) restaure(s)');
      }
      // Restaurer l'historique encore frais (< 24h)
      if (state.history) {
        const HISTORY_TTL = 24 * 60 * 60 * 1000;
        for (const id of Object.keys(state.history)) {
          const entries = state.history[id];
          if (entries && entries.length > 0 && now - entries[entries.length - 1].ts < HISTORY_TTL) {
            conversationHistory[id] = entries;
          }
        }
        const restoredChats = Object.keys(conversationHistory).length;
        if (restoredChats > 0) log.info('router', restoredChats + ' conversation(s) restauree(s)');
      }
    }
  } catch (e) {
    log.warn('router', 'Impossible de charger volatile-state:', e.message);
  }
}

function _saveVolatileState() {
  try {
    atomicWriteSync(VOLATILE_STATE_FILE, {
      bans: _bans,
      history: conversationHistory,
      savedAt: new Date().toISOString()
    });
  } catch (e) {
    log.warn('router', 'Impossible de sauvegarder volatile-state:', e.message);
  }
}

// Nettoyage des conversations inactives + pending states toutes les heures
const _cleanupInterval = setInterval(() => {
  const now = Date.now();
  const HISTORY_TTL = 24 * 60 * 60 * 1000; // 24h pour l'historique
  const PENDING_TTL = 30 * 60 * 1000; // 30min pour les workflows abandonnes
  let cleaned = 0;

  // 1. Historique de conversation
  for (const id of Object.keys(conversationHistory)) {
    const entries = conversationHistory[id];
    if (!entries || entries.length === 0 || now - entries[entries.length - 1].ts > HISTORY_TTL) {
      delete conversationHistory[id];
      cleaned++;
    }
  }

  // 2. Pending states des handlers (conversations et confirmations abandonnees)
  // Note: certains handlers sont definis plus bas — resolution lazy pour eviter ReferenceError
  const handlersWithPending = [
    automailerHandler, crmPilotHandler, invoiceBotHandler
  ];
  try { handlersWithPending.push(proactiveHandler, webIntelHandler, systemAdvisorHandler); } catch (e) { log.warn('router', 'Handlers push cleanup: ' + e.message); }
  const pendingMaps = ['pendingConversations', 'pendingConfirmations', 'pendingImports', 'pendingEmails', 'pendingResults'];
  for (const handler of handlersWithPending) {
    for (const mapName of pendingMaps) {
      const obj = handler[mapName];
      if (!obj || typeof obj !== 'object') continue;
      for (const id of Object.keys(obj)) {
        const entry = obj[id];
        if (!entry) continue;
        if (!entry._ts) { entry._ts = now; continue; } // Premier passage : horodater
        if (now - entry._ts > PENDING_TTL) {
          delete obj[id];
          cleaned++;
        }
      }
    }
  }

  // 3. Bans expires
  for (const id of Object.keys(_bans)) {
    if (now > _bans[id].until + 60 * 60 * 1000) delete _bans[id]; // +1h apres expiration
  }

  // 4. Rate limits mortes
  for (const id of Object.keys(messageRates)) {
    if (messageRates[id].length === 0 || now - messageRates[id][messageRates[id].length - 1] > 60000) {
      delete messageRates[id];
    }
  }

  // 5. User queues orphelines (pas d'historique = utilisateur inactif)
  for (const id of Object.keys(_userQueues)) {
    if (!conversationHistory[id]) {
      delete _userQueues[id];
      cleaned++;
    }
  }

  // 6. userActiveSkill orphelines
  for (const id of Object.keys(userActiveSkill)) {
    if (!conversationHistory[id]) {
      delete userActiveSkill[id];
      delete userActiveSkillTime[id];
      cleaned++;
    }
  }

  // 7. HITL drafts : auto-send 5 min (grounded) ou 24h (non-grounded), expire 48h
  const HITL_TTL = 48 * 60 * 60 * 1000;
  const HITL_AUTOSEND_GROUNDED = (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) * 60 * 1000;
  const HITL_AUTOSEND_UNGROUNDED = 24 * 60 * 60 * 1000; // Non-grounded = HITL classique
  const HITL_REMINDER_GROUNDED = Math.max(HITL_AUTOSEND_GROUNDED - 2 * 60 * 1000, 60 * 1000); // 2 min avant auto-send
  for (const [id, draft] of _pendingDrafts) {
    const age = now - draft.createdAt;
    const isGrounded = draft._grounded !== false; // true par defaut, false si explicitement non-grounded
    const autoSendDelay = isGrounded ? HITL_AUTOSEND_GROUNDED : HITL_AUTOSEND_UNGROUNDED;

    if (age > HITL_TTL) {
      log.info('hitl', 'Draft expire apres 48h: ' + id + ' pour ' + (draft.replyData && draft.replyData.from));
      _pendingDrafts.delete(id);
      cleaned++;
    } else if (age > autoSendDelay && !draft._autoSent) {
      // Auto-send (seulement interested/question, PAS not_interested)
      if (draft.sentiment === 'interested' || draft.sentiment === 'question') {
        draft._autoSent = true;
        const delayLabel = isGrounded ? (Math.round(HITL_AUTOSEND_GROUNDED / 60000) + ' min') : '24h';
        log.info('hitl', 'Auto-send ' + delayLabel + ': ' + id + ' pour ' + (draft.replyData && draft.replyData.from) + ' (grounded=' + isGrounded + ')');
        _hitlSendReply(ADMIN_CHAT_ID, id).then(() => {
          sendMessage(ADMIN_CHAT_ID, '⚡ *Auto-envoi ' + delayLabel + '* — Reponse envoyee a *' + escTg(draft.replyData.fromName || draft.replyData.from) + '*\n_Aucune action recue dans le delai._', 'Markdown').catch(() => {});
        }).catch(e => {
          log.error('hitl', 'Auto-send echoue pour ' + id + ': ' + e.message);
        });
      }
    } else if (isGrounded && age > HITL_REMINDER_GROUNDED && !draft._reminded) {
      // Rappel 2 min avant auto-send (grounded seulement)
      draft._reminded = true;
      const secsLeft = Math.max(0, Math.round((autoSendDelay - age) / 1000));
      const sentimentLabel = draft.sentiment === 'interested' ? '🔥 INTERESSE' : draft.sentiment === 'question' ? '❓ Question' : '💬 Objection';
      sendMessage(ADMIN_CHAT_ID, '⏳ ' + sentimentLabel + ' de *' + escTg(draft.replyData.fromName || draft.replyData.from) + '* — envoi auto dans ~' + Math.ceil(secsLeft / 60) + ' min\n_\\[🛑 Annuler\\] ou \\[✏️ Modifier\\] dans le message original_', 'Markdown').catch(() => {});
    }
  }

  // 8. HITL modify states orphelins (10 min)
  for (const [cid, info] of _hitlModifyState) {
    if (now - (info.ts || 0) > 10 * 60 * 1000) {
      _hitlModifyState.delete(cid);
      cleaned++;
    }
  }

  if (cleaned > 0) log.info('router', 'Nettoyage memoire: ' + cleaned + ' entree(s) expiree(s)');
}, 60 * 60 * 1000);

// (isRateLimited, addToHistory, getHistoryContext extraits dans user-context.js)

// --- Modeles IA multi-niveaux ---
// GPT-4o-mini  : NLP rapide (classification, routage)
// Sonnet 4.5   : Redaction, conversation, humanisation
// Opus 4.6     : Rapports strategiques (hebdo/mensuel)

async function callOpenAINLP(systemPrompt, userMessage, maxTokens) {
  const result = await callOpenAI(OPENAI_KEY, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ], { maxTokens: maxTokens || 30 });
  // Budget tracking (input/output separes)
  if (result.usage) {
    appConfig.recordApiSpend('gpt-4o-mini', result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
  }
  return result.content;
}

function _callClaudeOnce(systemPrompt, userMessage, maxTokens, model) {
  maxTokens = maxTokens || 800;
  model = model || 'claude-sonnet-4-6';
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      agent: httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.content && response.content[0]) {
            // Budget tracking — input/output separes (inclut cache hits)
            if (response.usage) {
              const inputTokens = (response.usage.input_tokens || 0);
              const outputTokens = (response.usage.output_tokens || 0);
              const cached = response.usage.cache_read_input_tokens || 0;
              if (cached > 0) log.info('claude', 'Cache hit: ' + cached + ' tokens caches (' + model + ')');
              appConfig.recordApiSpend(model, inputTokens, outputTokens);
            }
            resolve(response.content[0].text.trim());
          } else {
            reject(new Error('Reponse Claude invalide: ' + JSON.stringify(response).substring(0, 200)));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout Claude (120s)')); });
    req.write(postData);
    req.end();
  });
}

function callClaude(systemPrompt, userMessage, maxTokens, model) {
  // Budget guard : bloquer si budget depasse
  appConfig.assertBudgetAvailable();
  const breakerName = model === 'claude-opus-4-6' ? 'claude-opus' : 'claude-sonnet';
  const breaker = getBreaker(breakerName, { failureThreshold: 5, cooldownMs: 30000 });
  return breaker.call(() => retryAsync(() => _callClaudeOnce(systemPrompt, userMessage, maxTokens, model), 4, 3000));
}

// --- Proactive Agent ---

function callClaudeOpus(systemPrompt, userMessage, maxTokens) {
  return callClaude(systemPrompt, userMessage, maxTokens, 'claude-opus-4-6');
}

const proactiveEngine = new ProactiveEngine({
  sendTelegram: async (chatId, message, priority) => {
    if (!appConfig.canSendAutoMessage(priority)) {
      log.info('quiet', 'Message proactive-agent supprime (mode quiet)');
      return;
    }
    await sendMessage(chatId, message, 'Markdown');
    addToHistory(chatId, 'bot', message.substring(0, 200), 'proactive-agent');
  },
  sendTelegramButtons: sendMessageWithButtons,
  callClaude: callClaude,
  callClaudeOpus: callClaudeOpus,
  hubspotKey: HUBSPOT_KEY,
  resendKey: RESEND_KEY,
  senderEmail: SENDER_EMAIL
});

const proactiveHandler = new ProactiveHandler(OPENAI_KEY, proactiveEngine);

// Self-Improve handler (avec callback Telegram + historique)
selfImproveHandler = new SelfImproveHandler(OPENAI_KEY, CLAUDE_KEY, async (chatId, message) => {
  await sendMessage(chatId, message, 'Markdown');
  addToHistory(chatId, 'bot', message.substring(0, 200), 'self-improve');
});

// Web Intelligence handler (avec callback Telegram + historique + quiet mode)
const webIntelHandler = new WebIntelligenceHandler(OPENAI_KEY, CLAUDE_KEY, async (chatId, message, priority) => {
  if (!appConfig.canSendAutoMessage(priority)) {
    log.info('quiet', 'Message web-intelligence supprime (mode quiet)');
    return;
  }
  await sendMessage(chatId, message, 'Markdown');
  addToHistory(chatId, 'bot', message.substring(0, 200), 'web-intelligence');
});

// System Advisor handler (avec callback Telegram + historique + quiet mode)
const systemAdvisorHandler = new SystemAdvisorHandler(OPENAI_KEY, CLAUDE_KEY, async (chatId, message, priority) => {
  if (!appConfig.canSendAutoMessage(priority)) {
    log.info('quiet', 'Message system-advisor supprime (mode quiet)');
    return;
  }
  await sendMessage(chatId, message, 'Markdown');
  addToHistory(chatId, 'bot', message.substring(0, 200), 'system-advisor');
});

// Autonomous Pilot handler + brain engine
const autoPilotHandler = new AutonomousHandler(OPENAI_KEY, CLAUDE_KEY);
const autoPilotEngine = new BrainEngine({
  sendTelegram: async (chatId, message) => {
    await sendMessage(chatId, message, 'Markdown');
    addToHistory(chatId, 'bot', message.substring(0, 200), 'autonomous-pilot');
  },
  sendTelegramButtons: sendMessageWithButtons,
  callClaude: callClaude,
  callClaudeOpus: callClaudeOpus,
  hubspotKey: HUBSPOT_KEY,
  apolloKey: APOLLO_KEY,
  openaiKey: OPENAI_KEY,
  claudeKey: CLAUDE_KEY,
  resendKey: RESEND_KEY,
  senderEmail: SENDER_EMAIL,
  campaignEngine: automailerHandler.campaignEngine
});

// Inbox Listener IMAP — initialisation avec callbacks
const automailerStorageForInbox = require('../skills/automailer/storage.js');
if (!InboxListener) {
  log.warn('router', 'inbox-listener non disponible (imapflow manquant). Installer avec: docker exec moltbot-telegram-router-1 pnpm add -w imapflow');
}
// Multi-IMAP : créer un listener par boîte GMAIL_MAILBOXES (ou fallback IMAP_USER)
if (InboxListener) {
  const _imapSharedOpts = {
    adminChatId: ADMIN_CHAT_ID,
    sendTelegram: async (chatId, message) => {
      await sendMessage(chatId, message, 'Markdown');
      addToHistory(chatId, 'bot', message.substring(0, 200), 'inbox-manager');
    },
    getKnownLeads: () => {
      try {
        const amData = automailerStorageForInbox.data || {};
        const emails = amData.emails || [];
        return emails.map(e => ({ email: e.to, to: e.to, name: e.toName || '', campaignId: e.campaignId || null }));
      } catch (e) { return []; }
    },
    onReplyDetected: createReplyPipeline({
      openaiKey: OPENAI_KEY, callClaude, escTg,
      automailerStorage: automailerStorageForInbox, getHubSpotClient: _getHubSpotClient,
      sendMessage, sendMessageWithButtons, adminChatId: ADMIN_CHAT_ID,
      meetingHandler,
      getPendingDrafts: () => _pendingDrafts, hitlId: _hitlId, saveHitlDrafts: _saveHitlDrafts,
      resendKey: RESEND_KEY, senderEmail: SENDER_EMAIL
    }),
    onBounceDetected: (email, bounceType) => {
      try {
        if (bounceType === 'hard') {
          automailerStorageForInbox.addToBlacklist(email, 'imap_hard_bounce');
          log.info('inbox-manager', 'Hard bounce IMAP: ' + email + ' blackliste');
        }
        const emails = (automailerStorageForInbox.data.emails || [])
          .filter(e => (e.to || '').toLowerCase() === email.toLowerCase());
        for (const em of emails) {
          if (em.status !== 'replied') {
            em.status = 'bounced';
            em.bounceType = bounceType;
            em.bouncedAt = new Date().toISOString();
          }
        }
        automailerStorageForInbox.save();
      } catch (e) { log.warn('inbox-manager', 'Erreur maj bounce: ' + e.message); }
    }
  };
  // IMAP_MAILBOXES=user1:pass1,user2:pass2 — multi-inbox monitoring
  // Si absent, fallback sur IMAP_USER/IMAP_PASS (single inbox)
  const imapMailboxesEnv = (process.env.IMAP_MAILBOXES || '').trim();
  if (imapMailboxesEnv) {
    for (const entry of imapMailboxesEnv.split(',')) {
      const parts = entry.trim().split(':');
      const user = parts[0];
      const pass = parts.slice(1).join(':');
      if (user && pass) {
        inboxListeners.push(new InboxListener({
          ..._imapSharedOpts,
          imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
          imapPort: parseInt(process.env.IMAP_PORT) || 993,
          imapUser: user.trim(),
          imapPass: pass.trim()
        }));
      }
    }
  }
  // Fallback : single-IMAP (IMAP_USER/IMAP_PASS)
  if (inboxListeners.length === 0 && IMAP_USER && IMAP_PASS) {
    inboxListeners.push(new InboxListener({
      ..._imapSharedOpts,
      imapHost: IMAP_HOST, imapPort: IMAP_PORT,
      imapUser: IMAP_USER, imapPass: IMAP_PASS
    }));
  }
}

// Demarrer tous les listeners IMAP
for (const listener of inboxListeners) {
  if (listener.isConfigured()) {
    listener.start().catch(e => log.error('router', 'Erreur demarrage IMAP ' + (listener.user || '') + ':', e.message));
  }
}

// Storages des skills a crons (pour toggle config.enabled)
const proactiveAgentStorage = require('../skills/proactive-agent/storage.js');
const selfImproveStorage = require('../skills/self-improve/storage.js');
const webIntelStorage = require('../skills/web-intelligence/storage.js');
const systemAdvisorStorage = require('../skills/system-advisor/storage.js');
const autonomousPilotStorage = require('../skills/autonomous-pilot/storage.js');
let flowFastStorageRouter = null;
try { flowFastStorageRouter = require('../skills/flowfast/storage.js'); } catch (e) { log.warn('router', 'FlowFast storage unavailable: ' + e.message); }
let leadEnrichStorageRouter = null;
try { leadEnrichStorageRouter = require('../skills/lead-enrich/storage.js'); } catch (e) { log.warn('router', 'LeadEnrich storage unavailable: ' + e.message); }

// Helper : enrichir un contact avec organization depuis lead-enrich (pour ProspectResearcher)
function _enrichContactWithOrg(email, contactName, company, title) {
  const contact = { email: email, nom: contactName || '', entreprise: company || '', titre: title || '' };
  try {
    if (leadEnrichStorageRouter && leadEnrichStorageRouter.data) {
      const enrichedLeads = leadEnrichStorageRouter.data.enrichedLeads || {};
      const enriched = enrichedLeads[email] || enrichedLeads[(email || '').toLowerCase()];
      if (enriched) {
        const org = (enriched.enrichData && enriched.enrichData.organization) || (enriched.apolloData && enriched.apolloData.organization) || null;
        if (org) contact.organization = org;
        if (!contact.titre) {
          const person = (enriched.enrichData && enriched.enrichData.person) || (enriched.apolloData && enriched.apolloData.person) || {};
          if (person.title) contact.titre = person.title;
        }
      }
    }
  } catch (e) { log.warn('router', 'Build contact context: ' + e.message); }
  return contact;
}

// --- Cron Manager (module extrait) ---
// Note : _getHubSpotClient est defini plus bas, on passe une closure pour resolution lazy
const cronManager = createCronManager({
  engines: { proactiveEngine, autoPilotEngine },
  handlers: { selfImproveHandler, webIntelHandler, systemAdvisorHandler, automailerHandler, meetingHandler },
  storages: { proactiveAgentStorage, selfImproveStorage, webIntelStorage, systemAdvisorStorage, autonomousPilotStorage },
  sendMessage,
  _getHubSpotClient: () => _getHubSpotClient(),
  ADMIN_CHAT_ID
});
const { startAllCrons, stopAllCrons } = cronManager;

// Restaurer l'etat volatile (bans + historique) depuis le disque
_loadVolatileState();

// Demarrage conditionnel selon le mode persiste
if (appConfig.isProduction()) {
  startAllCrons();
} else {
  log.info('router', 'Mode STANDBY — crons desactives, zero token auto');
}

// Budget : notification + arret crons si depasse
appConfig.onBudgetExceeded(async (budget) => {
  const msg = '⚠️ *Budget API journalier depasse*\n\n' +
    'Limite : $' + budget.dailyLimit.toFixed(2) + '\n' +
    'Depense : $' + budget.todaySpent.toFixed(4) + '\n\n' +
    'Actions automatiques suspendues. Les commandes manuelles restent actives.';
  try {
    await sendMessage(ADMIN_CHAT_ID, msg, 'Markdown');
  } catch (e) {
    log.error('router', 'Erreur notification budget:', e.message);
  }
  stopAllCrons();
  appConfig.deactivateAll();
});

// --- Statut systeme ---

function buildSystemStatus() {
  const config = appConfig.getConfig();
  const mode = config.mode;
  const modeEmoji = mode === 'production' ? '🟢' : '🔴';
  const modeLabel = mode === 'production' ? 'PRODUCTION' : 'STAND-BY';

  const apiKeys = [
    { name: 'Telegram', key: TOKEN },
    { name: 'OpenAI (NLP)', key: OPENAI_KEY },
    { name: 'Claude (Anthropic)', key: CLAUDE_KEY },
    { name: 'HubSpot (CRM)', key: HUBSPOT_KEY },
    { name: 'Apollo (Recherche leads)', key: APOLLO_KEY },
    { name: 'Resend (Emails)', key: RESEND_KEY }
  ];

  const emailSafe = SENDER_EMAIL && SENDER_EMAIL !== 'onboarding@resend.dev' && SENDER_EMAIL.trim() !== '';
  const apolloOk = APOLLO_KEY && APOLLO_KEY.trim() !== '';

  const cronCounts = {
    'Proactive Agent': proactiveEngine.crons ? proactiveEngine.crons.length : 0,
    'Web Intelligence': webIntelHandler.crons ? webIntelHandler.crons.length : 0,
    'System Advisor': systemAdvisorHandler.crons ? systemAdvisorHandler.crons.length : 0,
    'Self-Improve': selfImproveHandler && selfImproveHandler.crons ? selfImproveHandler.crons.length : 0,
    'Autonomous Pilot': autoPilotEngine.crons ? autoPilotEngine.crons.length : 0
  };

  const totalCrons = Object.values(cronCounts).reduce((a, b) => a + b, 0);

  const lines = [
    modeEmoji + ' *' + (process.env.CLIENT_NAME || 'iFIND') + ' — ' + modeLabel + '*',
    '_Derniere bascule : ' + new Date(config.lastModeChange).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + '_',
    ''
  ];

  // Crons
  lines.push('*Crons (' + totalCrons + '/17 actifs) :*');
  for (const [name, count] of Object.entries(cronCounts)) {
    const emoji = count > 0 ? '🟢' : '⏸️';
    lines.push('  ' + emoji + ' ' + name + ' : ' + count + ' cron(s)');
  }

  // Skills sans crons
  lines.push('');
  lines.push('*Skills manuelles :*');
  const manualSkills = ['AutoMailer', 'CRM Pilot', 'Content Gen', 'Invoice Bot'];
  for (const name of manualSkills) {
    lines.push('  🟢 ' + name);
  }

  // APIs
  lines.push('');
  lines.push('*APIs :*');
  for (const api of apiKeys) {
    const ok = api.key && api.key.trim() !== '';
    lines.push('  ' + (ok ? '✅' : '⚠️ MANQUANTE') + ' ' + api.name);
  }

  // Securites
  lines.push('');
  lines.push('*Securites :*');
  lines.push('  Email : ' + (emailSafe ? '✅ Configure' : '⚠️ Non configure (test only)'));
  lines.push('  Apollo : ' + (apolloOk ? '✅ Active (recherche)' : '⚠️ Cle absente'));

  // Budget
  const budget = appConfig.getBudgetStatus();
  const budgetPct = budget.dailyLimit > 0 ? Math.round((budget.todaySpent / budget.dailyLimit) * 100) : 0;
  lines.push('');
  lines.push('*Budget API ($' + budget.dailyLimit.toFixed(2) + '/jour) :*');
  lines.push('  Aujourd\'hui : $' + budget.todaySpent.toFixed(4) + ' (' + budgetPct + '%)');
  if (appConfig.isBudgetExceeded()) {
    lines.push('  ⚠️ *BUDGET DEPASSE — actions auto suspendues*');
  }

  lines.push('');
  if (mode === 'standby') {
    lines.push('_Dis "active tout" ou "lance la machine" pour passer en production_');
  } else {
    lines.push('_Dis "desactive tout" ou "mode stand by" pour couper les crons_');
  }

  return lines.join('\n');
}

// Etat par utilisateur : quel skill est actif
const userActiveSkill = {};
const userActiveSkillTime = {};

// (fastClassify, classifySkill, checkStickiness extraits dans skill-router.js)
// Wrapper classifySkill pour injecter les dependances locales
async function _classifySkill(message, chatId) {
  return classifySkill(message, chatId, {
    callOpenAINLP,
    getHistoryContext,
    userActiveSkill,
    handlers: {
      automailerHandler, crmPilotHandler, invoiceBotHandler,
      proactiveHandler, selfImproveHandler, webIntelHandler,
      systemAdvisorHandler, inboxHandler, meetingHandler
    }
  });
}
// Wrapper checkStickiness pour injecter l'etat local
function _checkStickiness(chatId, text) {
  return checkStickiness(chatId, text, { userActiveSkill, userActiveSkillTime });
}

// --- Humanisation des reponses ---

async function humanizeResponse(rawContent, userMessage, skill) {
  // Ne pas humaniser les reponses courtes (confirmations, erreurs simples)
  if (!rawContent || rawContent.length < 80) return rawContent;

  // Ne pas humaniser les messages de chargement intermediaires
  if (rawContent.startsWith('🔍 _') || rawContent.startsWith('✍️ _') || rawContent.startsWith('📧 _') || rawContent.startsWith('🚀 _')) return rawContent;

  const systemPrompt = `Tu es ${process.env.CLIENT_NAME || 'iFIND'}, un assistant Telegram sympa et decontracte qui parle comme un pote professionnel.
On te donne une reponse brute generee par un de tes modules. Reformule-la en langage naturel et conversationnel.

REGLES STRICTES :
- Parle comme un assistant cool et bienveillant, PAS comme un robot. Tutoie l'utilisateur.
- Commence par une petite phrase d'accroche naturelle en rapport avec la demande
- GARDE toutes les donnees importantes (noms, emails, chiffres, numeros, dates, montants)
- Si c'est une longue liste, fais un RESUME intelligent (les plus pertinents + un resume du reste) au lieu de tout lister betement
- Garde un minimum de structure pour la lisibilite (retours a la ligne) mais evite les gros blocs formattes
- Utilise les emojis avec parcimonie (1-3 max, pas un par ligne)
- Sois concis mais chaleureux
- Si les donnees sont vides, nulles ou pas utiles (N/A partout), dis-le honnetement et propose une action constructive
- Format Markdown Telegram : *gras*, _italique_ (pas de ** ni de __)
- NE COMMENCE JAMAIS par un titre en majuscules ou un separateur
- NE REPETE PAS le message de l'utilisateur`;

  try {
    const result = await callClaude(systemPrompt,
      'MESSAGE UTILISATEUR: ' + userMessage + '\n\nREPONSE BRUTE DU MODULE ' + skill.toUpperCase() + ':\n' + rawContent.substring(0, 2000),
      1500);
    return result || rawContent;
  } catch (e) {
    log.warn('router', 'Erreur humanisation:', e.message);
    return rawContent;
  }
}

// --- Assistant IA Business (general) ---

async function generateBusinessResponse(userMessage, chatId) {
  const historyContext = getHistoryContext(chatId);
  const textLower = userMessage.toLowerCase().trim();

  // /start ou /aide explicite → menu d'aide
  if (textLower === '/start' || textLower === '/aide' || textLower === 'aide' || textLower === 'help') {
    return [
      'Salut ! 👋 Je suis ton assistant business. Voila ce que je peux faire :\n',
      '🎯 *Prospection* — _"trouve-moi des CEO dans la tech a Paris"_',
      '📧 *Emails* — _"lance une campagne pour mes prospects"_',
      '📊 *CRM* — _"comment va mon pipeline ?"_',
      '🔍 *Enrichissement* — _"dis-moi tout sur jean@example.com"_',
      '✍️ *Contenu* — _"ecris-moi un post LinkedIn sur l\'IA"_',
      '🧾 *Facturation* — _"j\'ai besoin de facturer un client"_',
      '🔔 *Rapports auto* — _"rapport maintenant"_',
      '🧠 *Optimisation* — _"tes recommandations"_',
      '🌐 *Veille web* — _"surveille un concurrent"_',
      '⚙️ *Systeme* — _"status systeme"_',
      '🧠 *Pilot autonome* — _"statut pilot" ou "objectifs"_',
      '📬 *Inbox* — _"reponses recues" ou "emails entrants"_',
      '📅 *Meetings* — _"propose un rdv a jean@example.com"_',
      '\nMais tu peux aussi me poser n\'importe quelle question business — strategie, conseils, idees. Parle-moi naturellement !'
    ].join('\n');
  }

  // Appel Claude pour une vraie reponse conversationnelle
  const systemPrompt = `Tu es ${process.env.CLIENT_NAME || 'iFIND'}, l'assistant business IA personnel de ${process.env.DASHBOARD_OWNER || 'ton client'}. Tu es un expert en strategie commerciale B2B, marketing digital, vente et entrepreneuriat.

TON STYLE :
- Tu parles comme un pote entrepreneur qui s'y connait — decontracte, direct, bienveillant
- Tu tutoies toujours. Tu es franc et honnete, pas corporate
- Tu donnes des VRAIS conseils actionnables, pas du blabla generique
- Tu peux parler strategie, marketing, vente, pricing, pitch, negociation, growth, etc.
- Si la question concerne quelque chose que tu peux faire avec tes outils (prospection, email, CRM, veille, facturation, contenu), propose naturellement de le faire
- Format Markdown Telegram : *gras*, _italique_. Pas de ** ni __
- Reponses concises mais utiles (max 15 lignes). Pas de pavé.
- 1-2 emojis max, pas un par ligne
- Si l'utilisateur reagit a des messages que tu as envoyes (alertes, rapports), reponds en rapport avec CE CONTEXTE

TES OUTILS (mentionne-les naturellement si pertinent) :
- Prospection de leads B2B (recherche par poste, secteur, ville)
- Campagnes email automatisees (envoi, suivi ouvertures, relances)
- CRM HubSpot (pipeline, deals, contacts, notes)
- Enrichissement de leads (Apollo + verification SMTP)
- Generation de contenu (LinkedIn, pitch, email, bio, script)
- Facturation (creation, envoi, suivi paiements)
- Veille web (surveillance concurrents, prospects, actualites secteur)
- Rapports automatiques et alertes business
- Monitoring et optimisation continue

NE FAIS PAS :
- Ne liste pas tes fonctionnalites a moins qu'on te le demande explicitement
- Ne commence pas par "En tant qu'assistant..." ou des formules IA generiques
- Ne dis pas "je ne suis qu'une IA" — tu es un assistant business, point`;

  const userContent = historyContext
    ? 'CONTEXTE DES DERNIERS ECHANGES :\n' + historyContext + '\n\nNOUVEAU MESSAGE DE ' + (process.env.SENDER_NAME || 'ALEXIS').toUpperCase() + ' : ' + userMessage
    : userMessage;

  try {
    const result = await callClaude(systemPrompt, userContent, 800);
    return result || 'Hmm, j\'ai eu un souci. Reformule ta question ?';
  } catch (e) {
    log.warn('router', 'Erreur reponse business:', e.message);
    return 'Oups, petit bug de mon cote. Reessaie !';
  }
}

// --- Traitement des messages ---

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  // Gestion des médias : répondre au lieu d'ignorer silencieusement
  if (!msg.text) {
    const chatId = msg.chat.id;
    const mediaType = msg.photo ? 'photo' : msg.document ? 'document' : msg.voice ? 'message vocal' : msg.video ? 'vidéo' : msg.sticker ? 'sticker' : null;
    if (mediaType && String(chatId) === String(process.env.ADMIN_CHAT_ID)) {
      await sendMessage(chatId, `J'ai bien reçu ton ${mediaType}, mais je ne traite que le texte pour l'instant. Décris-moi ta demande par écrit et je m'en occupe.`);
    }
    return;
  }

  const chatId = msg.chat.id;
  let text = (msg.text || '').trim();
  const userName = msg.from.first_name || 'Utilisateur';

  // FIX 19 : Validation messages vides ou undefined
  if (!text || text.length === 0) return;

  // FIX 19 : Tronquer les messages tres longs (> 4000 chars) avant traitement NLP
  if (text.length > 4000) {
    log.warn('router', 'Message tronque de ' + text.length + ' a 4000 chars (user ' + chatId + ')');
    text = text.substring(0, 4000);
  }

  // Rate limiting : max 10 messages / 30s par utilisateur
  if (isRateLimited(chatId)) return;

  // Enregistrer l'utilisateur dans les deux storages
  log.info('router', userName + ' (' + chatId + '): ' + text.substring(0, 100));
  await sendTyping(chatId);

  // Sauvegarder le message dans l'historique
  addToHistory(chatId, 'user', text, null);

  // === HITL : intercepter le texte de modification si en attente ===
  const _hitlPending = _hitlModifyState.get(String(chatId));
  if (_hitlPending && _hitlPending.draftId) {
    _hitlModifyState.delete(String(chatId));
    const draft = _pendingDrafts.get(_hitlPending.draftId);
    if (!draft) {
      await sendMessage(chatId, '⚠️ Brouillon expire ou introuvable.');
      return;
    }
    // Quality gate sur le texte modifié
    const _qIssues = [];
    if (text.trim().length < 20) _qIssues.push('Message trop court (<20 caracteres)');
    const _clientDomain = (process.env.CLIENT_DOMAIN || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const _safeDomains = new RegExp('https?:\\/\\/(?:' + (_clientDomain || 'x-no-match') + '|calendly\\.com|cal\\.com)', 'i');
    if (/https?:\/\/[^\s]+/i.test(text) && !_safeDomains.test(text)) _qIssues.push('Lien externe suspect detecte');
    const _spamWords = ['gratuit', 'promotion', 'cliquez ici', 'offre exclusive', 'urgent', 'act now', 'free trial'];
    const _tLow = text.toLowerCase();
    for (const sw of _spamWords) { if (_tLow.includes(sw)) { _qIssues.push('Mot spam detecte: ' + sw); break; } }
    if (_qIssues.length > 0) {
      log.warn('hitl', 'Quality warning on modified draft ' + _hitlPending.draftId + ': ' + _qIssues.join(', '));
      await sendMessage(chatId, '⚠️ *Attention qualite :*\n' + _qIssues.map(q => '• ' + q).join('\n') + '\n\n_Envoi quand meme..._', 'Markdown');
    }
    // Utiliser le texte de l'utilisateur comme nouveau body
    draft.autoReply.body = text;
    log.info('hitl', 'Draft modifie par utilisateur: ' + _hitlPending.draftId + ' pour ' + draft.replyData.from);
    await _hitlSendReply(chatId, _hitlPending.draftId);
    return;
  }

  const sendReply = async (reply) => {
    await sendMessage(chatId, reply.content, 'Markdown');
  };

  // ========== COMMANDES DE CONTROLE (avant NLP, zero token) ==========
  const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const activateAliases = ['active tout', 'lance la machine', 'mode production', 'demarre tout'];
  const deactivateAliases = ['desactive tout', 'mode stand by', 'mode standby', 'stoppe tout', 'arrete tout'];
  const statusAliases = ['statut systeme', 'statut système', 'status systeme', 'status système', 'status moltbot', 'status ifind', 'etat du systeme'];

  if (activateAliases.some(a => textLower === a)) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) {
      await sendMessage(chatId, '⛔ Seul l\'administrateur peut utiliser cette commande.');
      return;
    }
    appConfig.activateAll();
    startAllCrons();
    const reply = [
      '🟢 *Mode PRODUCTION active !*',
      '',
      'Tous les crons sont lances :',
      '  - Proactive Agent : 6 crons',
      '  - Web Intelligence : 3 crons',
      '  - System Advisor : 4 crons',
      '  - Self-Improve : 1 cron',
      '  - Autonomous Pilot : 3 crons',
      '',
      'Le bot travaille maintenant en autonomie.',
      '_Dis "statut systeme" pour voir le detail._'
    ].join('\n');
    addToHistory(chatId, 'bot', 'Mode production active', 'system');
    await sendMessage(chatId, reply, 'Markdown');
    return;
  }

  if (deactivateAliases.some(a => textLower === a)) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) {
      await sendMessage(chatId, '⛔ Seul l\'administrateur peut utiliser cette commande.');
      return;
    }
    appConfig.deactivateAll();
    stopAllCrons();
    const reply = [
      '🔴 *Mode STAND-BY active*',
      '',
      'Tous les crons sont stoppes.',
      'Zero consommation API automatique.',
      '',
      'Je reste disponible quand tu me parles.',
      '_Dis "active tout" ou "lance la machine" pour relancer._'
    ].join('\n');
    addToHistory(chatId, 'bot', 'Mode standby active', 'system');
    await sendMessage(chatId, reply, 'Markdown');
    return;
  }

  if (statusAliases.some(a => textLower === a || textLower.replace(/[\u0300-\u036f]/g, '') === a)) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) {
      await sendMessage(chatId, 'Seul l\'administrateur peut voir le statut systeme.');
      return;
    }
    const statusMsg = buildSystemStatus();
    addToHistory(chatId, 'bot', 'Statut systeme', 'system');
    await sendMessage(chatId, statusMsg, 'Markdown');
    return;
  }

  // Mode quiet (limite les messages auto)
  const quietOnAliases = ['mode quiet', 'mode silencieux', 'moins de messages', 'trop de messages'];
  const quietOffAliases = ['mode normal', 'desactive quiet', 'tous les messages'];
  if (quietOnAliases.some(a => textLower.includes(a))) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) {
      await sendMessage(chatId, '⛔ Seul l\'administrateur peut utiliser cette commande.');
      return;
    }
    appConfig.setQuietMode(true);
    await sendMessage(chatId, '🤫 *Mode quiet active*\n\nJe limite mes messages auto a 3 par jour maximum.\nLes alertes critiques passent toujours.\nTous les rapports restent disponibles dans le dashboard.\n\n_Dis "mode normal" pour tout reactiver._', 'Markdown');
    addToHistory(chatId, 'bot', 'Mode quiet active', 'system');
    return;
  }
  if (quietOffAliases.some(a => textLower.includes(a))) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) {
      await sendMessage(chatId, '⛔ Seul l\'administrateur peut utiliser cette commande.');
      return;
    }
    appConfig.setQuietMode(false);
    await sendMessage(chatId, '🔔 *Mode normal active*\n\nTous les rapports et alertes Telegram sont reactives.', 'Markdown');
    addToHistory(chatId, 'bot', 'Mode normal active', 'system');
    return;
  }
  // ========== FIN COMMANDES DE CONTROLE ==========

  try {
    // Determiner le skill : stickiness > fast classify > NLP fallback
    const textForNLP = truncateInput(text, 2000);
    let skill = _checkStickiness(chatId, textForNLP);
    if (skill) {
      log.info('router', 'Stickiness: ' + skill + ' pour: "' + text.substring(0, 50) + '"');
    }
    if (!skill) {
      skill = fastClassify(textForNLP);
      if (skill) {
        global.__ifindMetrics.fastClassifyHits++;
        log.info('router', 'FastClassify: ' + skill + ' pour: "' + text.substring(0, 50) + '"');
      }
    }
    if (!skill) {
      // Fallback NLP seulement si ni stickiness ni fast classify ne trouvent rien
      skill = await _classifySkill(textForNLP, chatId);
      global.__ifindMetrics.nlpFallbacks++;
      log.info('router', 'NLP classify: ' + skill + ' pour: "' + text.substring(0, 50) + '"');
    }
    userActiveSkill[String(chatId)] = skill;
    userActiveSkillTime[String(chatId)] = Date.now();

    // ===== GARDES DE SECURITE =====

    // Email : bloquer envoi si domaine non configure
    if (skill === 'automailer' || skill === 'invoice-bot') {
      const emailAction = textLower.match(/envo|campagne|lance.*mail|envoie|expedie/);
      if (emailAction && (!SENDER_EMAIL || SENDER_EMAIL === 'onboarding@resend.dev' || SENDER_EMAIL.trim() === '')) {
        const warning = [
          '⚠️ *Envoi email non disponible*',
          '',
          'Le domaine d\'envoi n\'est pas configure.',
          'Configure SENDER_EMAIL dans .env avec un vrai domaine Resend.',
          '',
          '_Tu peux creer des campagnes et gerer des contacts en attendant._'
        ].join('\n');
        addToHistory(chatId, 'bot', 'Email bloque - pas de domaine', skill);
        await sendMessage(chatId, warning, 'Markdown');
        return;
      }
    }


    // ===== FIN GARDES =====

    let response = null;

    const handlers = {
      'automailer': automailerHandler,
      'crm-pilot': crmPilotHandler,
      'invoice-bot': invoiceBotHandler,
      'proactive-agent': proactiveHandler,
      'self-improve': selfImproveHandler,
      'web-intelligence': webIntelHandler,
      'system-advisor': systemAdvisorHandler,
      'autonomous-pilot': autoPilotHandler,
      'inbox-manager': inboxHandler,
      'meeting-scheduler': meetingHandler
    };

    const handler = handlers[skill];
    if (handler) {
      const startTime = Date.now();
      const HANDLER_TIMEOUT = 60000;
      try {
        response = await Promise.race([
          handler.handleMessage(text, chatId, sendReply),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Handler timeout (' + skill + ') apres ' + (HANDLER_TIMEOUT / 1000) + 's')), HANDLER_TIMEOUT))
        ]);
        recordSkillUsage(skill);
        recordResponseTime(skill, Date.now() - startTime);

        // Autonomous Pilot : trigger brain cycle si demande
        if (skill === 'autonomous-pilot' && response && response._triggerBrainCycle) {
          autoPilotEngine._brainCycle().catch(e => log.error('router', 'Erreur brain cycle force:', e.message));
        }
      } catch (handlerError) {
        recordSkillUsage(skill);
        recordSkillError(skill, handlerError.message);
        recordResponseTime(skill, Date.now() - startTime);
        throw handlerError;
      }
    } else {
      // General : si Autonomous Pilot est actif, router vers lui pour une experience unifiee
      const apConfig = autoPilotHandler.claudeKey ? require('../skills/autonomous-pilot/storage.js').getConfig() : null;
      if (apConfig && apConfig.enabled && apConfig.businessContext) {
        skill = 'autonomous-pilot';
        log.info('router', 'Redirection general -> autonomous-pilot');
        const startTime = Date.now();
        try {
          response = await autoPilotHandler.handleMessage(text, chatId, sendReply);
          log.info('router', 'AP reponse recue (' + (response?.content?.length || 0) + ' chars)');
        } catch (apError) {
          log.error('router', 'Erreur AP handler:', apError.message);
          response = { type: 'text', content: '⚠️ Petit souci, reessaie !' };
        }
        recordSkillUsage(skill);
        recordResponseTime(skill, Date.now() - startTime);
        if (response && response._triggerBrainCycle) {
          autoPilotEngine._brainCycle().catch(e => log.error('router', 'Erreur brain cycle force:', e.message));
        }
      } else {
        const generalResponse = await generateBusinessResponse(text, chatId);
        response = { type: 'text', content: generalResponse };
      }
    }

    if (response && response.content) {
      let finalText = response.content;
      // --- UPGRADE 6 : Humanisation selective (economie de tokens) ---
      // Skills deja exclues : general, autonomous-pilot
      const skipHumanizationSkills = ['general', 'autonomous-pilot', 'system-advisor', 'proactive-agent', 'inbox-manager', 'meeting-scheduler'];
      let shouldHumanize = !skipHumanizationSkills.includes(skill);

      if (shouldHumanize) {
        // Skip si reponse courte (< 200 chars) — pas besoin d'humaniser
        if (finalText.length < 200) {
          shouldHumanize = false;
          log.info('router', 'Humanisation skip: reponse courte (' + finalText.length + ' chars)');
        }
      }

      if (shouldHumanize) {
        // Skip si deja conversationnel : contient des emojis ET du tutoiement (tu/te/ton/ta/tes)
        const hasEmojis = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(finalText);
        const hasTutoiement = /\b(tu |te |ton |ta |tes |t')\b/i.test(finalText);
        if (hasEmojis && hasTutoiement) {
          shouldHumanize = false;
          log.info('router', 'Humanisation skip: deja conversationnel (' + skill + ')');
        }
      }

      if (shouldHumanize) {
        global.__ifindMetrics.humanizationApplied++;
        finalText = await humanizeResponse(response.content, text, skill);
      } else {
        global.__ifindMetrics.humanizationSkipped++;
      }

      // Sauvegarder la reponse dans l'historique
      addToHistory(chatId, 'bot', finalText.substring(0, 200), skill);
      await sendMessage(chatId, finalText, 'Markdown');
    }
  } catch (error) {
    log.error('router', 'Erreur handleUpdate:', error.message);
    await sendMessage(chatId, '❌ Oups, une erreur est survenue. Reessaie !');
  }
}

// --- HITL : envoyer une reponse validee ou modifiee ---

async function _hitlSendReply(chatId, draftId) {
  const draft = _pendingDrafts.get(draftId);
  if (!draft) {
    await sendMessage(chatId, '⚠️ Brouillon expire ou introuvable (24h max).');
    return;
  }

  try {
    const ResendClient = require('../skills/automailer/resend-client.js');
    const resendClient = new ResendClient(RESEND_KEY, SENDER_EMAIL);

    const sendResult = await resendClient.sendEmail(
      draft.replyData.from,
      draft.autoReply.subject,
      draft.autoReply.body,
      {
        inReplyTo: draft.originalMessageId,
        references: draft.originalMessageId,
        fromName: draft.clientContext.senderName
      }
    );

    if (sendResult && sendResult.success) {
      // Incrementer warmup global
      if (automailerStorageForInbox.setFirstSendDate) automailerStorageForInbox.setFirstSendDate();
      automailerStorageForInbox.incrementTodaySendCount();

      // Tracker dans inbox-manager storage
      try {
        const inboxStorage = require('../skills/inbox-manager/storage.js');
        inboxStorage.addAutoReply({
          prospectEmail: draft.replyData.from,
          prospectName: draft.replyData.fromName,
          sentiment: draft.sentiment,
          subClassification: draft.subClass ? draft.subClass.type : 'hitl',
          objectionType: draft.subClass ? draft.subClass.objectionType : '',
          replyBody: draft.autoReply.body,
          replySubject: draft.autoReply.subject,
          originalEmailId: draft.originalEmail && draft.originalEmail.subject,
          confidence: draft.autoReply.confidence,
          sendResult: sendResult
        });
      } catch (e) { log.warn('hitl', 'Record auto-reply stats: ' + e.message); }

      // Stocker messageId pour threading futur
      if (sendResult.messageId) {
        automailerStorageForInbox.addEmail({
          to: draft.replyData.from,
          subject: draft.autoReply.subject,
          body: draft.autoReply.body,
          source: 'hitl_reply',
          status: 'sent',
          messageId: sendResult.messageId,
          chatId: ADMIN_CHAT_ID
        });
      }

      log.info('hitl', 'Reponse HITL envoyee a ' + draft.replyData.from + ' (sentiment=' + draft.sentiment + ')');
      await sendMessage(chatId, '✅ *Reponse envoyee !*\n\n📧 A : ' + escTg(draft.replyData.from) + '\n📋 Objet : _' + escTg(draft.autoReply.subject) + '_\n\n_' + escTg(draft.autoReply.body.substring(0, 300)) + '_', 'Markdown');
    } else {
      log.error('hitl', 'Echec envoi HITL pour ' + draft.replyData.from + ': ' + (sendResult && sendResult.error));
      draft._inFlight = false; // Reset pour permettre retry
      await sendMessage(chatId, '❌ Echec envoi email a ' + escTg(draft.replyData.from) + '\nErreur : ' + escTg((sendResult && sendResult.error) || 'Inconnue') + '\n_Clique Accepter pour retenter._');
      return; // Ne pas supprimer le draft, l'utilisateur peut retenter
    }
  } catch (e) {
    log.error('hitl', 'Erreur envoi HITL:', e.message);
    draft._inFlight = false; // Reset pour permettre retry
    await sendMessage(chatId, '❌ Erreur technique envoi : ' + escTg(e.message) + '\n_Clique Accepter pour retenter._');
    return;
  }

  // Nettoyage du draft apres envoi reussi
  _pendingDrafts.delete(draftId);
  _saveHitlDrafts();
}

// --- Callback queries (boutons) ---

async function handleCallback(update) {
  const cb = update.callback_query;
  if (!cb || !cb.data) return;

  const chatId = cb.message.chat.id;
  const data = cb.data;

  await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id }).catch(e => log.warn('router', 'answerCallbackQuery echoue:', e.message));

  // Router les callbacks par prefixe
  if (data.startsWith('ap_')) {
    // Autonomous Pilot callbacks (ap_approve_xxx, ap_reject_xxx)
    try {
      const result = await autoPilotEngine.handleConfirmation(data, chatId);
      if (result && result.content) {
        await sendMessage(chatId, result.content, 'Markdown');
        addToHistory(chatId, 'bot', result.content.substring(0, 200), 'autonomous-pilot');
      }
    } catch (e) {
      log.error('router', 'Erreur callback autonomous-pilot:', e.message);
      await sendMessage(chatId, '❌ Erreur traitement confirmation: ' + e.message);
    }
  } else if (data.startsWith('rpt_')) {
    // Report workflow callback (landing page prospect report)
    const prospectId = data.replace('rpt_', '');
    await sendMessage(chatId, '⏳ _Generation du rapport en cours... (1-2 min)_', 'Markdown');

    try {
      const prospectData = await fetchProspectData(prospectId);
      const result = await reportWorkflow.generateReport(prospectData);

      if (result.success) {
        const nbProspects = result.prospects ? result.prospects.length : 0;
        const summary = '✅ *Rapport termine pour ' + prospectData.prenom + '*\n\n' +
          '✍️ ' + nbProspects + ' email(s) personnalise(s) redige(s)\n' +
          (result.sent && result.sent.method === 'email'
            ? '📧 Envoye par email a ' + prospectData.email
            : '💾 Sauvegarde en fichier (domaine email non configure)');
        await sendMessage(chatId, summary, 'Markdown');

        // Enregistrer le prospect comme meeting "proposed" pour etre notifie si booking Cal.eu
        try {
          const meetingStorage = require('../skills/meeting-scheduler/storage.js');
          meetingStorage.createMeeting({
            leadEmail: prospectData.email,
            leadName: prospectData.prenom,
            company: prospectData.entreprise || '',
            bookingUrl: process.env.BOOKING_URL || process.env.GOOGLE_BOOKING_URL || '',
            duration: 15,
            notes: 'Audit pipeline gratuit — ' + nbProspects + ' email(s) envoye(s)'
          });
          log.info('router', 'Meeting proposed cree pour ' + prospectData.email + ' (audit)');
        } catch (e) {
          log.warn('router', 'Meeting proposed non cree:', e.message);
        }

        // Marquer le prospect comme traite via l'API landing
        try {
          await new Promise((resolve, reject) => {
            const req = require('http').request({
              hostname: 'landing-page', port: 3080,
              path: '/api/prospect/' + prospectId + '/status',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(b)); });
            req.on('error', reject);
            req.write(JSON.stringify({ status: 'completed' }));
            req.end();
          });
        } catch (e) { /* best effort */ }
      }
    } catch (e) {
      log.error('router', 'Erreur report workflow:', e.message);
      await sendMessage(chatId, '❌ Erreur rapport: ' + e.message);
    }
  } else if (data.startsWith('cancel_rfu_')) {
    // Annuler une relance reactive programmee
    const fuId = data.replace('cancel_rfu_', '');
    try {
      const result = proactiveAgentStorage.markFollowUpFailed(fuId, 'manual_cancel_telegram');
      if (result) {
        await sendMessage(chatId, '✅ Relance annulee pour *' + (result.prospectName || result.prospectEmail) + '*' + (result.prospectCompany ? ' (' + result.prospectCompany + ')' : ''), 'Markdown');
        log.info('router', 'Reactive FU annule manuellement via Telegram: ' + fuId + ' — ' + result.prospectEmail);
      } else {
        await sendMessage(chatId, '⚠️ Relance introuvable ou deja traitee.');
      }
    } catch (e) {
      log.error('router', 'Erreur annulation reactive FU:', e.message);
      await sendMessage(chatId, '❌ Erreur: ' + e.message);
    }
  } else if (data.startsWith('bl_prospect_')) {
    // Blacklister un prospect via bouton Telegram
    const prospectEmail = data.replace('bl_prospect_', '');
    try {
      automailerStorage.addToBlacklist(prospectEmail, 'manual_blacklist_telegram');
      // Marquer hasReplied=true sur TOUS les emails du prospect (bloque campagnes)
      const allEmails = automailerStorage.getEmailEventsForRecipient(prospectEmail);
      for (const em of allEmails) {
        if (em.id && !em.hasReplied) {
          automailerStorage.updateEmailStatus(em.id, em.status || 'sent', { hasReplied: true, blacklistedAt: new Date().toISOString() });
        }
      }
      // Annuler toutes les reactive FU pending pour ce prospect
      const pendingFUs = proactiveAgentStorage.getPendingFollowUps();
      let cancelled = 0;
      for (const fu of pendingFUs) {
        if (fu.prospectEmail && fu.prospectEmail.toLowerCase() === prospectEmail.toLowerCase()) {
          proactiveAgentStorage.markFollowUpFailed(fu.id, 'manual_blacklist_telegram');
          cancelled++;
        }
      }
      await sendMessage(chatId, '🚫 *' + prospectEmail + '* blackliste.\n' + (cancelled > 0 ? cancelled + ' relance(s) annulee(s).' : '') + '\n_Blacklist + campagnes stoppees. Plus aucun email ne sera envoye._', 'Markdown');
      log.info('router', 'Prospect blackliste via Telegram: ' + prospectEmail + ' (+ ' + cancelled + ' FU annulees)');
    } catch (e) {
      log.error('router', 'Erreur blacklist prospect:', e.message);
      await sendMessage(chatId, '❌ Erreur: ' + e.message);
    }
  } else if (data.startsWith('feedback_')) {
    const parts = data.split('_');
    const type = parts[1];
    const email = parts.slice(2).join('_');
    await sendMessage(chatId, type === 'positive' ? '👍 Merci pour le feedback !' : '👎 Note, je ferai mieux la prochaine fois !');
  }
  // === HITL : callbacks pour brouillons de reponses ===
  else if (data.startsWith('hitl_accept_')) {
    const draftId = data.replace('hitl_accept_', '');
    const draft = _pendingDrafts.get(draftId);
    if (!draft) { await sendMessage(chatId, '⚠️ Brouillon deja traite ou expire.'); return; }
    if (draft._inFlight) { await sendMessage(chatId, '⏳ Envoi deja en cours...'); return; }
    draft._inFlight = true;
    await _hitlSendReply(chatId, draftId);
  }
  else if (data.startsWith('hitl_modify_')) {
    const draftId = data.replace('hitl_modify_', '');
    const draft = _pendingDrafts.get(draftId);
    if (!draft) {
      await sendMessage(chatId, '⚠️ Brouillon expire ou introuvable.');
      return;
    }
    _hitlModifyState.set(String(chatId), { draftId, ts: Date.now() });
    await sendMessage(chatId, '✏️ *Mode modification*\n\nTape le nouveau texte de reponse.\nLe prochain message que tu envoies sera utilise comme corps de l\'email.\n\n_Brouillon actuel :_\n' + escTg(draft.autoReply.body.substring(0, 500)) + '\n\n_Envoie ton texte modifie :_', 'Markdown');
  }
  // === HITL : Passer (sans blacklist) — pour repondre manuellement ===
  else if (data.startsWith('hitl_skip_')) {
    const draftId = data.replace('hitl_skip_', '');
    const draft = _pendingDrafts.get(draftId);
    if (!draft) {
      await sendMessage(chatId, '⚠️ Brouillon deja traite ou expire.');
      return;
    }
    _pendingDrafts.delete(draftId);
    log.info('hitl', 'Draft passe (sans blacklist): ' + draftId + ' pour ' + draft.replyData.from);
    await sendMessage(chatId, '⏭️ Brouillon passe pour *' + escTg(draft.replyData.fromName || draft.replyData.from) + '*.\n_Prospect conserve dans le pipeline. Reponds-lui manuellement._', 'Markdown');
  }
  // === HITL : Blacklister (supprime prospect du pipeline) ===
  else if (data.startsWith('hitl_ignore_')) {
    const draftId = data.replace('hitl_ignore_', '');
    const draft = _pendingDrafts.get(draftId);
    if (!draft) {
      await sendMessage(chatId, '⚠️ Brouillon deja traite ou expire.');
      return;
    }
    _pendingDrafts.delete(draftId);

    // Blacklister le prospect
    try {
      for (const ep of (draft.emailsToProcess || [draft.replyData.from])) {
        automailerStorageForInbox.addToBlacklist(ep, 'hitl_blacklisted: explicit');
      }
    } catch (e) { log.warn('hitl', 'Blacklist: ' + e.message); }

    log.info('hitl', 'Draft blackliste: ' + draftId + ' pour ' + draft.replyData.from);
    await sendMessage(chatId, '🚫 *' + escTg(draft.replyData.fromName || draft.replyData.from) + '* blackliste.\n_Plus aucun email ne sera envoye a ce prospect._', 'Markdown');
  }
}

// --- Per-user queue (serialisation des messages, anti race condition) ---

const _userQueues = {};

function enqueueUpdate(update) {
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  if (!chatId) return;

  const id = String(chatId);
  const task = update.callback_query
    ? () => handleCallback(update)
    : () => handleUpdate(update);

  // Chainer les promesses par user : le message N+1 attend la fin du message N
  if (!_userQueues[id]) _userQueues[id] = Promise.resolve();
  _userQueues[id] = _userQueues[id]
    .then(task)
    .catch(e => log.error('router', 'Erreur message user ' + id + ':', e.message));
}

// --- Long polling ---

let _polling = true;

let _consecutiveErrors = 0;

async function poll() {
  while (_polling) {
    try {
      const result = await telegramAPI('getUpdates', {
        offset: offset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query']
      });

      _consecutiveErrors = 0; // Reset on success

      if (result.ok && result.result && result.result.length > 0) {
        for (const update of result.result) {
          offset = update.update_id + 1;
          enqueueUpdate(update);
        }
      }
    } catch (error) {
      _consecutiveErrors++;
      // Socket hang up = normal avec long polling, log seulement si repetitif
      if (_consecutiveErrors <= 3) {
        log.warn('router', 'Polling erreur (' + _consecutiveErrors + '/3): ' + error.message);
      } else if (_consecutiveErrors === 4) {
        log.error('router', 'Polling instable: ' + _consecutiveErrors + ' erreurs consecutives');
      }
      if (_polling) {
        // Backoff progressif : 1s, 2s, 4s, max 10s
        const backoff = Math.min(1000 * Math.pow(2, _consecutiveErrors - 1), 10000);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
}

// --- Demarrage ---

// --- Healthcheck HTTP + Webhook Resend (pour Docker) ---
const HEALTH_PORT = process.env.HEALTH_PORT || 9090;
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';
if (!WEBHOOK_SECRET) {
  log.error('webhook', 'RESEND_WEBHOOK_SECRET non configure — les webhooks Resend seront REJETES. Configurez-le dans .env.');
}
let _botReady = false;

// --- FIX 23 : Webhook Resend — reception temps reel des evenements email ---
const automailerStorage = require('../skills/automailer/storage.js');

// Cross-skill: acces au client HubSpot depuis le routeur (pour sync CRM webhook)
function _getHubSpotClient() {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) return null;
  try {
    const HubSpotClient = require('../skills/crm-pilot/hubspot-client.js');
    return new HubSpotClient(apiKey);
  } catch (e) {
    try {
      const HubSpotClient = require('/app/skills/crm-pilot/hubspot-client.js');
      return new HubSpotClient(apiKey);
    } catch (e2) {
      return null;
    }
  }
}

let ProspectResearcher;
try { ProspectResearcher = require('../skills/autonomous-pilot/prospect-researcher.js'); }
catch (e) { try { ProspectResearcher = require('/app/skills/autonomous-pilot/prospect-researcher.js'); } catch (e2) { ProspectResearcher = null; } }

// --- Resend Handler (module extrait) ---
const resendHandlerModule = createResendHandler({
  automailerStorage,
  proactiveAgentStorage,
  _getHubSpotClient,
  _enrichContactWithOrg,
  sendMessage,
  sendMessageWithButtons,
  ProspectResearcher,
  meetingHandler,
  automailerHandler,
  CLAUDE_KEY,
  REPLY_TO_EMAIL,
  ADMIN_CHAT_ID
});
const { handleResendWebhook } = resendHandlerModule;

// --- Unsubscribe Handler (module extrait) ---
const handleUnsubscribe = createUnsubscribeHandler({
  getAutomailerStorage: () => automailerStorage,
  sendTelegram: sendMessage,
  adminChatId: ADMIN_CHAT_ID
});

// --- HITL API (module extrait) ---
const handleHitlApi = createHitlApi({
  getPendingDrafts: () => _pendingDrafts,
  saveHitlDrafts: () => _saveHitlDrafts(),
  getAutomailerStorage: () => automailerStorageForInbox,
  getResendClient: () => {
    const ResendClient = require('../skills/automailer/resend-client.js');
    return new ResendClient(RESEND_KEY, SENDER_EMAIL);
  },
  adminChatId: ADMIN_CHAT_ID,
  getHitlAutoSendDelays: () => ({
    grounded: (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) * 60 * 1000,
    ungrounded: 24 * 60 * 60 * 1000
  })
});

// --- Email Tracking (module extrait) ---
const emailTracking = createEmailTracking({
  getAutomailerStorage: () => automailerStorage,
  getProactiveAgentStorage: () => proactiveAgentStorage,
  getFlowFastStorage: () => flowFastStorageRouter,
  getLeadEnrichStorage: () => leadEnrichStorageRouter,
  getHubSpotClient: _getHubSpotClient,
  getProspectResearcher: () => ProspectResearcher,
  enrichContactWithOrg: _enrichContactWithOrg,
  claudeKey: CLAUDE_KEY
});

// --- Chat API : bridge Dashboard → NLP pipeline ---
async function processChatMessage(text, userId) {
  const chatId = 'dashboard_' + (userId || 'admin');
  const CHAT_TIMEOUT = 45000;

  try {
    // 1. Classification NLP
    const skill = await _classifySkill(text, chatId);
    log.info('chat-api', 'Skill: ' + skill + ' pour: ' + text.substring(0, 60));

    // 2. Handlers (meme map que handleUpdate)
    const chatHandlers = {
      'automailer': automailerHandler,
      'crm-pilot': crmPilotHandler,
      'invoice-bot': invoiceBotHandler,
      'proactive-agent': proactiveHandler,
      'self-improve': selfImproveHandler,
      'web-intelligence': webIntelHandler,
      'system-advisor': systemAdvisorHandler,
      'autonomous-pilot': autoPilotHandler,
      'inbox-manager': inboxHandler,
      'meeting-scheduler': meetingHandler
    };

    let response = null;
    const handler = chatHandlers[skill];
    const noopReply = async () => {}; // pas de sendReply Telegram

    if (handler) {
      response = await Promise.race([
        handler.handleMessage(text, chatId, noopReply),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), CHAT_TIMEOUT))
      ]);
      recordSkillUsage(skill);
    } else {
      // General → Autonomous Pilot ou Claude
      const apConfig = autoPilotHandler.claudeKey ? require('../skills/autonomous-pilot/storage.js').getConfig() : null;
      if (apConfig && apConfig.enabled && apConfig.businessContext) {
        response = await autoPilotHandler.handleMessage(text, chatId, noopReply);
        recordSkillUsage('autonomous-pilot');
      } else {
        const generalText = await generateBusinessResponse(text, chatId);
        response = { type: 'text', content: generalText };
      }
    }

    const content = response?.content || 'Pas de reponse.';
    addToHistory(chatId, 'user', text.substring(0, 200), null);
    addToHistory(chatId, 'bot', content.substring(0, 200), skill);

    return { text: content, skill };
  } catch (err) {
    log.error('chat-api', 'Erreur: ' + err.message);
    return { text: 'Erreur: ' + err.message, skill: 'error' };
  }
}

const healthServer = http.createServer(async (req, res) => {
  // Chat API (auth via dashboard password)
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    req.on('data', (chunk) => { bodySize += chunk.length; if (bodySize > 10240) { req.destroy(); return; } body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        // Auth check
        const apiToken = (req.headers['x-api-token'] || req.headers['authorization'] || '').replace('Bearer ', '');
        if (!apiToken || (apiToken !== process.env.DASHBOARD_PASSWORD && apiToken !== process.env.AUTOMAILER_DASHBOARD_PASSWORD)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        if (!data.message || typeof data.message !== 'string' || data.message.length > 2000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message requis (max 2000 chars)' }));
          return;
        }
        const result = await processChatMessage(data.message.trim(), data.userId || 'admin');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- HITL API (module extrait) ---
  if (handleHitlApi(req, res)) return;

  // Healthcheck
  if (req.url === '/health' && req.method === 'GET') {
    if (_botReady && _polling) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), skills: 13, polling: _polling }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'starting', ready: _botReady, polling: _polling }));
    }
    return;
  }

  // Webhook Resend (signature Svix verifiee via module extrait)
  if (req.url && req.url.startsWith('/webhook/resend') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 100 * 1024;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on('end', async () => {
      if (bodySize > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        return;
      }

      const sigCheck = verifySvixSignature(req.headers, body, WEBHOOK_SECRET);
      if (!sigCheck.valid) {
        res.writeHead(sigCheck.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: sigCheck.error }));
        return;
      }

      try {
        const parsed = JSON.parse(body);
        const result = await handleResendWebhook(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        log.error('webhook', 'Erreur traitement webhook:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      }
    });
    return;
  }

  // === RGPD : Data Access (droit d'acces) ===
  if (req.url && req.url.startsWith('/api/rgpd/data-access') && req.method === 'GET') {
    const apiToken = (req.headers['x-api-token'] || req.headers['authorization'] || '').replace('Bearer ', '');
    if (!apiToken || (apiToken !== process.env.DASHBOARD_PASSWORD && apiToken !== process.env.AUTOMAILER_DASHBOARD_PASSWORD)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const urlObj = new URL(req.url, 'http://localhost');
    const email = (urlObj.searchParams.get('email') || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'email requis' }));
      return;
    }
    try {
      const automailerStorage = require('../skills/automailer/storage.js');
      const emails = automailerStorage.getEmailEventsForRecipient(email);
      const isBlacklisted = automailerStorage.isBlacklisted(email);
      const sentiment = automailerStorage.getSentiment ? automailerStorage.getSentiment(email) : null;
      // Chercher dans les listes de contacts
      const contactLists = automailerStorage.getAllContactLists().filter(l => l.contacts.some(c => (c.email || '').toLowerCase() === email));
      const contactData = contactLists.map(l => ({ listName: l.name, contact: l.contacts.find(c => (c.email || '').toLowerCase() === email) }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        email: email,
        emailsSent: emails.length,
        emails: emails,
        blacklisted: isBlacklisted,
        sentiment: sentiment,
        contactLists: contactData
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // === RGPD : Delete Me (droit a l'effacement) ===
  if (req.url === '/api/rgpd/delete-me' && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    req.on('data', (chunk) => { bodySize += chunk.length; if (bodySize > 4096) { req.destroy(); return; } body += chunk; });
    req.on('end', () => {
      try {
        const apiToken = (req.headers['x-api-token'] || req.headers['authorization'] || '').replace('Bearer ', '');
        if (!apiToken || (apiToken !== process.env.DASHBOARD_PASSWORD && apiToken !== process.env.AUTOMAILER_DASHBOARD_PASSWORD)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const data = JSON.parse(body);
        const email = (data.email || '').toLowerCase().trim();
        if (!email || !email.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'email requis' }));
          return;
        }
        const automailerStorage = require('../skills/automailer/storage.js');
        // 1. Supprimer tous les emails envoyes a cette adresse
        const before = automailerStorage.data.emails.length;
        automailerStorage.data.emails = automailerStorage.data.emails.filter(e => (e.to || '').toLowerCase() !== email);
        const deletedEmails = before - automailerStorage.data.emails.length;
        // 2. Supprimer des listes de contacts
        let deletedFromLists = 0;
        for (const list of Object.values(automailerStorage.data.contactLists || {})) {
          const beforeLen = list.contacts.length;
          list.contacts = list.contacts.filter(c => (c.email || '').toLowerCase() !== email);
          deletedFromLists += (beforeLen - list.contacts.length);
        }
        // 3. Supprimer le sentiment
        if (automailerStorage.data._sentiments && automailerStorage.data._sentiments[email]) {
          delete automailerStorage.data._sentiments[email];
        }
        // 4. Ajouter a la blacklist RGPD (ne plus jamais contacter)
        automailerStorage.addToBlacklist(email, 'rgpd_delete_request');
        automailerStorage.save();
        log.info('rgpd', 'RGPD delete-me: ' + email + ' — ' + deletedEmails + ' emails supprimes, ' + deletedFromLists + ' entrees contacts supprimees, blacklist RGPD ajoutee');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          email: email,
          deletedEmails: deletedEmails,
          deletedFromLists: deletedFromLists,
          blacklisted: true,
          message: 'Toutes les donnees ont ete supprimees et l\'email a ete ajoute a la blacklist RGPD.'
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === WEBHOOK INSTANTLY — Events email (sent, bounced, replied, unsub, error) ===
  if (req.url && req.url.startsWith('/webhook/instantly') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 256 * 1024;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on('end', async () => {
      if (bodySize > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        return;
      }
      // Phase A4 + B2 — Auth obligatoire per-tenant (sig HMAC / bearer / shared)
      const { verifyTimestamp } = require('./webhook-auth.js');
      const { resolveTenantFromHmac, resolveTenantFromSecret, listTenantsFor, GLOBAL_TENANT } = require('./webhook-tenant.js');
      if (listTenantsFor('INSTANTLY_WEBHOOK_SECRET').length === 0) {
        log.error('webhook-instantly', 'Aucun INSTANTLY_WEBHOOK_SECRET configuré — refus de tous les webhooks');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'webhook secret not configured server-side' }));
        return;
      }
      const sig = req.headers['x-instantly-signature'] || req.headers['x-webhook-signature'] || '';
      const auth = req.headers['authorization'] || '';
      const sharedHeader = req.headers['x-instantly-secret'] || '';
      const ts = req.headers['x-instantly-timestamp'] || req.headers['x-webhook-timestamp'] || '';
      let instantlyTenant = sig ? resolveTenantFromHmac(body, sig, 'INSTANTLY_WEBHOOK_SECRET') : null;
      if (!instantlyTenant && auth) instantlyTenant = resolveTenantFromSecret(auth, 'INSTANTLY_WEBHOOK_SECRET');
      if (!instantlyTenant && sharedHeader) instantlyTenant = resolveTenantFromSecret(sharedHeader, 'INSTANTLY_WEBHOOK_SECRET');
      if (!instantlyTenant) {
        log.warn('webhook-instantly', 'Auth invalide (sig/bearer/shared tous KO ou aucun tenant matché)');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (ts && !verifyTimestamp(ts)) {
        log.warn('webhook-instantly', 'Timestamp hors fenêtre 5min — replay refusé');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'replay protection: timestamp outside window' }));
        return;
      }
      const instantlyResolvedClient = instantlyTenant === GLOBAL_TENANT ? null : instantlyTenant;
      try {
        const payload = JSON.parse(body);
        log.info('webhook-instantly', 'Event recu: ' + (payload.event_type || 'unknown') + ' | ' + (payload.email || ''));

        // Phase A6 — idempotency dedupe
        const idemMod = require('./idempotency.js');
        const idem = idemMod.forSource('instantly');
        const eventId = idemMod.computeEventId(payload, ['event_id', 'id', 'webhook_id']);
        const dedupeKey = (payload.event_type || 'evt') + ':' + (payload.email || '') + ':' + eventId;
        if (idem.isSeen(dedupeKey)) {
          log.info('webhook-instantly', 'Duplicate ignored: ' + dedupeKey);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, duplicate: true }));
          return;
        }

        // Charger le handler Instantly
        const { createInstantlyWebhookHandler } = require('./instantly-webhook-handler.js');
        const automailerStorage = require('../skills/automailer/storage.js');
        const handler = createInstantlyWebhookHandler({
          sendTelegram: sendMessage,
          storage: automailerStorage,
          metrics: global.__ifindMetrics,
          clientId: instantlyResolvedClient // B2 — route notifications to tenant admin
        });
        await handler.handleEvent(payload);
        idem.markSeen(dedupeKey);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        log.error('webhook-instantly', 'Erreur traitement: ' + e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === WEBHOOK PHAROW — Reception leads sourcing FR ===
  if (req.url && req.url.startsWith('/webhook/pharow') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 512 * 1024;
    req.on('data', (chunk) => { bodySize += chunk.length; if (bodySize > MAX_BODY) { req.destroy(); return; } body += chunk; });
    req.on('end', async () => {
      if (bodySize > MAX_BODY) { res.writeHead(413); res.end('{"error":"too large"}'); return; }
      // Phase A4 + B2 — auth via per-tenant secret resolution
      const { verifyTimestamp } = require('./webhook-auth.js');
      const { resolveTenantFromSecret, listTenantsFor, GLOBAL_TENANT } = require('./webhook-tenant.js');
      if (listTenantsFor('PHAROW_WEBHOOK_SECRET').length === 0) {
        log.error('webhook-pharow', 'Aucun PHAROW_WEBHOOK_SECRET configuré — refus');
        res.writeHead(503); res.end('{"error":"webhook secret not configured"}'); return;
      }
      const headerSecret = req.headers['x-pharow-secret'] || req.headers['authorization'] || '';
      const pharowTenant = resolveTenantFromSecret(headerSecret, 'PHAROW_WEBHOOK_SECRET');
      if (!pharowTenant) {
        log.warn('webhook-pharow', 'Secret invalide (aucun tenant matché)');
        res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
      }
      const ts = req.headers['x-pharow-timestamp'] || req.headers['x-webhook-timestamp'] || '';
      if (ts && !verifyTimestamp(ts)) {
        log.warn('webhook-pharow', 'Timestamp hors fenêtre 5min — replay refusé');
        res.writeHead(401); res.end('{"error":"replay protection: timestamp outside window"}'); return;
      }
      const pharowResolvedClient = pharowTenant === GLOBAL_TENANT ? null : pharowTenant;
      try {
        const parsed = JSON.parse(body);
        // Phase A6 — idempotency batch-level (skip si payload entier déjà reçu)
        const idemMod = require('./idempotency.js');
        const idemP = idemMod.forSource('pharow');
        const batchKey = idemMod.computeEventId(parsed, ['event_id', 'batch_id', 'webhook_id']);
        if (idemP.isSeen('pharow:batch:' + batchKey)) {
          log.info('webhook-pharow', 'Duplicate batch ignored: ' + batchKey);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, duplicate: true }));
          return;
        }
        idemP.markSeen('pharow:batch:' + batchKey);
        const leads = Array.isArray(parsed) ? parsed : (parsed.prospects || parsed.leads || parsed.data || [parsed]);
        const automailerStorage = require('../skills/automailer/storage.js');
        const ADMIN_CHAT = _getAdminChatId(pharowResolvedClient); // B2 — route to tenant admin
        let imported = 0, skipped = 0;
        for (const raw of leads) {
          // Mapper les champs Pharow vers le format interne
          const p = raw.prospect || raw;
          const c = raw.company || raw;
          const lead = {
            email: (p.email || p.workEmail || raw.email || '').toLowerCase().trim(),
            firstName: p.firstName || p.first_name || p.prenom || '',
            lastName: p.lastName || p.last_name || p.nom || '',
            company: c.name || c.companyName || p.company || raw.company || '',
            title: p.title || p.jobTitle || p.titre || '',
            linkedin: p.linkedinUrl || p.linkedin_url || p.linkedin || '',
            website: c.website || c.domain || '',
            industry: c.industry || c.nafLabel || c.sector || '',
            employeeCount: c.employeeCount || c.employee_count || c.effectif || null,
            city: c.city || c.ville || '',
            country: c.country || 'France',
            phone: p.phone || p.mobile || '',
            siren: c.siren || '',
            nafCode: c.nafCode || c.naf_code || '',
            revenue: c.revenue || c.chiffreAffaires || null,
            technologies: c.technologies || [],
            source: 'pharow'
          };
          if (!lead.email || !lead.email.includes('@')) { skipped++; continue; }
          if (!lead.firstName || !lead.company) { skipped++; continue; }
          if (automailerStorage.isBlacklisted(lead.email)) { skipped++; continue; }
          const ownDomains = (process.env.OWN_DOMAINS || 'getifind.fr,getifind.com,ifind-group.fr,ifind-agency.fr,ifind.fr,example.com,test.com').split(',').map(d => d.trim());
          if (ownDomains.includes((lead.email.split('@')[1] || '').toLowerCase())) { skipped++; continue; }
          // Dedup
          const allLists = automailerStorage.getAllContactLists();
          let dup = false;
          for (const list of allLists) { if (list.contacts.some(ct => (ct.email || '').toLowerCase() === lead.email)) { dup = true; break; } }
          if (dup) { skipped++; continue; }
          // Inserer
          const listName = 'Pharow Imports';
          let targetList = automailerStorage.findContactListByName(ADMIN_CHAT, listName);
          if (!targetList) { targetList = automailerStorage.createContactList(ADMIN_CHAT, listName); }
          automailerStorage.addContactToList(targetList.id, {
            email: lead.email, firstName: lead.firstName, lastName: lead.lastName,
            name: (lead.firstName + ' ' + lead.lastName).trim(),
            company: lead.company, title: lead.title, industry: lead.industry
          });
          // Sauvegarder enrichment
          const enrichDir = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/clay-enrichments';
          if (!fs.existsSync(enrichDir)) fs.mkdirSync(enrichDir, { recursive: true });
          atomicWriteSync(enrichDir + '/' + lead.email.replace(/[^a-z0-9@._-]/g, '_') + '.json', {
            ...lead, importedAt: new Date().toISOString()
          });
          imported++;
        }
        log.info('webhook-pharow', imported + ' leads importes, ' + skipped + ' skipped');
        if (imported > 0) {
          sendMessage(ADMIN_CHAT, '📥 *Pharow webhook*\n' + imported + ' lead(s) importe(s), ' + skipped + ' skipped', 'Markdown').catch(() => {});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ imported, skipped, total: leads.length }));
      } catch (e) {
        log.error('webhook-pharow', 'Erreur: ' + e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === WEBHOOK RODZ — Reception signaux intent ===
  if (req.url && req.url.startsWith('/webhook/rodz') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 256 * 1024;
    req.on('data', (chunk) => { bodySize += chunk.length; if (bodySize > MAX_BODY) { req.destroy(); return; } body += chunk; });
    req.on('end', async () => {
      if (bodySize > MAX_BODY) { res.writeHead(413); res.end('{"error":"too large"}'); return; }
      // Phase A4 + B2 — HMAC timing-safe per-tenant + replay protection
      const { verifyTimestamp } = require('./webhook-auth.js');
      const { resolveTenantFromHmac, resolveTenantFromSecret, listTenantsFor, GLOBAL_TENANT } = require('./webhook-tenant.js');
      if (listTenantsFor('RODZ_WEBHOOK_SECRET').length === 0) {
        log.error('webhook-rodz', 'Aucun RODZ_WEBHOOK_SECRET configuré — refus');
        res.writeHead(503); res.end('{"error":"webhook secret not configured"}'); return;
      }
      const sig = req.headers['x-rodz-signature'] || '';
      const authHeader = req.headers['authorization'] || '';
      let rodzTenant = sig ? resolveTenantFromHmac(body, sig, 'RODZ_WEBHOOK_SECRET') : null;
      if (!rodzTenant && authHeader) {
        rodzTenant = resolveTenantFromSecret(authHeader, 'RODZ_WEBHOOK_SECRET');
      }
      if (!rodzTenant) {
        log.warn('webhook-rodz', 'Signature/auth invalide (aucun tenant matché)');
        res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
      }
      const ts = req.headers['x-rodz-timestamp'] || req.headers['x-webhook-timestamp'] || '';
      if (ts && !verifyTimestamp(ts)) {
        log.warn('webhook-rodz', 'Timestamp hors fenêtre 5min — replay refusé');
        res.writeHead(401); res.end('{"error":"replay protection: timestamp outside window"}'); return;
      }
      const rodzResolvedClient = rodzTenant === GLOBAL_TENANT ? null : rodzTenant;
      try {
        const parsed = JSON.parse(body);
        // Phase A6 — idempotency dedupe
        const idemMod = require('./idempotency.js');
        const idemR = idemMod.forSource('rodz');
        const sigId = idemMod.computeEventId(parsed, ['signal_id', 'event_id', 'id', 'data.signal_id', 'signal.id']);
        if (idemR.isSeen('rodz:' + sigId)) {
          log.info('webhook-rodz', 'Duplicate signal ignored: ' + sigId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, duplicate: true }));
          return;
        }
        idemR.markSeen('rodz:' + sigId);
        const data = parsed.data || parsed;
        const signalType = parsed.signal_type || parsed.event_type || (parsed.signal && parsed.signal.type) || 'unknown';
        const prospect = data.prospect || data.company || {};
        const person = data.person || data.contact || {};
        const details = data.details || {};
        const automailerStorage = require('../skills/automailer/storage.js');
        const ADMIN_CHAT = _getAdminChatId(rodzResolvedClient); // B2 — route to tenant admin

        // Construire le lead depuis le signal Rodz
        const lead = {
          email: (person.email || person.work_email || '').toLowerCase().trim(),
          firstName: (person.full_name || person.name || '').split(' ')[0] || '',
          lastName: (person.full_name || person.name || '').split(' ').slice(1).join(' ') || '',
          company: prospect.name || prospect.company_name || '',
          title: person.new_title || person.title || person.job_title || '',
          linkedin: person.linkedin_url || person.linkedin || '',
          website: prospect.domain || prospect.website || '',
          industry: prospect.industry || '',
          employeeCount: prospect.employee_count || null,
          country: prospect.country || 'FR',
          signalType: signalType,
          signalDetails: JSON.stringify(details).substring(0, 2000),
          signalConfidence: data.confidence || 'medium',
          signalDetectedAt: data.detected_at || parsed.timestamp || new Date().toISOString(),
          source: 'rodz'
        };

        log.info('webhook-rodz', 'Signal: ' + signalType + ' | ' + lead.company + ' | ' + (lead.email || 'no-email') + ' | confidence: ' + lead.signalConfidence);

        // Notifier Telegram du signal (toujours, meme sans email)
        const signalEmoji = { funding_round: '💰', new_hire: '👤', job_posting: '📋', job_changes: '🔄', merger_acquisition: '🤝', product_launch: '🚀', technology_adoption: '💻', company_creation: '🏗️' };
        const emoji = signalEmoji[signalType] || '📡';
        let telegramMsg = emoji + ' *Signal Rodz: ' + signalType + '*\n';
        telegramMsg += 'Entreprise: ' + (lead.company || '?') + '\n';
        if (lead.email) telegramMsg += 'Contact: ' + lead.firstName + ' ' + lead.lastName + ' (' + lead.email + ')\n';
        if (person.new_title) telegramMsg += 'Poste: ' + person.new_title + '\n';
        if (details.round_type) telegramMsg += 'Levee: ' + details.round_type + ' ' + (details.amount ? (details.amount / 1000000).toFixed(1) + 'M€' : '') + '\n';
        if (details.source_url) telegramMsg += 'Source: ' + details.source_url + '\n';
        sendMessage(ADMIN_CHAT, telegramMsg, 'Markdown').catch(() => {});

        // Si pas d'email, stocker comme signal-only (pas de prospection possible sans email)
        if (!lead.email || !lead.email.includes('@')) {
          // Sauvegarder le signal pour enrichissement ulterieur
          const signalDir = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/rodz-signals';
          if (!fs.existsSync(signalDir)) fs.mkdirSync(signalDir, { recursive: true });
          const signalFile = signalDir + '/signal-' + Date.now() + '.json';
          atomicWriteSync(signalFile, { ...lead, rawPayload: parsed, savedAt: new Date().toISOString() });
          log.info('webhook-rodz', 'Signal sans email sauvegarde: ' + signalFile);
          res.writeHead(200); res.end(JSON.stringify({ signal: signalType, email: null, saved: true }));
          return;
        }

        // Avec email : importer comme lead
        if (automailerStorage.isBlacklisted(lead.email)) {
          res.writeHead(200); res.end(JSON.stringify({ email: lead.email, skipped: 'blacklisted' })); return;
        }
        const ownDomains = (process.env.OWN_DOMAINS || 'getifind.fr,getifind.com,ifind-group.fr,ifind-agency.fr,ifind.fr,example.com,test.com').split(',').map(d => d.trim());
        if (ownDomains.includes((lead.email.split('@')[1] || '').toLowerCase())) {
          res.writeHead(200); res.end(JSON.stringify({ email: lead.email, skipped: 'own_domain' })); return;
        }

        // Dedup
        const allLists = automailerStorage.getAllContactLists();
        let isDup = false;
        for (const list of allLists) { if (list.contacts.some(ct => (ct.email || '').toLowerCase() === lead.email)) { isDup = true; break; } }

        if (!isDup && lead.firstName && lead.company) {
          const listName = 'Rodz Signals';
          let targetList = automailerStorage.findContactListByName(ADMIN_CHAT, listName);
          if (!targetList) { targetList = automailerStorage.createContactList(ADMIN_CHAT, listName); }
          automailerStorage.addContactToList(targetList.id, {
            email: lead.email, firstName: lead.firstName, lastName: lead.lastName,
            name: (lead.firstName + ' ' + lead.lastName).trim(),
            company: lead.company, title: lead.title, industry: lead.industry
          });
        }

        // Sauvegarder enrichment avec signal
        const enrichDir = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/clay-enrichments';
        if (!fs.existsSync(enrichDir)) fs.mkdirSync(enrichDir, { recursive: true });
        atomicWriteSync(enrichDir + '/' + lead.email.replace(/[^a-z0-9@._-]/g, '_') + '.json', {
          ...lead, importedAt: new Date().toISOString()
        });

        log.info('webhook-rodz', 'Lead importe: ' + lead.email + ' (signal: ' + signalType + ', dup: ' + isDup + ')');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ email: lead.email, signal: signalType, imported: !isDup, duplicate: isDup }));
      } catch (e) {
        log.error('webhook-rodz', 'Erreur: ' + e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === WEBHOOK CLAY — Reception leads enrichis ===
  if (req.url && req.url.startsWith('/webhook/clay') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 512 * 1024; // 512 KB max (batch possible)
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on('end', async () => {
      if (bodySize > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        return;
      }

      // Phase A4 + B2 — Auth timing-safe per-tenant + replay protection
      const { verifyTimestamp } = require('./webhook-auth.js');
      const { resolveTenantFromSecret, listTenantsFor, GLOBAL_TENANT } = require('./webhook-tenant.js');
      if (listTenantsFor('CLAY_WEBHOOK_SECRET').length === 0) {
        log.error('webhook-clay', 'Aucun CLAY_WEBHOOK_SECRET configuré — refus');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'webhook secret not configured server-side' }));
        return;
      }
      const headerSecret = req.headers['x-clay-secret'] || '';
      const clayTenant = resolveTenantFromSecret(headerSecret, 'CLAY_WEBHOOK_SECRET');
      if (!clayTenant) {
        log.warn('webhook-clay', 'Secret invalide (aucun tenant matché)');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized — invalid X-Clay-Secret' }));
        return;
      }
      const ts = req.headers['x-clay-timestamp'] || req.headers['x-webhook-timestamp'] || '';
      if (ts && !verifyTimestamp(ts)) {
        log.warn('webhook-clay', 'Timestamp hors fenêtre 5min — replay refusé');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'replay protection: timestamp outside window' }));
        return;
      }
      const clayResolvedClient = clayTenant === GLOBAL_TENANT ? null : clayTenant;

      try {
        const parsed = JSON.parse(body);
        // Phase A6 — idempotency batch-level
        const idemMod = require('./idempotency.js');
        const idemC = idemMod.forSource('clay');
        const batchKey = idemMod.computeEventId(parsed, ['event_id', 'batch_id', 'webhook_id']);
        if (idemC.isSeen('clay:batch:' + batchKey)) {
          log.info('webhook-clay', 'Duplicate batch ignored: ' + batchKey);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, duplicate: true }));
          return;
        }
        idemC.markSeen('clay:batch:' + batchKey);
        // Support batch (array) ou single lead (object)
        const leads = Array.isArray(parsed) ? parsed : [parsed];
        const results = [];
        const automailerStorage = require('../skills/automailer/storage.js');
        const ADMIN_CHAT_ID = _getAdminChatId(clayResolvedClient); // B2 — route to tenant admin

        // v9.1: Compute lead score server-side (Clay formulas don't resolve in HTTP API)
        function computeLeadScore(lead) {
          let score = 0;
          if (lead.googleNews && typeof lead.googleNews === 'object' && (Array.isArray(lead.googleNews) ? lead.googleNews.length > 0 : Object.keys(lead.googleNews).length > 0)) score += 20;
          if (lead.employeeCount && Number(lead.employeeCount) >= 11) score += 15;
          if (lead.linkedinPosts && (Array.isArray(lead.linkedinPosts) ? lead.linkedinPosts.length > 0 : (lead.linkedinPosts.posts && lead.linkedinPosts.posts.length > 0))) score += 15;
          if (lead.email && lead.email.includes('@')) score += 10;
          if (lead.linkedinBio && typeof lead.linkedinBio === 'string' ? lead.linkedinBio.length > 0 : (typeof lead.linkedinBio === 'object' && Object.keys(lead.linkedinBio).length > 0)) score += 10;
          if (lead.website || lead.companyDomain) score += 5;
          if (lead.positionStartDate) score += 10;  // timeline hook bonus
          if (lead.headcountGrowth) score += 10;    // growth signal bonus
          if (lead.companyDescription) score += 5;   // richer personalization
          return score;
        }
        function computePriority(score) {
          return score >= 50 ? 'Haute' : score >= 25 ? 'Moyenne' : 'Basse';
        }

        for (const lead of leads) {
          // v9.1: Auto-compute leadScore/priority if not provided by Clay
          if (!lead.leadScore || lead.leadScore === 'undefined') {
            lead.leadScore = computeLeadScore(lead);
          }
          if (!lead.priority || lead.priority === 'undefined') {
            lead.priority = computePriority(Number(lead.leadScore) || 0);
          }

          // Validation champs requis
          if (!lead.email || typeof lead.email !== 'string' || !lead.email.includes('@')) {
            // Capture LinkedIn-only leads (have LinkedIn but no email) for Expandi integration
            if (lead.linkedin && typeof lead.linkedin === 'string' && lead.linkedin.includes('linkedin.com')) {
              try {
                const liOnlyPath = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/linkedin-only-leads.json';
                let existing = [];
                try { existing = JSON.parse(fs.readFileSync(liOnlyPath, 'utf8')); } catch(e) { log.info('webhook-clay', 'LinkedIn-only file not found or invalid, starting fresh'); }
                const isDup = existing.some(e => e.linkedin === lead.linkedin);
                if (!isDup) {
                  existing.push({ firstName: lead.firstName || '', lastName: lead.lastName || '', company: lead.company || '', title: lead.title || '', linkedin: lead.linkedin, capturedAt: new Date().toISOString() });
                  atomicWriteSync(liOnlyPath, existing);
                  log.info('webhook-clay', 'LinkedIn-only lead capture: ' + (lead.firstName || '') + ' ' + (lead.lastName || '') + ' (' + (lead.company || '') + ')');
                }
              } catch(e) { log.warn('webhook-clay', 'Erreur capture LinkedIn-only: ' + e.message); }
            }
            const reason = 'email requis et invalide';
            log.warn('webhook-clay', 'Lead rejete: ' + (lead.email || 'no-email') + ' / ' + (lead.firstName || '?') + ' ' + (lead.lastName || '?') + ' @ ' + (lead.company || '?') + ' — raison: ' + reason);
            results.push({ email: lead.email || null, error: reason, success: false });
            continue;
          }
          if (!lead.firstName || !lead.lastName || !lead.company) {
            const reason = 'firstName=' + (lead.firstName || 'MANQUANT') + ' lastName=' + (lead.lastName || 'MANQUANT') + ' company=' + (lead.company || 'MANQUANT');
            log.warn('webhook-clay', 'Lead rejete: ' + lead.email + ' — champs manquants: ' + reason);
            results.push({ email: lead.email, error: 'firstName, lastName et company requis', success: false });
            continue;
          }

          // Verifier blacklist (inclut les unsubscribes)
          if (automailerStorage.isBlacklisted(lead.email)) {
            results.push({ email: lead.email, error: 'email blackliste', success: false });
            continue;
          }

          // v9.2: Domain blacklist — never email own domains, test domains, or competitors
          const ownDomains = (process.env.OWN_DOMAINS || 'getifind.fr,getifind.com,ifind-group.fr,ifind-agency.fr,ifind.fr,example.com,test.com').split(',').map(d => d.trim());
          const emailDomain = (lead.email.split('@')[1] || '').toLowerCase();
          if (ownDomains.includes(emailDomain)) {
            results.push({ email: lead.email, error: 'domaine propre/test blackliste', success: false });
            continue;
          }

          // Verifier doublon dans toutes les listes
          const allLists = automailerStorage.getAllContactLists();
          let duplicate = false;
          for (const list of allLists) {
            if (list.contacts.some(c => (c.email || '').toLowerCase() === lead.email.toLowerCase())) {
              duplicate = true;
              break;
            }
          }
          if (duplicate) {
            // v9.1: Meme si doublon, mettre a jour les enrichments (re-push Clay)
            const enrichmentDir = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/clay-enrichments';
            try {
              if (!fs.existsSync(enrichmentDir)) fs.mkdirSync(enrichmentDir, { recursive: true });
              const enrichmentFile = enrichmentDir + '/' + lead.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_') + '.json';
              const nestedEnr = lead.enrichment || {};
              const enrichmentData = {
                email: lead.email.toLowerCase().trim(),
                firstName: lead.firstName,
                lastName: lead.lastName,
                company: lead.company,
                title: lead.title || '',
                linkedin: lead.linkedin || '',
                website: lead.website || '',
                industry: lead.industry || '',
                employeeCount: lead.employeeCount || null,
                location: lead.location || '',
                phone: lead.phone || '',
                companyDescription: lead.companyDescription || null,
                positionStartDate: lead.positionStartDate || null,
                emailValid: lead.emailValid || null,
                builtWith: lead.builtWith || nestedEnr.builtWith || nestedEnr.technologies || null,
                funding: lead.funding || nestedEnr.funding || null,
                headcountGrowth: lead.headcountGrowth || nestedEnr.headcountGrowth || null,
                'Percent Employee Growth Over Last_6Months': lead['Percent Employee Growth Over Last_6Months'] || lead.percentEmployeeGrowthOverLast6Months || null,
                'Percent Employee Growth Over Last_12Months': lead['Percent Employee Growth Over Last_12Months'] || lead.percentEmployeeGrowthOverLast12Months || null,
                'Employee Count': lead['Employee Count'] || null,
                linkedinBio: lead.linkedinBio || nestedEnr.linkedinBio || null,
                linkedinPosts: lead.linkedinPosts || nestedEnr.linkedinPosts || null,
                jobListings: lead.jobListings || nestedEnr.jobListings || null,
                jobOpenings: lead.jobOpenings || lead['Company Job Openings'] || nestedEnr.jobOpenings || null,
                googleNews: lead.googleNews || nestedEnr.googleNews || null,
                revenueData: lead.revenueData || nestedEnr.revenueData || null,
                growthInsights: lead.growthInsights || nestedEnr.growthInsights || null,
                enrichCompany: lead.enrichCompany || nestedEnr.enrichCompany || null,
                leadScore: lead.leadScore || null,
                priority: lead.priority || null,
                catchAll: lead.catchAll === true || lead.catchAll === 'true' || lead.isCatchAll === true || lead.isCatchAll === 'true',
                companyDomain: lead.companyDomain || lead.website || null,
                companyLocation: lead.companyLocation || null,
                enrichment: lead.enrichment || {},
                source: 'clay',
                importedAt: new Date().toISOString()
              };
              atomicWriteSync(enrichmentFile, enrichmentData);
              log.info('webhook-clay', 'Enrichment mis a jour pour doublon: ' + lead.email + ' (score=' + lead.leadScore + ', prio=' + lead.priority + ')');
              results.push({ email: lead.email, enrichmentUpdated: true, success: true });
            } catch (e) {
              log.warn('webhook-clay', 'Erreur MAJ enrichment doublon ' + lead.email + ': ' + e.message);
              results.push({ email: lead.email, error: 'doublon — enrichment update failed', success: false });
            }
            continue;
          }

          // Determiner la liste cible : "Clay Imports" ou "Clay Catch-All" (volume reduit)
          const isCatchAll = lead.catchAll === true || lead.catchAll === 'true' || lead.isCatchAll === true || lead.isCatchAll === 'true';
          const listName = isCatchAll ? 'Clay Catch-All' : 'Clay Imports';
          let clayList = automailerStorage.findContactListByName(ADMIN_CHAT_ID, listName);
          if (!clayList) {
            clayList = automailerStorage.createContactList(ADMIN_CHAT_ID, listName);
            log.info('webhook-clay', 'Liste "' + listName + '" creee: ' + clayList.id);
          }
          if (isCatchAll) {
            log.info('webhook-clay', 'Lead catch-all detecte: ' + lead.email + ' → liste separee (volume reduit)');
          }

          // Inserer le contact
          const contact = automailerStorage.addContactToList(clayList.id, {
            email: lead.email.toLowerCase().trim(),
            firstName: lead.firstName || '',
            lastName: lead.lastName || '',
            name: ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim(),
            company: lead.company || '',
            title: lead.title || '',
            industry: lead.industry || ''
          });

          // Stocker les metadonnees enrichies dans un fichier separe (pour le pipeline)
          const enrichmentDir = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/clay-enrichments';
          try {
            if (!fs.existsSync(enrichmentDir)) fs.mkdirSync(enrichmentDir, { recursive: true });
            const enrichmentFile = enrichmentDir + '/' + lead.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_') + '.json';
            // v9.0: Accept both top-level and enrichment.* nested fields
            const nestedEnr = lead.enrichment || {};
            const enrichmentData = {
              email: lead.email.toLowerCase().trim(),
              firstName: lead.firstName,
              lastName: lead.lastName,
              company: lead.company,
              title: lead.title || '',
              linkedin: lead.linkedin || '',
              website: lead.website || '',
              industry: lead.industry || '',
              employeeCount: lead.employeeCount || null,
              location: lead.location || '',
              phone: lead.phone || '',
              companyDescription: lead.companyDescription || null,
              positionStartDate: lead.positionStartDate || null,
              emailValid: lead.emailValid || null,
              builtWith: lead.builtWith || nestedEnr.builtWith || nestedEnr.technologies || null,
              funding: lead.funding || nestedEnr.funding || null,
              headcountGrowth: lead.headcountGrowth || nestedEnr.headcountGrowth || nestedEnr.headcount_growth || null,
              'Percent Employee Growth Over Last_6Months': lead['Percent Employee Growth Over Last_6Months'] || lead.percentEmployeeGrowthOverLast6Months || null,
              'Percent Employee Growth Over Last_12Months': lead['Percent Employee Growth Over Last_12Months'] || lead.percentEmployeeGrowthOverLast12Months || null,
              'Employee Count': lead['Employee Count'] || null,
              linkedinBio: lead.linkedinBio || nestedEnr.linkedinBio || null,
              linkedinPosts: lead.linkedinPosts || nestedEnr.linkedinPosts || null,
              jobListings: lead.jobListings || nestedEnr.jobListings || null,
              jobOpenings: lead.jobOpenings || lead['Company Job Openings'] || nestedEnr.jobOpenings || null,
              googleNews: lead.googleNews || nestedEnr.googleNews || null,
              revenueData: lead.revenueData || nestedEnr.revenueData || null,
              growthInsights: lead.growthInsights || nestedEnr.growthInsights || null,
              enrichCompany: lead.enrichCompany || nestedEnr.enrichCompany || null,
              leadScore: lead.leadScore || null,
              priority: lead.priority || null,
              catchAll: isCatchAll,
              companyDomain: lead.companyDomain || lead.website || null,
              companyLocation: lead.companyLocation || null,
              enrichment: lead.enrichment || {},
              source: 'clay',
              importedAt: new Date().toISOString()
            };
            atomicWriteSync(enrichmentFile, enrichmentData);
          } catch (e) {
            log.warn('webhook-clay', 'Erreur sauvegarde enrichment pour ' + lead.email + ': ' + e.message);
          }

          // v9.0: Injection FlowFast — ajouter le lead dans le pipeline
          try {
            const ffStorage = require('../skills/flowfast/storage.js');
            ffStorage.addLead({
              email: lead.email.toLowerCase().trim(),
              nom: ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim(),
              entreprise: lead.company || '',
              titre: lead.title || '',
              industry: lead.industry || '',
              linkedin: lead.linkedin || '',
              localisation: lead.location || ''
            }, lead.leadScore ? parseInt(lead.leadScore) : 7, 'clay');
            log.info('webhook-clay', 'FlowFast lead ajoute: ' + lead.email + ' (score ' + (lead.leadScore || 7) + ', source clay)');
          } catch (e) {
            log.warn('webhook-clay', 'FlowFast injection echouee pour ' + lead.email + ': ' + e.message);
          }

          const leadId = contact ? (clayList.id + ':' + lead.email) : null;
          results.push({ email: lead.email, leadId: leadId, success: true });
          log.info('webhook-clay', 'Lead importe: ' + lead.email + ' (' + lead.company + ')');
        }

        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        log.info('webhook-clay', 'Batch: ' + successCount + ' importes, ' + errorCount + ' erreurs sur ' + leads.length + ' leads');

        // Reponse
        if (leads.length === 1) {
          // Single lead — reponse plate
          const r = results[0];
          res.writeHead(r.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r));
        } else {
          // Batch — reponse array
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, imported: successCount, errors: errorCount, results: results }));
        }
      } catch (e) {
        log.error('webhook-clay', 'Erreur parsing payload: ' + e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON payload' }));
      }
    });
    return;
  }

  // === CLICK TRACKING (module extrait) ===
  if (emailTracking.handleClick(req, res)) return;

  // === PIXEL TRACKING (module extrait) ===
  if (emailTracking.handlePixel(req, res)) return;

  // === UNSUBSCRIBE ENDPOINT (module extrait) ===
  if (handleUnsubscribe(req, res)) return;

  res.writeHead(404);
  res.end();
});
healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
  log.info('router', 'Healthcheck HTTP sur port ' + HEALTH_PORT);
});

// --- Exporter l'agent HTTPS pour les skills ---
global.__ifindHttpsAgent = httpsAgent;

log.info('router', (process.env.CLIENT_NAME || 'iFIND') + ' Router demarre...');
telegramAPI('getMe').then(result => {
  if (result.ok) {
    log.info('router', 'Bot connecte : @' + result.result.username + ' (' + result.result.first_name + ')');
    telegramAPI('setMyCommands', {
      commands: [
        { command: 'start', description: 'Demarrer ' + (process.env.CLIENT_NAME || 'iFIND') },
        { command: 'aide', description: '❓ Voir l\'aide' }
      ]
    }).catch(e => log.warn('router', 'setMyCommands echoue:', e.message));
    log.info('router', '13 skills actives');
    log.info('router', 'En attente de messages...');
    _botReady = true;
    poll();
  } else {
    log.error('router', 'Erreur Telegram:', JSON.stringify(result).substring(0, 200));
    process.exit(1);
  }
}).catch(e => {
  log.error('router', 'Erreur fatale:', e.message);
  process.exit(1);
});

// Cleanup — graceful shutdown (attend 8s pour les operations en cours)
let _shutdownInProgress = false;
function gracefulShutdown() {
  if (_shutdownInProgress) return;
  _shutdownInProgress = true;
  log.info('router', 'Arret gracieux lance (max 8s)...');
  _polling = false;
  _botReady = false;
  clearInterval(_cleanupInterval);
  clearInterval(_metricsSaveInterval);
  clearInterval(_hitlSaveInterval);
  cronManager.clearAllIntervals();
  try { _saveMetrics(); } catch (e) { log.error('router', 'Erreur save metrics:', e.message); }
  try { _saveVolatileState(); } catch (e) { log.error('router', 'Erreur save volatile-state:', e.message); }
  log.info('router', 'Metriques + etat volatile sauvegardes sur disque');
  healthServer.close();
  httpsAgent.destroy();
  [automailerHandler, crmPilotHandler,
   invoiceBotHandler, proactiveEngine, webIntelHandler, systemAdvisorHandler, autoPilotEngine,
   inboxHandler, meetingHandler]
    .forEach(h => { try { h.stop(); } catch (e) { log.error('router', 'Erreur stop handler:', e.message); } });
  if (selfImproveHandler) try { selfImproveHandler.stop(); } catch (e) { log.error('router', 'Erreur stop self-improve:', e.message); }
  for (const il of inboxListeners) { try { il.stop(); } catch (e) { log.error('router', 'Erreur stop inbox-listener:', e.message); } }
  setTimeout(() => {
    log.info('router', 'Shutdown termine.');
    process.exit(0);
  }, 8000);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (err) => {
  log.error('router', 'UNCAUGHT EXCEPTION:', err.message);
  log.error('router', err.stack ? err.stack.substring(0, 500) : 'no stack');
  // Sauvegarder les drafts HITL avant exit
  try { _saveHitlDrafts(); } catch (e) { console.error('Emergency HITL save failed:', e.message); }
  gracefulShutdown();
});
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  const stack = reason?.stack || '';

  // IMAP/imapflow rejections internes — ne PAS crasher le container
  // imapflow lance des rejections "Connection not available" / "socket hang up"
  // quand le timeout gagne la race contre client.connect()
  if (msg.includes('Connection not available') || msg.includes('socket hang up') ||
      msg.includes('IMAP') || stack.includes('imapflow')) {
    log.warn('router', 'IMAP unhandled rejection (non-fatal):', msg);
    // Restart IMAP listener proprement si disponible
    for (const il of inboxListeners) {
      try {
        il.stop();
        // Max 5 retries avec backoff exponentiel (10s, 20s, 40s, 80s, 160s)
        const attempt = (il._imapRestartAttempts || 0) + 1;
        il._imapRestartAttempts = attempt;
        if (attempt > 5) {
          log.error('router', 'IMAP restart max retries (5) atteint — IMAP abandonne pour ' + (il._email || '?'));
          continue;
        }
        const delay = 10000 * Math.pow(2, attempt - 1);
        log.warn('router', 'IMAP restart attempt ' + attempt + '/5 dans ' + Math.round(delay / 1000) + 's pour ' + (il._email || '?'));
        setTimeout(() => {
          if (il && il.isConfigured()) {
            il.start().then(() => {
              il._imapRestartAttempts = 0; // Reset on success
              log.info('router', 'IMAP restart reussi pour ' + (il._email || '?'));
            }).catch(e => log.warn('router', 'IMAP restart attempt ' + attempt + ' echoue: ' + e.message));
          }
        }, delay);
      } catch (e) { log.warn('router', 'IMAP restart failed during unhandled rejection recovery: ' + e.message); }
    }
    return; // NE PAS crasher
  }

  // Autres unhandled rejections — log + crash comme avant
  log.error('router', 'UNHANDLED REJECTION:', msg);
  log.error('router', stack ? stack.substring(0, 500) : 'no stack');
  // Sauvegarder les drafts HITL avant exit
  try { _saveHitlDrafts(); } catch (e) { console.error('Emergency HITL save failed:', e.message); }
  gracefulShutdown();
});
