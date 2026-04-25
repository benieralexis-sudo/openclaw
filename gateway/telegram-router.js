// iFIND Trigger Engine v2.0 — Routeur central
//
// Composants ACTIFS :
//   - Trigger Engine (skills/trigger-engine/) — produit principal
//   - Claude Brain v1.1 (Opus 4.7 + boosters combo/hot/declarative-pain)
//   - Inbox Manager (IMAP polling + reply-pipeline)
//   - Meeting Scheduler (Google Calendar booking)
//   - Webhooks Resend (replies tracking) + Tally (signup clients)
//   - Telegram bot admin (Mr.Krabs / @Myironpro_bot — notifications + commandes)
//
// Composants LEGACY (stubs no-op v2.0-cleanup) :
//   - AutoMailer/CRM/Invoice/Proactive/SelfImprove/WebIntel/SystemAdvisor/Autonomous
//   Ces handlers retournent {skipped:true} et seront supprimés au refactor router complet.

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
// === Handlers legacy v9.5 — neutralisés via stubs Étape 1 cleanup v2.0 ===
//
// Tous ces handlers retournent {skipped:true,reason:'legacy-deprecated-v2-cleanup'}.
// Importés en try/catch + fallback stub inline pour que le router boot même si les
// fichiers physiques sont supprimés (Étape 2 cleanup v2.0). La résolution finale
// se fait au refactor router complet quand les tests E2E sont en place.
//
// Composant ACTIF : Trigger Engine (skills/trigger-engine/) + Inbox + Meeting.

// Stub class minimaliste pour fallback : satisfait toutes les méthodes appelées
// par le router (start/stop/handle/handleMessage + maps pendingX) sans crasher.
class _LegacyStubHandler {
  constructor() {
    this.skipped = true;
    this.pendingConversations = {};
    this.pendingConfirmations = {};
    this.pendingImports = {};
    this.pendingEmails = {};
    this.pendingResults = {};
  }
  start() { return; }
  stop() { return; }
  async handle() { return { skipped: true, reason: 'legacy-deprecated-v2-cleanup' }; }
  async handleMessage() { return { skipped: true, reason: 'legacy-deprecated-v2-cleanup' }; }
}

function _safeRequire(path, fallback) {
  try { return require(path); } catch (e) { return fallback; }
}

const AutoMailerHandler = _safeRequire('../skills/automailer/automailer-handler.js', _LegacyStubHandler);
const CRMPilotHandler = _safeRequire('../skills/crm-pilot/crm-handler.js', _LegacyStubHandler);
const InvoiceBotHandler = _safeRequire('../skills/invoice-bot/invoice-handler.js', _LegacyStubHandler);
const ProactiveEngine = _safeRequire('../skills/proactive-agent/proactive-engine.js', _LegacyStubHandler);
const ProactiveHandler = _safeRequire('../skills/proactive-agent/proactive-handler.js', _LegacyStubHandler);
const SelfImproveHandler = _safeRequire('../skills/self-improve/self-improve-handler.js', _LegacyStubHandler);
const WebIntelligenceHandler = _safeRequire('../skills/web-intelligence/web-intelligence-handler.js', _LegacyStubHandler);
const SystemAdvisorHandler = _safeRequire('../skills/system-advisor/system-advisor-handler.js', _LegacyStubHandler);
const AutonomousHandler = _safeRequire('../skills/autonomous-pilot/autonomous-handler.js', _LegacyStubHandler);
const BrainEngine = _safeRequire('../skills/autonomous-pilot/brain-engine.js', _LegacyStubHandler);
const InboxHandler = require('../skills/inbox-manager/inbox-handler.js');
let InboxListener;
try { InboxListener = require('../skills/inbox-manager/inbox-listener.js'); } catch (e) { InboxListener = null; }
const MeetingHandler = require('../skills/meeting-scheduler/meeting-handler.js');
const { classifyReply, subClassifyObjection, generateObjectionReply, generateQuestionReplyViaClaude, generateInterestedReplyViaClaude, parseOOOReturnDate, checkGrounding, REPLY_TEMPLATES } = require('../skills/inbox-manager/reply-classifier.js');

// --- Trigger Engine (opt-in via TRIGGER_ENGINE_ENABLED env) ---
let TriggerEngineHandler = null;
let TriggerEngineProcessor = null;
let TriggerEngineCron = null;
let ClientRouter = null;
let ClaudeBrain = null;
try {
  ({ TriggerEngineHandler } = require('../skills/trigger-engine/index.js'));
  ({ TriggerEngineProcessor } = require('../skills/trigger-engine/processor.js'));
  ({ TriggerEngineCron } = require('../skills/trigger-engine/cron.js'));
  ({ ClientRouter } = require('../skills/trigger-engine/router.js'));
  ({ ClaudeBrain } = require('../skills/trigger-engine/claude-brain/index.js'));
} catch (e) {
  // Silent fail — Trigger Engine is optional, skip if dependencies not installed yet
}
const appConfig = require('./app-config.js');
const { ReportWorkflow, fetchProspectData } = require('./report-workflow.js');

// --- Modules extraits (refactoring God Object) ---
const { createTelegramClient } = require('./telegram-client.js');
// v2.0-cleanup : skill-router (NLP classification 13 skills) supprimé.
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

// === VALIDATION .ENV AU BOOT (v2.0) — liste les clés requises pour Trigger Engine ===
{
  const _required = [
    ['TELEGRAM_BOT_TOKEN', TOKEN, true],
    ['OPENAI_API_KEY', OPENAI_KEY, true],
    ['CLAUDE_API_KEY', CLAUDE_KEY, true],
    ['SENDER_EMAIL', SENDER_EMAIL, true],
    ['ADMIN_CHAT_ID', ADMIN_CHAT_ID, false]
  ];
  const _recommended = [
    ['RESEND_API_KEY', process.env.RESEND_API_KEY, 'digest hebdo + alertes pépites désactivés'],
    ['PAPPERS_API_TOKEN', process.env.PAPPERS_API_TOKEN, 'enrichissement Pappers désactivé (fallback SIRENE gratuit)'],
    ['DROPCONTACT_API_KEY', process.env.DROPCONTACT_API_KEY, 'enrichissement emails Dropcontact désactivé']
  ];
  const _missing = _required.filter(([name, val]) => !val || val.trim() === '');
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
  if (_missing.length === 0 && _warnings.length === 0) log.info('router', 'Validation .env v2.0: toutes les clés présentes');
  else if (_missing.length === 0) log.info('router', 'Validation .env v2.0: OK (' + _warnings.length + ' recommandée(s) absente(s))');
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

// Handlers legacy v9.5 désactivés — stubs no-op v2.0-cleanup
const automailerHandler = new AutoMailerHandler();
const crmPilotHandler = new CRMPilotHandler();
const invoiceBotHandler = new InvoiceBotHandler();

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
  // v2.0-cleanup : handlers legacy stubbés, plus de pending state à purger.
  // Le Trigger Engine gère ses propres TTL via SQLite (claude_brain_queue, expires_at).

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

  // v2.0-cleanup : userActiveSkill cleanup supprimé (NLP routing legacy).

  // HITL drafts : auto-send 5 min (grounded) ou 24h (non-grounded), expire 48h
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
// Sonnet 4.6   : Redaction, conversation, humanisation
// Opus 4.7     : Rapports strategiques + Trigger Engine (qualify/pitch/brief)

// v2.0-cleanup : callOpenAINLP supprimé (utilisé uniquement par NLP routing legacy).

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
  const breakerName = model === 'claude-opus-4-7' ? 'claude-opus' : 'claude-sonnet';
  const breaker = getBreaker(breakerName, { failureThreshold: 5, cooldownMs: 30000 });
  return breaker.call(() => retryAsync(() => _callClaudeOnce(systemPrompt, userMessage, maxTokens, model), 4, 3000));
}

// === HANDLERS LEGACY v9.5 — neutralisés via stubs no-op (v2.0-cleanup) ===
// Ces handlers étaient utilisés par le bot iFIND v9.5 (autonomous brain cycles,
// proactive reports, self-improve, web intelligence, system monitoring).
// Le Trigger Engine (skills/trigger-engine/) les remplace tous depuis avril 2026.
// Stubs minimaux pour compat avec les références internes du router (cleanup,
// NLP routing). Le drop complet de ces références suivra avec le refactor router.
const proactiveEngine = new ProactiveEngine();
const proactiveHandler = new ProactiveHandler();
selfImproveHandler = new SelfImproveHandler();
const webIntelHandler = new WebIntelligenceHandler();
const systemAdvisorHandler = new SystemAdvisorHandler();
const autoPilotHandler = new AutonomousHandler();
const autoPilotEngine = new BrainEngine();

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
      automailerStorage: automailerStorageForInbox,
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

// Storages des skills legacy (toggle config.enabled — deviendront no-op si fichiers droppés)
// Tous wrappés en _safeRequire avec fallback objet vide pour résister au drop physique.
const _emptyStorageStub = { data: {}, getConfig: () => ({}), getStats: () => ({}) };
const proactiveAgentStorage = _safeRequire('../skills/proactive-agent/storage.js', _emptyStorageStub);
const selfImproveStorage = _safeRequire('../skills/self-improve/storage.js', _emptyStorageStub);
const webIntelStorage = _safeRequire('../skills/web-intelligence/storage.js', _emptyStorageStub);
const systemAdvisorStorage = _safeRequire('../skills/system-advisor/storage.js', _emptyStorageStub);
const autonomousPilotStorage = _safeRequire('../skills/autonomous-pilot/storage.js', _emptyStorageStub);
const flowFastStorageRouter = _safeRequire('../skills/flowfast/storage.js', null);
const leadEnrichStorageRouter = _safeRequire('../skills/lead-enrich/storage.js', null);

// v2.0-cleanup : HubSpot client supprimé. Folk CRM sera branché lundi
// (skills/trigger-engine/folk-client.js avec FOLK_API_KEY).

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
// v2.0-cleanup : engines/handlers legacy stubés (no-op), HubSpot supprimé.
const cronManager = createCronManager({
  engines: { proactiveEngine, autoPilotEngine },
  handlers: { selfImproveHandler, webIntelHandler, systemAdvisorHandler, automailerHandler, meetingHandler },
  storages: { proactiveAgentStorage, selfImproveStorage, webIntelStorage, systemAdvisorStorage, autonomousPilotStorage },
  sendMessage,
  _getHubSpotClient: () => null,
  ADMIN_CHAT_ID
});
const { startAllCrons, stopAllCrons } = cronManager;

// Restaurer l'etat volatile (bans + historique) depuis le disque
_loadVolatileState();

// --- Trigger Engine init (opt-in via TRIGGER_ENGINE_ENABLED=true) ---
// Note: Trigger Engine cron runs INDEPENDENTLY of appConfig.isProduction()
// because it's read-only (ingestion + pattern matching, no emails sent).
// Safe to run in STANDBY mode for testing / data collection.
let triggerEngine = null;
let triggerEngineCron = null;
if (process.env.TRIGGER_ENGINE_ENABLED === 'true' && TriggerEngineHandler) {
  try {
    triggerEngine = new TriggerEngineHandler({ log });
    const triggerProcessor = new TriggerEngineProcessor(triggerEngine.storage, { log });
    const clientRouter = ClientRouter ? new ClientRouter(triggerEngine.storage, { log }) : null;
    if (clientRouter) {
      try {
        clientRouter.loadSeed();
      } catch (e) {
        log.warn('router', 'Trigger Engine client seed failed: ' + e.message);
      }
    }
    // Claude Brain (opt-in via CLAUDE_BRAIN_ENABLED=true)
    let claudeBrainInstance = null;
    if (ClaudeBrain) {
      try {
        const brainEnabled = process.env.CLAUDE_BRAIN_ENABLED === 'true';
        claudeBrainInstance = new ClaudeBrain(triggerEngine.storage, { log, enabled: brainEnabled });
        if (clientRouter) {
          for (const c of clientRouter.getActiveClients()) {
            claudeBrainInstance.ensureTenantConfig(c.id, {
              monthly_budget_eur: Number(process.env.CLAUDE_BRAIN_BUDGET_MONTHLY_EUR || 300),
              hard_cap_eur: Number(process.env.CLAUDE_BRAIN_BUDGET_HARD_EUR || 500)
            });
          }
        }
        claudeBrainInstance.start();
        log.info('router', `Claude Brain ${brainEnabled ? 'ENABLED' : 'disabled (stub)'} — budget=${process.env.CLAUDE_BRAIN_BUDGET_MONTHLY_EUR || 300}€/tenant/month`);
      } catch (e) {
        log.warn('router', 'Claude Brain init failed: ' + e.message);
      }
    }

    triggerEngineCron = new TriggerEngineCron(triggerEngine, triggerProcessor, { log, clientRouter, claudeBrain: claudeBrainInstance });
    log.info('router', 'Trigger Engine initialized (opt-in enabled)');
    triggerEngineCron.start();
    log.info('router', 'Trigger Engine cron scheduled (independent of STANDBY/PRODUCTION mode)');
  } catch (e) {
    log.warn('router', 'Trigger Engine init failed: ' + e.message);
  }
} else if (TriggerEngineHandler) {
  log.info('router', 'Trigger Engine available but disabled (set TRIGGER_ENGINE_ENABLED=true to activate)');
}

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
    { name: 'OpenAI (NLP routing)', key: OPENAI_KEY },
    { name: 'Claude Opus 4.7 (Trigger Engine)', key: CLAUDE_KEY },
    { name: 'Resend (Email digest + alertes)', key: RESEND_KEY },
    { name: 'Pappers (Attribution SIRENE)', key: process.env.PAPPERS_API_TOKEN },
    { name: 'Dropcontact (Email finder)', key: process.env.DROPCONTACT_API_KEY },
    { name: 'France Travail (Hiring API)', key: process.env.FRANCETRAVAIL_CLIENT_ID },
    { name: 'INPI (Marques)', key: process.env.INPI_USERNAME },
    { name: 'Meta Ad Library', key: process.env.META_AD_LIBRARY_TOKEN },
    { name: 'Folk CRM (à brancher lundi)', key: process.env.FOLK_API_KEY }
  ];

  const emailSafe = SENDER_EMAIL && SENDER_EMAIL !== 'onboarding@resend.dev' && SENDER_EMAIL.trim() !== '';

  const lines = [
    modeEmoji + ' *' + (process.env.CLIENT_NAME || 'iFIND') + ' Trigger Engine v2.0 — ' + modeLabel + '*',
    '_Derniere bascule : ' + new Date(config.lastModeChange).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + '_',
    ''
  ];

  // Composants actifs v2.0
  lines.push('*Composants actifs :*');
  lines.push('  🟢 Trigger Engine (cron + processor + 9 sources FR)');
  lines.push('  🟢 Claude Brain (Opus 4.7 + boosters v1.1)');
  lines.push('  🟢 Inbox Manager (IMAP polling)');
  lines.push('  🟢 Meeting Scheduler (Google Calendar)');

  // APIs
  lines.push('');
  lines.push('*APIs :*');
  for (const api of apiKeys) {
    const ok = api.key && api.key.trim() !== '';
    lines.push('  ' + (ok ? '✅' : '⚠️ MANQUANTE') + ' ' + api.name);
  }

  // Sécurités
  lines.push('');
  lines.push('*Sécurités :*');
  lines.push('  Email sender : ' + (emailSafe ? '✅ Configuré' : '⚠️ Non configuré (test only)'));

  // Boosters
  lines.push('');
  lines.push('*Boosters v1.1 :*');
  lines.push('  ' + (process.env.COMBO_BOOSTER_ENABLED !== 'false' ? '✅' : '⏸️') + ' Combo ×2.5 sur 3 signaux durs <90j');
  lines.push('  ' + (process.env.HOT_TRIGGERS_ENABLED !== 'false' ? '✅' : '⏸️') + ' Hot triggers <48h (+0.5/+1.0)');
  lines.push('  ' + (process.env.DECLARATIVE_PAIN_ENABLED === 'true' ? '✅' : '⏸️') + ' Declarative pain detection (opt-in)');

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
    lines.push('_Dis "active tout" pour passer en production_');
  } else {
    lines.push('_Dis "mode stand by" pour couper les crons_');
  }

  return lines.join('\n');
}

// v2.0-cleanup : userActiveSkill state machine supprimée (NLP routing legacy).
// Le bot Telegram sert désormais uniquement aux notifications admin
// (alertes pépites, digest hebdo, callbacks HITL).

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

  // v2.0-cleanup : NLP routing supprimé. Le bot Telegram sert désormais
  // uniquement aux notifications admin + commandes simples.
  // Les utilisateurs sont redirigés vers le dashboard pour toute interaction
  // métier (Trigger Engine leads, replies, settings).
  if (String(chatId) === String(ADMIN_CHAT_ID)) {
    const helpMsg = [
      '👋 *iFIND Trigger Engine v2.0*',
      '',
      'Commandes disponibles :',
      '  • `statut systeme` — état des composants + APIs + boosters',
      '  • `active tout` / `mode stand by` — toggle crons',
      '  • `mode quiet` / `mode normal` — toggle messages auto',
      '',
      '🎯 Pour les leads + replies + settings → dashboard :',
      `  ${process.env.DASHBOARD_URL || 'https://srv1319748.hstgr.cloud'}`
    ].join('\n');
    addToHistory(chatId, 'bot', 'Help v2.0', 'system');
    await sendMessage(chatId, helpMsg, 'Markdown');
  } else {
    await sendMessage(chatId, 'Bonjour. Le bot iFIND Trigger Engine sert uniquement aux notifications admin. Pour toute demande, contactez Alexis directement.');
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

// ProspectResearcher : legacy, recherche pré-envoi remplacée par Trigger Engine qualify pipeline
const ProspectResearcher = _safeRequire('../skills/autonomous-pilot/prospect-researcher.js', null);

// --- Resend Handler (module extrait) ---
const resendHandlerModule = createResendHandler({
  automailerStorage,
  proactiveAgentStorage,
  _getHubSpotClient: () => null,
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
  getProspectResearcher: () => ProspectResearcher,
  enrichContactWithOrg: _enrichContactWithOrg,
  claudeKey: CLAUDE_KEY
});

// v2.0-cleanup : processChatMessage (NLP routing dashboard chat widget) supprimé.
// Le chat widget dashboard pointe désormais vers Telegram bot direct.

const healthServer = http.createServer(async (req, res) => {
  // v2.0-cleanup : /api/chat NLP routing supprimé. Dashboard chat widget pointe
  // désormais directement sur Telegram (pas de relai NLP via le router).
  if (req.url === '/api/chat' && req.method === 'POST') {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Chat NLP API supprimée v2.0 — utilisez Telegram bot direct' }));
    return;
  }

  // --- HITL API (module extrait) ---
  if (handleHitlApi(req, res)) return;

  // Healthcheck
  if (req.url === '/health' && req.method === 'GET') {
    if (_botReady && _polling) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        version: 'v2.0',
        components: ['trigger-engine', 'claude-brain', 'inbox-manager', 'meeting-scheduler'],
        polling: _polling
      }));
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
    log.info('router', 'Trigger Engine + Inbox + Meeting actifs (legacy v9.5 stubbé)');
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
