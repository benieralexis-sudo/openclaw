// iFIND - Routeur Telegram central (dispatch 13 skills : AutoMailer + CRM Pilot + Lead Enrich + Content Gen + Invoice Bot + Proactive Agent + Self-Improve + Web Intelligence + System Advisor + Autonomous Pilot + Inbox Manager + Meeting Scheduler)

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
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1409505520';

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

// Validation des variables critiques au demarrage
if (!SENDER_EMAIL || SENDER_EMAIL === 'onboarding@resend.dev' || SENDER_EMAIL.trim() === '') {
  log.warn('router', 'SENDER_EMAIL non configure — envoi email desactive (test only: onboarding@resend.dev)');
}
if (!CLAUDE_KEY || CLAUDE_KEY.trim() === '') {
  log.warn('router', 'CLAUDE_API_KEY absent — redaction IA desactivee');
}

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
  apolloKey: APOLLO_KEY,
  openaiKey: OPENAI_KEY,
  claudeKey: CLAUDE_KEY,
  resendKey: RESEND_KEY,
  senderEmail: SENDER_EMAIL,
  adminChatId: ADMIN_CHAT_ID,
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
let inboxListener = null;

// Self-Improve (instancie apres les autres pour le sendTelegram callback)
let selfImproveHandler = null;

let offset = 0;

// --- HITL : Brouillons de reponses en attente de validation humaine ---
const _pendingDrafts = new Map();      // draftId -> { replyData, autoReply, classification, ... }
const _hitlModifyState = new Map();    // chatId -> { draftId, ts }
function _hitlId() { return 'h' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5); }

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
inboxListener = InboxListener ? new InboxListener({
  imapHost: IMAP_HOST,
  imapPort: IMAP_PORT,
  imapUser: IMAP_USER,
  imapPass: IMAP_PASS,
  adminChatId: ADMIN_CHAT_ID,
  sendTelegram: async (chatId, message) => {
    await sendMessage(chatId, message, 'Markdown');
    addToHistory(chatId, 'bot', message.substring(0, 200), 'inbox-manager');
  },
  getKnownLeads: () => {
    // Recuperer les emails envoyes par automailer
    try {
      const amData = automailerStorageForInbox.data || {};
      const emails = amData.emails || [];
      return emails.map(e => ({ email: e.to, to: e.to, name: e.toName || '', campaignId: e.campaignId || null }));
    } catch (e) { return []; }
  },
  onReplyDetected: async (replyData) => {
    const firstName = (replyData.fromName || '').trim().split(' ')[0] || '';
    const replySubject = (replyData.subject || '').startsWith('Re:')
      ? replyData.subject : 'Re: ' + (replyData.subject || 'notre echange');

    // Determiner l'email original (celui auquel on a envoye) — peut differer du from si fuzzy match (.com vs .fr)
    const originalEmail = (replyData.matchedLead && replyData.matchedLead.email)
      ? replyData.matchedLead.email.toLowerCase()
      : replyData.from.toLowerCase();
    const replyFrom = replyData.from.toLowerCase();
    // Collecter les deux adresses a traiter (dedupliquees)
    const emailsToProcess = [originalEmail];
    if (replyFrom !== originalEmail) {
      emailsToProcess.push(replyFrom);
      log.info('inbox-manager', 'Fuzzy match detecte: reply de ' + replyFrom + ' → email original ' + originalEmail);
    }

    // === 1. Marquer comme replied dans automailer ===
    try {
      const emails = (automailerStorageForInbox.data.emails || [])
        .filter(e => e.to && emailsToProcess.includes(e.to.toLowerCase()) && e.status !== 'replied');
      for (const em of emails) {
        automailerStorageForInbox.markAsReplied(em.id);
        log.info('inbox-manager', 'Email ' + em.id + ' marque replied (reponse de ' + replyData.from + ')');
      }
    } catch (e) {
      log.warn('inbox-manager', 'markAsReplied echoue:', e.message);
    }

    // === 2. Classification IA du sentiment ===
    let classification = { sentiment: 'question', score: 0.5, reason: 'Non classifie', key_phrases: [] };
    try {
      classification = await classifyReply(OPENAI_KEY, {
        from: replyData.from,
        fromName: replyData.fromName,
        subject: replyData.subject,
        snippet: replyData.snippet || ''
      });
    } catch (e) {
      log.error('inbox-manager', 'Classification echouee pour ' + replyData.from + ':', e.message);
    }
    const sentiment = classification.sentiment;
    const score = classification.score;
    log.info('inbox-manager', 'Sentiment: ' + sentiment + ' (score=' + score + ') pour ' + replyData.from);

    // === 3. Update CRM HubSpot avec sentiment ===
    try {
      const hubspot = _getHubSpotClient();
      if (hubspot) {
        let contact = null;
        for (const ep of emailsToProcess) {
          contact = await hubspot.findContactByEmail(ep);
          if (contact && contact.id) break;
        }
        if (contact && contact.id) {
          const LABELS = { interested: 'POSITIF', question: 'QUESTION', not_interested: 'NEGATIF', out_of_office: 'OOO', bounce: 'BOUNCE' };
          const noteBody = 'Reponse email recue de ' + replyData.from + '\n' +
            'Sujet : ' + (replyData.subject || '(sans sujet)') + '\n' +
            'Sentiment : ' + (LABELS[sentiment] || sentiment) + ' (score: ' + score + ')\n' +
            'Analyse : ' + (classification.reason || '') + '\n' +
            '[Inbox Manager — classification IA]';
          const note = await hubspot.createNote(noteBody);
          if (note && note.id) await hubspot.associateNoteToContact(note.id, contact.id);
          if (sentiment === 'interested') {
            await hubspot.advanceDealStage(contact.id, 'presentationscheduled', 'reply_interested').catch(() => {});
          }
        }
      }
    } catch (e) {
      log.warn('inbox-manager', 'CRM update echoue:', e.message);
    }

    // === 3a-bis. FEEDBACK LOOP : si ce prospect a recu un auto-reply, tracker l'effectiveness ===
    try {
      const inboxStorageFB = require('../skills/inbox-manager/storage.js');
      const effectiveness = (sentiment === 'interested') ? 'effective' : (sentiment === 'not_interested' ? 'ineffective' : null);
      if (effectiveness) {
        const updated = inboxStorageFB.markAutoReplyEffectiveness(replyData.from, effectiveness);
        if (updated) {
          log.info('inbox-manager', 'Feedback loop: auto-reply ' + updated.id + ' marque ' + effectiveness + ' (re-reponse ' + sentiment + ' de ' + replyData.from + ')');
        }
      }
    } catch (fbErr) { /* feedback loop non bloquante */ }

    // === 3b. HITL AUTO-REPLY : generer draft, soumettre pour validation humaine ===
    // OOO et bounce restent full auto. Tout le reste passe par HITL (interested, question, not_interested).
    let autoReplyHandled = false;
    let hitlDraftCreated = false;
    const autoReplyEnabled = process.env.AUTO_REPLY_ENABLED !== 'false';
    const autoReplyConfidence = parseFloat(process.env.AUTO_REPLY_CONFIDENCE) || 0.8;
    const autoReplyMaxPerDay = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;

    if (autoReplyEnabled && sentiment !== 'bounce') {
      try {
        const inboxStorage = require('../skills/inbox-manager/storage.js');
        const todayCount = inboxStorage.getTodayAutoReplyCount();

        // Les replies HITL ne sont PAS soumises au warmup (ce sont des reponses a une conversation, pas du cold outreach)
        // Seul le guard autoReplyMaxPerDay (10/jour) limite le volume
        if (todayCount < autoReplyMaxPerDay) {
          // Recuperer l'email original envoye a ce prospect
          let originalEmail = null;
          let originalMessageId = null;
          try {
            let existingEmails = [];
            for (const ep of emailsToProcess) {
              existingEmails = existingEmails.concat(automailerStorageForInbox.getEmailEventsForRecipient(ep));
            }
            const lastSent = existingEmails.filter(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').pop();
            if (lastSent) {
              originalEmail = { subject: lastSent.subject, body: lastSent.body, company: lastSent.company };
              originalMessageId = lastSent.messageId || automailerStorageForInbox.getMessageIdForRecipient(originalEmail && lastSent.to);
            }
          } catch (e) { log.warn('inbox-manager', 'Recuperation email original echouee:', e.message); }

          // Contexte client pour la generation
          const clientContext = {
            senderName: process.env.SENDER_NAME || 'Alexis',
            senderTitle: process.env.SENDER_TITLE || '',
            clientDomain: process.env.CLIENT_DOMAIN || 'ifind.fr',
            bookingUrl: ''
          };
          try {
            if (meetingHandler && meetingHandler.gcal && meetingHandler.gcal.isConfigured()) {
              clientContext.bookingUrl = await meetingHandler.gcal.getBookingLink(null, replyData.from, replyData.fromName);
            }
          } catch (e) { log.warn('inbox-manager', 'Booking URL echouee:', e.message); }

          // Helper : quality gate sur un draft (mots interdits + patterns + word count)
          function _checkDraftQuality(autoReply) {
            let warning = null;
            try {
              const apStorageQG = require('../skills/autonomous-pilot/storage.js');
              const apConfigQG = apStorageQG.getConfig ? apStorageQG.getConfig() : {};
              const epQG = apConfigQG.emailPreferences || {};
              if (epQG.forbiddenWords && epQG.forbiddenWords.length > 0) {
                const arText = (autoReply.subject + ' ' + autoReply.body).toLowerCase();
                const found = epQG.forbiddenWords.filter(w => {
                  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  return new RegExp('\\b' + escaped + '\\b', 'i').test(arText);
                });
                if (found.length > 0) warning = 'mots interdits: ' + found.join(', ');
              }
            } catch (e) { log.warn('hitl', 'Forbidden words check: ' + e.message); }
            if (!warning) {
              try {
                const CE = require('../skills/automailer/campaign-engine.js');
                if (CE.emailPassesQualityGate) {
                  const qg = CE.emailPassesQualityGate(autoReply.subject, autoReply.body);
                  if (!qg.pass) warning = 'quality gate: ' + qg.reason;
                }
              } catch (e) { log.warn('hitl', 'Quality gate check: ' + e.message); }
            }
            if (!warning) {
              const wc = (autoReply.body || '').split(/\s+/).filter(w => w.length > 0).length;
              if (wc > 80 || wc < 8) warning = 'word count: ' + wc + ' (8-80 attendu)';
            }
            return warning;
          }

          // --- Cas 1: Objection douce (not_interested) → HITL ---
          if (sentiment === 'not_interested' && score >= 0.15) {
            const subClass = await subClassifyObjection(OPENAI_KEY, replyData, classification);
            log.info('inbox-manager', 'Sub-classification: ' + subClass.type + ' / ' + subClass.objectionType + ' (conf=' + subClass.confidence + ')');

            if (subClass.type === 'soft_objection' && subClass.confidence >= autoReplyConfidence) {
              const autoReply = await generateObjectionReply(callClaude, replyData, classification, subClass, originalEmail, clientContext);

              if (autoReply.body && autoReply.confidence >= autoReplyConfidence) {
                const qualityWarning = _checkDraftQuality(autoReply);
                if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

                const draftId = _hitlId();
                _pendingDrafts.set(draftId, {
                  replyData, classification, subClass, autoReply, originalEmail,
                  originalMessageId, clientContext, sentiment, emailsToProcess,
                  qualityWarning, createdAt: Date.now()
                });
                hitlDraftCreated = true;
                log.info('hitl', 'Draft HITL cree: ' + draftId + ' pour ' + replyData.from + ' (not_interested/' + subClass.objectionType + ')');
              }
            }
          }

          // --- Cas 2: Question → HITL avec auto-send 5 min si grounded, sinon HITL 24h ---
          else if (sentiment === 'question' && score >= 0.4) {
            const snippetLen = (replyData.snippet || '').length;
            if (snippetLen < 1500) {
              const autoReply = await generateQuestionReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext);

              if (autoReply.body && autoReply.confidence >= autoReplyConfidence) {
                const qualityWarning = _checkDraftQuality(autoReply);
                if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

                // Grounding check : la reponse utilise-t-elle uniquement des faits du KB ?
                const grounding = checkGrounding(autoReply.body);
                const isGrounded = grounding.grounded && !qualityWarning;

                const draftId = _hitlId();
                _pendingDrafts.set(draftId, {
                  replyData, classification, subClass: { type: 'simple_question', objectionType: '' },
                  autoReply, originalEmail, originalMessageId, clientContext,
                  sentiment, emailsToProcess, qualityWarning, createdAt: Date.now(),
                  _grounded: isGrounded
                });
                hitlDraftCreated = true;
                const autoMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : 'HITL 24h';
                log.info('hitl', 'Draft cree: ' + draftId + ' pour ' + replyData.from + ' (question, grounded=' + isGrounded + ', auto-send=' + autoMin + (isGrounded ? 'min' : '') + ')');
              }
            }
          }

          // --- Cas 3: Interested → AUTO-REPLY IMMEDIAT si haute confiance, sinon HITL ---
          else if (sentiment === 'interested') {
            const autoReply = await generateInterestedReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext);

            if (autoReply.body) {
              const qualityWarning = _checkDraftQuality(autoReply);
              if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

              const autoSendThreshold = parseFloat(process.env.AUTO_REPLY_INTERESTED_THRESHOLD) || 0.85;

              // HIGH CONFIDENCE + pas de warning → FULL AUTO (envoie immediatement)
              if (score >= autoSendThreshold && !qualityWarning && autoReply.confidence >= 0.85) {
                try {
                  const ResendClient = require('../skills/automailer/resend-client.js');
                  const resendClient = new ResendClient(RESEND_KEY, SENDER_EMAIL);
                  const sendResult = await resendClient.sendEmail(
                    replyData.from,
                    autoReply.subject,
                    autoReply.body,
                    {
                      inReplyTo: originalMessageId,
                      references: originalMessageId,
                      fromName: clientContext.senderName
                    }
                  );

                  if (sendResult && sendResult.success) {
                    if (automailerStorageForInbox.setFirstSendDate) automailerStorageForInbox.setFirstSendDate();
                    automailerStorageForInbox.incrementTodaySendCount();

                    // Tracker dans inbox-manager storage
                    try {
                      const inboxStorage = require('../skills/inbox-manager/storage.js');
                      inboxStorage.addAutoReply({
                        prospectEmail: replyData.from,
                        prospectName: replyData.fromName,
                        sentiment: 'interested',
                        subClassification: 'auto_instant',
                        objectionType: '',
                        replyBody: autoReply.body,
                        replySubject: autoReply.subject,
                        originalEmailId: originalEmail && originalEmail.subject,
                        confidence: autoReply.confidence,
                        sendResult: sendResult
                      });
                    } catch (e) { log.warn('auto-reply', 'Record stats: ' + e.message); }

                    // Stocker messageId pour threading futur
                    if (sendResult.messageId) {
                      automailerStorageForInbox.addEmail({
                        to: replyData.from,
                        subject: autoReply.subject,
                        body: autoReply.body,
                        source: 'auto_reply_interested',
                        status: 'sent',
                        messageId: sendResult.messageId,
                        chatId: ADMIN_CHAT_ID
                      });
                    }

                    // Auto-proposer un meeting dans le scheduler (tracking)
                    try {
                      if (meetingHandler) {
                        const company = (originalEmail && originalEmail.company) || '';
                        await meetingHandler.proposeAutoMeeting(replyData.from, replyData.fromName || firstName, company);
                      }
                    } catch (mtgErr) { log.warn('auto-reply', 'Auto-meeting proposal: ' + mtgErr.message); }

                    autoReplyHandled = true;
                    log.info('auto-reply', 'REPONSE AUTO INSTANTANEE envoyee a ' + replyData.from + ' (score=' + score + ', conf=' + autoReply.confidence + ')');
                  } else {
                    log.error('auto-reply', 'Echec envoi auto pour ' + replyData.from + ': ' + (sendResult && sendResult.error));
                    // Fallback HITL si l'envoi echoue
                    const draftId = _hitlId();
                    _pendingDrafts.set(draftId, {
                      replyData, classification, subClass: { type: 'interested', objectionType: '' },
                      autoReply, originalEmail, originalMessageId, clientContext,
                      sentiment, emailsToProcess, qualityWarning, createdAt: Date.now()
                    });
                    hitlDraftCreated = true;
                  }
                } catch (sendErr) {
                  log.error('auto-reply', 'Erreur envoi auto:', sendErr.message);
                  // Fallback HITL
                  const draftId = _hitlId();
                  _pendingDrafts.set(draftId, {
                    replyData, classification, subClass: { type: 'interested', objectionType: '' },
                    autoReply, originalEmail, originalMessageId, clientContext,
                    sentiment, emailsToProcess, qualityWarning, createdAt: Date.now()
                  });
                  hitlDraftCreated = true;
                }
              }
              // LOW CONFIDENCE ou quality warning → HITL avec grounding check
              else {
                const grounding = checkGrounding(autoReply.body);
                const isGrounded = grounding.grounded && !qualityWarning;

                const draftId = _hitlId();
                _pendingDrafts.set(draftId, {
                  replyData, classification, subClass: { type: 'interested', objectionType: '' },
                  autoReply, originalEmail, originalMessageId, clientContext,
                  sentiment, emailsToProcess, qualityWarning, createdAt: Date.now(),
                  _grounded: isGrounded
                });
                hitlDraftCreated = true;
                const autoMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : 'HITL 24h';
                log.info('hitl', 'Draft cree: ' + draftId + ' pour ' + replyData.from + ' (interested, grounded=' + isGrounded + ', auto-send=' + autoMin + (isGrounded ? 'min' : '') + ')');
              }
            }
          }

          // --- Cas 4: OOO — reschedule automatique (FULL AUTO, pas de HITL) ---
          else if (sentiment === 'out_of_office') {
            try {
              const returnDate = parseOOOReturnDate(replyData.snippet);
              let scheduledDate;
              if (returnDate) {
                const returnTs = new Date(returnDate).getTime();
                scheduledDate = new Date(returnTs + 7 * 24 * 60 * 60 * 1000).toISOString();
              } else {
                scheduledDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
              }

              inboxStorage.addOOOReschedule({
                prospectEmail: replyData.from,
                prospectName: replyData.fromName || firstName,
                returnDate: returnDate,
                scheduledFollowUpAt: scheduledDate
              });

              try {
                const proactiveStorage = require('../skills/proactive-agent/storage.js');
                proactiveStorage.addPendingFollowUp({
                  prospectEmail: replyData.from,
                  prospectName: replyData.fromName || firstName,
                  prospectCompany: (originalEmail && originalEmail.company) || '',
                  originalSubject: (originalEmail && originalEmail.subject) || '',
                  originalBody: (originalEmail && originalEmail.body || '').substring(0, 300),
                  prospectIntel: 'OOO detecte. Retour prevu: ' + (returnDate || 'inconnu') + '. Reschedule automatique.',
                  scheduledAfter: scheduledDate,
                  isOOO: true
                });
              } catch (e) { log.warn('inbox-manager', 'Follow-up proactif OOO echoue:', e.message); }

              autoReplyHandled = true;
              log.info('inbox-manager', 'OOO reschedule pour ' + replyData.from + ' → follow-up prevu le ' + scheduledDate.substring(0, 10));
            } catch (e) {
              log.warn('inbox-manager', 'OOO reschedule echoue:', e.message);
            }
          }
        } else {
          log.info('inbox-manager', 'Auto-reply limite atteinte (' + todayCount + '/' + autoReplyMaxPerDay + ') — fallback human takeover');
        }
      } catch (autoReplyErr) {
        log.warn('inbox-manager', 'Auto-reply pipeline echoue:', autoReplyErr.message);
      }
    }

    // === 4. HUMAN TAKEOVER / HITL PENDING : decider l'action selon le resultat du pipeline ===
    let actionTaken;
    if (autoReplyHandled) actionTaken = 'auto_reply_' + sentiment;
    else if (hitlDraftCreated) actionTaken = 'hitl_pending_' + sentiment;
    else actionTaken = 'human_takeover';

    // Blacklister les bounces (pas de relais humain necessaire)
    if (sentiment === 'bounce') {
      actionTaken = 'bounce_blacklist';
      try {
        for (const ep of emailsToProcess) {
          automailerStorageForInbox.addToBlacklist(ep, 'bounce_detected');
        }
      } catch (e) { log.warn('inbox', 'Bounce blacklist: ' + e.message); }
      log.info('inbox-manager', emailsToProcess.join(' + ') + ' blackliste (bounce)');
    }
    // not_interested avec HITL draft : NE PAS blacklister, on attend la validation
    else if (sentiment === 'not_interested' && hitlDraftCreated) {
      log.info('hitl', 'Draft HITL en attente pour ' + replyData.from + ' (not_interested) — pas de blacklist');
    }
    // not_interested SANS draft (hard objection / low confidence) : blacklister
    else if (sentiment === 'not_interested' && !hitlDraftCreated) {
      actionTaken = 'polite_decline_blacklist';
      try {
        for (const ep of emailsToProcess) {
          automailerStorageForInbox.addToBlacklist(ep, 'prospect_declined');
        }
        log.info('inbox-manager', emailsToProcess.join(' + ') + ' blackliste (decline) — human takeover');
      } catch (e) { log.warn('inbox', 'Decline blacklist: ' + e.message); }
    }
    // OOO : si reschedule auto → deferred_ooo_rescheduled, sinon deferred_ooo
    else if (sentiment === 'out_of_office') {
      actionTaken = autoReplyHandled ? 'deferred_ooo_rescheduled' : 'deferred_ooo';
      log.info('inbox-manager', replyData.from + ' absent (OOO) — ' + (autoReplyHandled ? 'reschedule auto programme' : 'pas de relais humain'));
    }
    // HITL draft cree (interested ou question) : stopper les relances mais NE PAS blacklister
    else if (hitlDraftCreated) {
      log.info('hitl', 'Draft HITL en attente pour ' + replyData.from + ' (sentiment=' + sentiment + ')');
    }
    // INTERESTED / QUESTION / autre avec auto-reply deja envoye
    else if (autoReplyHandled) {
      actionTaken = 'auto_reply_' + sentiment;
      log.info('inbox-manager', 'Auto-reply ' + sentiment + ' envoye a ' + replyData.from + ' — le bot a gere');
    }
    else {
      actionTaken = 'human_takeover';
      log.info('inbox-manager', '🤝 HUMAN TAKEOVER: ' + replyData.from + ' (sentiment=' + sentiment + ') — le bot arrete, l\'humain prend le relais');
      // PAS de blacklist : l'humain decide via Telegram ou manuellement
      // Les relances auto sont bloquees par hasReplied (ci-dessous), pas par la blacklist

      // Marquer hasReplied sur TOUS les emails envoyes a ce prospect (les deux adresses)
      try {
        let totalMarked = 0;
        for (const ep of emailsToProcess) {
          const allEmails = automailerStorageForInbox.getEmailEventsForRecipient(ep);
          for (const em of allEmails) {
            if (em.id && !em.hasReplied) {
              automailerStorageForInbox.updateEmailStatus(em.id, em.status || 'replied', { hasReplied: true, repliedAt: new Date().toISOString() });
              totalMarked++;
            }
          }
        }
        log.info('inbox-manager', 'hasReplied=true marque sur ' + totalMarked + ' emails pour ' + emailsToProcess.join(' + '));
      } catch (e) {
        log.warn('inbox-manager', 'Marquage hasReplied echoue:', e.message);
      }

      // Annuler les reactive follow-ups pending pour ce prospect (les deux adresses)
      try {
        const proactiveStorage = require('../skills/proactive-agent/storage.js');
        const pendingFUs = proactiveStorage.getPendingFollowUps();
        for (const fu of pendingFUs) {
          if (fu.prospectEmail && emailsToProcess.includes(fu.prospectEmail.toLowerCase())) {
            proactiveStorage.markFollowUpFailed(fu.id, 'human_takeover: prospect replied');
            log.info('inbox-manager', 'Reactive FU annule pour ' + fu.prospectEmail + ' (human takeover)');
          }
        }
      } catch (e) {
        log.warn('inbox-manager', 'Annulation reactive FU echouee:', e.message);
      }

      // Multi-Threading : marquer l'entreprise comme "replied" → stopper TOUS les contacts secondaires
      try {
        const ffStorage = require('../skills/flowfast/storage.js');
        if (ffStorage && ffStorage.markCompanyReplied) {
          for (const ep of emailsToProcess) {
            const updatedGroup = ffStorage.markCompanyReplied(ep);
            if (updatedGroup) {
              const cancelled = updatedGroup.contacts.filter(c => c.status === 'cancelled').length;
              if (cancelled > 0) {
                log.info('inbox-manager', 'Multi-thread: entreprise ' + updatedGroup.companyName + ' replied → ' + cancelled + ' contact(s) secondaire(s) annule(s)');
              }
            }
          }
        }
      } catch (e) {
        log.warn('inbox-manager', 'Multi-thread markCompanyReplied echoue:', e.message);
      }
    }

    // HITL pending : stopper les relances auto mais NE PAS blacklister (en attente de validation)
    if (hitlDraftCreated) {
      try {
        let totalMarked = 0;
        for (const ep of emailsToProcess) {
          const allEmails = automailerStorageForInbox.getEmailEventsForRecipient(ep);
          for (const em of allEmails) {
            if (em.id && !em.hasReplied) {
              automailerStorageForInbox.updateEmailStatus(em.id, em.status || 'replied', { hasReplied: true, repliedAt: new Date().toISOString() });
              totalMarked++;
            }
          }
        }
        if (totalMarked > 0) log.info('hitl', 'hasReplied=true marque sur ' + totalMarked + ' emails (HITL pending) pour ' + emailsToProcess.join(' + '));
      } catch (e) { log.warn('hitl', 'Mark hasReplied: ' + e.message); }
      // Annuler les reactive follow-ups
      try {
        const proactiveStorage = require('../skills/proactive-agent/storage.js');
        const pendingFUs = proactiveStorage.getPendingFollowUps();
        for (const fu of pendingFUs) {
          if (fu.prospectEmail && emailsToProcess.includes(fu.prospectEmail.toLowerCase())) {
            proactiveStorage.markFollowUpFailed(fu.id, 'hitl_pending: draft en attente validation');
          }
        }
      } catch (e) { log.warn('hitl', 'Cancel follow-ups: ' + e.message); }
    }

    // === 5. Update storage inbox-manager avec sentiment ===
    try {
      const inboxStorage = require('../skills/inbox-manager/storage.js');
      for (const ep of emailsToProcess) {
        inboxStorage.updateSentimentByEmail(ep, {
          sentiment: sentiment, score: score, reason: classification.reason, actionTaken: actionTaken
        });
      }
    } catch (e) { log.warn('inbox-manager', 'Storage sentiment update echoue:', e.message); }

    // === 5b. Propager sentiment vers automailer (cross-skill) ===
    try {
      if (automailerStorageForInbox.setSentiment) {
        for (const ep of emailsToProcess) {
          automailerStorageForInbox.setSentiment(ep, sentiment, score);
        }
        log.info('inbox-manager', 'Sentiment propage vers automailer: ' + emailsToProcess.join(' + ') + ' → ' + sentiment);
      }
    } catch (e) { log.warn('inbox-manager', 'Propagation sentiment automailer echouee:', e.message); }

    // === 6. Notification Telegram enrichie ===
    const EMOJIS = { interested: '🟢🔥', question: '🟡❓', not_interested: '🔴👋', out_of_office: '🏖️', bounce: '💀' };
    const SLABELS = { interested: 'INTERESSE', question: 'QUESTION', not_interested: 'PAS INTERESSE', out_of_office: 'ABSENT', bounce: 'BOUNCE' };
    const ALABELS = {
      human_takeover: '🤝 HUMAN TAKEOVER — reponds-lui !',
      polite_decline_blacklist: '👋 Blackliste (decline)',
      deferred_ooo: '🏖️ Reporte (OOO)',
      deferred_ooo_rescheduled: '🏖️📅 OOO — relance auto programmee',
      bounce_blacklist: '💀 Blackliste (bounce)',
      auto_reply_interested: '🚀⚡ REPONSE AUTO INSTANTANEE — booking propose !',
      auto_reply_not_interested: '🤖💬 Bot a contre-argumente',
      auto_reply_question: '🤖💬 Bot a repondu a la question',
      auto_reply_out_of_office: '🤖📅 OOO — relance auto programmee',
      hitl_pending_interested: '📝 Brouillon pret — valide sur Telegram !',
      hitl_pending_question: '📝 Brouillon pret — valide sur Telegram !',
      hitl_pending_not_interested: '📝 Brouillon pret — valide sur Telegram !',
      none: '—'
    };
    const notifLines = [
      (EMOJIS[sentiment] || '❓') + ' *Reponse prospect — ' + (SLABELS[sentiment] || sentiment) + '*',
      '',
      '👤 *' + escTg(replyData.fromName || replyData.from) + '*',
      '📧 ' + escTg(replyData.from),
      '📋 ' + escTg(replyData.subject || '(sans sujet)'),
      '📊 Score : ' + score + '/1.0'
    ];
    if (replyData.snippet) {
      notifLines.push('');
      notifLines.push('💬 *Sa reponse :*');
      notifLines.push('_' + escTg(replyData.snippet.substring(0, 300)) + (replyData.snippet.length > 300 ? '...' : '') + '_');
    }
    notifLines.push('');
    notifLines.push('💡 ' + escTg(classification.reason || ''));

    // Contexte : inclure l'email original qu'on lui avait envoye (chercher les deux adresses)
    try {
      let existingEmails = [];
      for (const ep of emailsToProcess) {
        existingEmails = existingEmails.concat(automailerStorageForInbox.getEmailEventsForRecipient(ep));
      }
      const lastSent = existingEmails.filter(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').pop();
      if (lastSent) {
        notifLines.push('');
        notifLines.push('📤 *Ton email original :*');
        notifLines.push('Sujet : ' + escTg(lastSent.subject || ''));
        if (lastSent.body) {
          notifLines.push('_' + escTg(lastSent.body.substring(0, 250)) + (lastSent.body.length > 250 ? '...' : '') + '_');
        }
        if (lastSent.company) {
          notifLines.push('🏢 ' + escTg(lastSent.company));
        }
      }
    } catch (ctxErr) {}

    // === HITL : notification enrichie avec brouillon + boutons ===
    if (hitlDraftCreated) {
      // Trouver le draft cree pour ce prospect
      let hitlDraftId = null;
      let hitlDraft = null;
      for (const [id, d] of _pendingDrafts) {
        if (d.replyData.from === replyData.from && Date.now() - d.createdAt < 60000) {
          hitlDraftId = id;
          hitlDraft = d;
        }
      }

      if (hitlDraft && hitlDraftId) {
        const isGrounded = hitlDraft._grounded !== false;
        const autoSendMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : null;

        notifLines.push('');
        notifLines.push('━━━━━━━━━━━━━━━━━━');
        if (isGrounded && autoSendMin) {
          notifLines.push('⚡ *ENVOI AUTO DANS ' + autoSendMin + ' MIN* — Annule ou modifie ci\\-dessous');
        } else {
          notifLines.push('📝 *Brouillon — validation requise*');
        }
        notifLines.push('_Objet : ' + escTg(hitlDraft.autoReply.subject) + '_');
        notifLines.push('');
        notifLines.push(escTg(hitlDraft.autoReply.body));
        notifLines.push('');
        notifLines.push('📊 Confiance : ' + (hitlDraft.autoReply.confidence || 0).toFixed(2) + (isGrounded ? ' \\| 🟢 Grounded KB' : ' \\| 🔴 Non\\-grounded'));
        if (hitlDraft.subClass && hitlDraft.subClass.objectionType) {
          notifLines.push('📋 Type : ' + escTg(hitlDraft.subClass.objectionType));
        }
        if (hitlDraft.qualityWarning) {
          notifLines.push('');
          notifLines.push('⚠️ *Quality gate :* ' + escTg(hitlDraft.qualityWarning));
        }
        notifLines.push('');
        if (isGrounded && autoSendMin) {
          notifLines.push('⏳ _Envoi auto dans ' + autoSendMin + ' min si pas d\'action\\._');
        } else {
          notifLines.push('🔒 _Reponse hors KB — validation humaine obligatoire\\. Expire dans 24h\\._');
        }

        // Boutons : grounded = Annuler en premier (default = envoi), non-grounded = Accepter en premier (default = attente)
        const buttons = isGrounded ? [
          [
            { text: '🛑 Annuler', callback_data: 'hitl_skip_' + hitlDraftId },
            { text: '✏️ Modifier', callback_data: 'hitl_modify_' + hitlDraftId },
          ],
          [
            { text: '⚡ Envoyer maintenant', callback_data: 'hitl_accept_' + hitlDraftId },
            { text: '🚫 Blacklister', callback_data: 'hitl_ignore_' + hitlDraftId }
          ]
        ] : [
          [
            { text: '✅ Accepter', callback_data: 'hitl_accept_' + hitlDraftId },
            { text: '✏️ Modifier', callback_data: 'hitl_modify_' + hitlDraftId },
          ],
          [
            { text: '⏭️ Passer', callback_data: 'hitl_skip_' + hitlDraftId },
            { text: '🚫 Blacklister', callback_data: 'hitl_ignore_' + hitlDraftId }
          ]
        ];

        await sendMessageWithButtons(ADMIN_CHAT_ID, notifLines.join('\n'), buttons);
      } else {
        // Fallback : pas de draft trouve
        notifLines.push('');
        notifLines.push('⚠️ _Erreur creation draft — reponds manuellement._');
        notifLines.push('');
        notifLines.push('⚡ *Action :* ' + (ALABELS[actionTaken] || actionTaken));
        await sendMessage(ADMIN_CHAT_ID, notifLines.join('\n'), 'Markdown');
      }
    }
    // Si auto-reply envoye (OOO), montrer la reponse du bot
    else if (autoReplyHandled && actionTaken.startsWith('auto_reply_')) {
      try {
        const inboxStorage = require('../skills/inbox-manager/storage.js');
        const recentAR = inboxStorage.getAutoReplies(1);
        if (recentAR.length > 0 && recentAR[0].replyBody) {
          notifLines.push('');
          notifLines.push('🤖 *Reponse du bot :*');
          notifLines.push('_' + escTg(recentAR[0].replyBody.substring(0, 400)) + '_');
          if (recentAR[0].objectionType) {
            notifLines.push('📋 Type: ' + escTg(recentAR[0].objectionType));
          }
          notifLines.push('📊 Confiance: ' + (recentAR[0].confidence || 0).toFixed(2));
        }
      } catch (e) { log.warn('hitl', 'Notif auto-reply context: ' + e.message); }
      notifLines.push('');
      notifLines.push('⚡ *Action :* ' + (ALABELS[actionTaken] || actionTaken));
      await sendMessage(ADMIN_CHAT_ID, notifLines.join('\n'), 'Markdown');
    }
    // Notification classique (human_takeover, bounce, decline)
    else {
      notifLines.push('');
      notifLines.push('⚡ *Action :* ' + (ALABELS[actionTaken] || actionTaken));
      if (actionTaken === 'human_takeover') {
        notifLines.push('');
        notifLines.push('🚨 _Le bot a ARRETE toute automation pour ce prospect\\. Reponds\\-lui manuellement\\!_');
        try {
          if (meetingHandler.gcal && meetingHandler.gcal.isConfigured()) {
            const bookingUrl = await meetingHandler.gcal.getBookingLink(null, replyData.from, replyData.fromName);
            if (bookingUrl) {
              notifLines.push('');
              notifLines.push('📅 *Lien RDV rapide :*');
              notifLines.push(bookingUrl);
            }
          }
        } catch (e) { /* silent — best effort */ }
      }
      await sendMessage(ADMIN_CHAT_ID, notifLines.join('\n'), 'Markdown');
    }
  }
}) : null;

// Demarrer le listener IMAP si configure
if (inboxListener && inboxListener.isConfigured()) {
  inboxListener.start().catch(e => log.error('router', 'Erreur demarrage IMAP:', e.message));
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
        const summary = '✅ *Rapport termine pour ' + prospectData.prenom + '*\n\n' +
          '📊 ' + (result.leads ? result.leads.length : 0) + ' leads trouves et scores\n' +
          (result.sent && result.sent.method === 'email'
            ? '📧 Envoye par email a ' + prospectData.email
            : '💾 Sauvegarde en fichier (domaine email non configure)');
        await sendMessage(chatId, summary, 'Markdown');
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

// handleResendWebhook extrait dans resend-handler.js

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

  // --- HITL API (draft approval via dashboard, auth required) ---
  if (req.url === '/api/hitl/drafts' && req.method === 'GET') {
    const hitlToken = (req.headers['x-api-token'] || req.headers['authorization'] || '').replace('Bearer ', '');
    if (!hitlToken || (hitlToken !== process.env.DASHBOARD_PASSWORD && hitlToken !== process.env.AUTOMAILER_DASHBOARD_PASSWORD)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const drafts = [];
    const now = Date.now();
    const TTL = 24 * 60 * 60 * 1000;
    for (const [id, d] of _pendingDrafts) {
      const age = now - (d.createdAt || 0);
      if (age < TTL) {
        drafts.push({
          id,
          prospectEmail: d.replyData?.from || '',
          prospectName: d.replyData?.fromName || '',
          incomingSubject: d.replyData?.subject || '',
          incomingSnippet: d.replyData?.snippet || '',
          subject: d.autoReply?.subject || '',
          body: d.autoReply?.body || '',
          sentiment: d.sentiment || d.classification?.sentiment || '',
          subType: d.subClass?.type || '',
          objectionType: d.subClass?.objectionType || '',
          confidence: d.autoReply?.confidence || 0,
          qualityWarning: d.qualityWarning || null,
          company: d.originalEmail?.company || '',
          grounded: d._grounded !== false,
          autoSendAt: d.createdAt ? new Date(d.createdAt + ((d._grounded !== false) ? HITL_AUTOSEND_GROUNDED : HITL_AUTOSEND_UNGROUNDED)).toISOString() : null,
          createdAt: d.createdAt || 0,
          expiresIn: Math.max(0, TTL - age)
        });
      }
    }
    drafts.sort((a, b) => b.createdAt - a.createdAt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(drafts));
    return;
  }

  if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/approve$/) && req.method === 'POST') {
    const draftId = req.url.split('/')[4];
    try {
      const draft = _pendingDrafts.get(draftId);
      if (!draft) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
        return;
      }
      if (draft._inFlight) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft en cours de traitement' }));
        return;
      }
      draft._inFlight = true;
      const ResendClient = require('../skills/automailer/resend-client.js');
      const resendClient = new ResendClient(RESEND_KEY, SENDER_EMAIL);
      const sendResult = await resendClient.sendEmail(
        draft.replyData.from, draft.autoReply.subject, draft.autoReply.body,
        { inReplyTo: draft.originalMessageId, references: draft.originalMessageId, fromName: draft.clientContext?.senderName }
      );
      if (sendResult && sendResult.success) {
        if (automailerStorageForInbox.setFirstSendDate) automailerStorageForInbox.setFirstSendDate();
        automailerStorageForInbox.incrementTodaySendCount();
        try {
          const inboxStorage = require('../skills/inbox-manager/storage.js');
          inboxStorage.addAutoReply({ prospectEmail: draft.replyData.from, prospectName: draft.replyData.fromName, sentiment: draft.sentiment, subClassification: draft.subClass ? draft.subClass.type : 'hitl', objectionType: draft.subClass ? draft.subClass.objectionType : '', replyBody: draft.autoReply.body, replySubject: draft.autoReply.subject, originalEmailId: draft.originalEmail && draft.originalEmail.subject, confidence: draft.autoReply.confidence, sendResult });
        } catch (e) {}
        if (sendResult.messageId) {
          automailerStorageForInbox.addEmail({ to: draft.replyData.from, subject: draft.autoReply.subject, body: draft.autoReply.body, source: 'hitl_reply', status: 'sent', messageId: sendResult.messageId, chatId: ADMIN_CHAT_ID });
        }
        log.info('hitl', 'Reponse HITL (dashboard) envoyee a ' + draft.replyData.from);
        _pendingDrafts.delete(draftId);
        _saveHitlDrafts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, to: draft.replyData.from }));
      } else {
        draft._inFlight = false;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Échec envoi: ' + (sendResult?.error || 'inconnu') }));
      }
    } catch (e) {
      log.error('hitl', 'Erreur approve dashboard:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Skip (sans blacklist) — pour repondre manuellement
  if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/skip$/) && req.method === 'POST') {
    const draftId = req.url.split('/')[4];
    const draft = _pendingDrafts.get(draftId);
    if (!draft) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
      return;
    }
    _pendingDrafts.delete(draftId);
    log.info('hitl', 'Draft passe (dashboard, sans blacklist): ' + draftId + ' pour ' + draft.replyData.from);
    _saveHitlDrafts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, prospect: draft.replyData.from, action: 'skipped' }));
    return;
  }

  // Reject (avec blacklist)
  if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/reject$/) && req.method === 'POST') {
    const draftId = req.url.split('/')[4];
    const draft = _pendingDrafts.get(draftId);
    if (!draft) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
      return;
    }
    if (draft._inFlight) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Draft en cours de traitement' }));
      return;
    }
    draft._inFlight = true;
    _pendingDrafts.delete(draftId);
    try {
      for (const ep of (draft.emailsToProcess || [draft.replyData.from])) {
        automailerStorageForInbox.addToBlacklist(ep, 'hitl_blacklisted: dashboard');
      }
    } catch (e) {}
    log.info('hitl', 'Draft rejete+blackliste (dashboard): ' + draftId + ' pour ' + draft.replyData.from);
    _saveHitlDrafts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, prospect: draft.replyData.from, action: 'blacklisted' }));
    return;
  }

  if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/edit$/) && req.method === 'POST') {
    const draftId = req.url.split('/')[4];
    let body = '';
    req.on('data', (chunk) => { if (body.length < 10240) body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (!data.body || typeof data.body !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'body requis' }));
          return;
        }
        const draft = _pendingDrafts.get(draftId);
        if (!draft) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
          return;
        }
        if (draft._inFlight) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Draft en cours de traitement' }));
          return;
        }
        draft._inFlight = true;
        const editedBody = data.body.trim();
        // Quality gate on edited draft
        const qWarnings = [];
        if (editedBody.length < 20) qWarnings.push('Message trop court (<20 caractères)');
        const cDomain = (process.env.CLIENT_DOMAIN || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const safeDomainRe = new RegExp('https?:\\/\\/(?:' + (cDomain || 'x-no-match') + '|calendly\\.com|cal\\.com)', 'i');
        if (/https?:\/\/[^\s]+/i.test(editedBody) && !safeDomainRe.test(editedBody)) qWarnings.push('Lien externe suspect');
        const spamWords = ['gratuit', 'promotion', 'cliquez ici', 'offre exclusive', 'urgent', 'act now', 'free trial'];
        const bodyLow = editedBody.toLowerCase();
        for (const sw of spamWords) { if (bodyLow.includes(sw)) { qWarnings.push('Mot spam: ' + sw); break; } }
        if (qWarnings.length > 0) {
          log.warn('hitl', 'Quality warnings on dashboard edit ' + draftId + ': ' + qWarnings.join(', '));
        }
        draft.autoReply.body = editedBody;
        const ResendClient = require('../skills/automailer/resend-client.js');
        const resendClient = new ResendClient(RESEND_KEY, SENDER_EMAIL);
        const sendResult = await resendClient.sendEmail(
          draft.replyData.from, draft.autoReply.subject, draft.autoReply.body,
          { inReplyTo: draft.originalMessageId, references: draft.originalMessageId, fromName: draft.clientContext?.senderName }
        );
        if (sendResult && sendResult.success) {
          if (automailerStorageForInbox.setFirstSendDate) automailerStorageForInbox.setFirstSendDate();
          automailerStorageForInbox.incrementTodaySendCount();
          try {
            const inboxStorage = require('../skills/inbox-manager/storage.js');
            inboxStorage.addAutoReply({ prospectEmail: draft.replyData.from, prospectName: draft.replyData.fromName, sentiment: draft.sentiment, subClassification: draft.subClass ? draft.subClass.type : 'hitl', objectionType: draft.subClass ? draft.subClass.objectionType : '', replyBody: draft.autoReply.body, replySubject: draft.autoReply.subject, originalEmailId: draft.originalEmail && draft.originalEmail.subject, confidence: draft.autoReply.confidence, sendResult });
          } catch (e) {}
          if (sendResult.messageId) {
            automailerStorageForInbox.addEmail({ to: draft.replyData.from, subject: draft.autoReply.subject, body: draft.autoReply.body, source: 'hitl_reply_edited', status: 'sent', messageId: sendResult.messageId, chatId: ADMIN_CHAT_ID });
          }
          log.info('hitl', 'Reponse HITL editee (dashboard) envoyee a ' + draft.replyData.from);
          _pendingDrafts.delete(draftId);
          _saveHitlDrafts();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, to: draft.replyData.from }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Échec envoi: ' + (sendResult?.error || 'inconnu') }));
        }
      } catch (e) {
        log.error('hitl', 'Erreur edit dashboard:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

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

  // Webhook Resend
  if (req.url && req.url.startsWith('/webhook/resend') && req.method === 'POST') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 100 * 1024; // 100KB max
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

      // --- Verification signature Svix/Resend (HMAC-SHA256) ---
      if (WEBHOOK_SECRET) {
        const svixId = req.headers['svix-id'];
        const svixTimestamp = req.headers['svix-timestamp'];
        const svixSignature = req.headers['svix-signature'];

        if (svixId && svixTimestamp && svixSignature) {
          // Verifier le timestamp (tolerance 5 min pour anti-replay)
          const ts = parseInt(svixTimestamp, 10);
          const now = Math.floor(Date.now() / 1000);
          if (Math.abs(now - ts) > 300) {
            log.warn('webhook', 'Timestamp Svix expire (delta: ' + (now - ts) + 's)');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'timestamp expired' }));
            return;
          }

          // Calculer le HMAC-SHA256
          const signedContent = svixId + '.' + svixTimestamp + '.' + body;
          // Le secret Resend peut etre au format whsec_xxx (base64) ou hex brut
          let secretBytes;
          if (WEBHOOK_SECRET.startsWith('whsec_')) {
            secretBytes = Buffer.from(WEBHOOK_SECRET.slice(6), 'base64');
          } else {
            secretBytes = Buffer.from(WEBHOOK_SECRET, 'hex');
          }
          const crypto = require('crypto');
          const expectedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

          // svix-signature contient "v1,<sig1> v1,<sig2> ..." — verifier contre chaque
          const signatures = svixSignature.split(' ').map(s => s.replace('v1,', ''));
          const valid = signatures.some(sig => {
            try {
              return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig));
            } catch (e) { return false; }
          });

          if (!valid) {
            log.warn('webhook', 'Signature Svix invalide — webhook rejete');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid signature' }));
            return;
          }
        } else {
          // Pas de headers Svix et secret configure → rejeter (plus de fallback query param)
          log.warn('webhook', 'Headers Svix absents — webhook rejete (configurez Resend pour envoyer les headers svix-*)');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      } else {
        log.error('webhook', 'RESEND_WEBHOOK_SECRET non configure — webhook REJETE');
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'webhook_secret_not_configured' }));
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

  // === CLICK TRACKING REDIRECT — GET /c/:trackingId?url=X ===
  if (req.method === 'GET' && req.url && req.url.startsWith('/c/')) {
    const clickMatch = req.url.match(/^\/c\/([a-f0-9]{32})/);
    const clickUrlObj = new URL(req.url, 'http://localhost');
    const redirectUrl = clickUrlObj.searchParams.get('url');
    if (!clickMatch || !redirectUrl || !/^https?:\/\//i.test(redirectUrl)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
      return;
    }
    const clickTrackingId = clickMatch[1];
    // Redirect immediately
    res.writeHead(302, { 'Location': redirectUrl, 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' });
    res.end();
    // Record click asynchronously
    try {
      const email = automailerStorage.findEmailByTrackingId(clickTrackingId);
      if (email) {
        automailerStorage.updateEmailStatus(email.id, 'clicked', { lastClickedUrl: redirectUrl });
        log.info('tracking', 'Click tracked: ' + email.to + ' -> ' + redirectUrl.substring(0, 80));
        // Niche performance tracking
        try {
          const apStorage = require('../skills/autonomous-pilot/storage.js');
          const leadNiche = (function() {
            if (email.industry) return email.industry;
            if (email.niche) return email.niche;
            // Fallback: chercher la niche dans le CRM ou les emails stockes
            const automailerSt = require('../skills/automailer/storage.js');
            const allEmails = automailerSt.getEmails ? automailerSt.getEmails() : [];
            const matchedEmail = allEmails.find(em => (em.to || '').toLowerCase() === (email.to || '').toLowerCase());
            return matchedEmail ? (matchedEmail.niche || matchedEmail.industry || null) : null;
          })();
          if (leadNiche) {
            apStorage.trackNicheEvent(leadNiche, 'clicked');
            log.info('tracking', 'Niche tracking: clicked [' + leadNiche + '] pour ' + email.to);
          }
        } catch (ntErr) {}
        // CRM sync (async, non-bloquant)
        (async () => {
          try {
            const hubspot = _getHubSpotClient();
            if (hubspot) {
              const contact = await hubspot.findContactByEmail(email.to);
              if (contact && contact.id) {
                const noteBody = 'Email "' + (email.subject || '') + '" — Clic (click tracking)\nURL: ' + redirectUrl.substring(0, 200) + '\nDate : ' + new Date().toLocaleDateString('fr-FR');
                const note = await hubspot.createNote(noteBody);
                if (note && note.id) await hubspot.associateNoteToContact(note.id, contact.id);
                const adv = await hubspot.advanceDealStage(contact.id, 'presentationscheduled', 'email_clicked');
                if (adv > 0) log.info('tracking', 'Deal avance a presentationscheduled pour ' + email.to + ' (clic email)');
              }
            }
          } catch (crmErr) { log.warn('tracking', 'CRM sync clic: ' + crmErr.message); }
        })();
      }
    } catch (e) {
      log.warn('tracking', 'Click tracking error: ' + e.message);
    }
    return;
  }

  // Tracking pixel ouverture email — GET /t/:trackingId.gif
  if (req.method === 'GET' && req.url && req.url.startsWith('/t/')) {
    // 1x1 transparent GIF (43 bytes)
    const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    // Extraire le trackingId (format: /t/abc123def456.gif)
    const match = req.url.match(/^\/t\/([a-f0-9]{32})\.gif/);
    if (!match) {
      res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
      res.end(PIXEL);
      return;
    }
    const trackingId = match[1];
    // Toujours servir le pixel immediatement (ne pas bloquer le rendu email)
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': PIXEL.length, 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    res.end(PIXEL);
    // Traitement asynchrone de l'ouverture
    try {
      const email = automailerStorage.findEmailByTrackingId(trackingId);
      if (!email) { return; }
      const wasAlreadyOpened = !!email.openedAt;
      if (!wasAlreadyOpened) {
        automailerStorage.updateEmailStatus(email.id, 'opened');
        log.info('tracking', 'Email ouvert (pixel) : ' + email.to + ' — ' + (email.subject || '').substring(0, 40));
        // 1ère ouverture (pixel) : research + cache intel, PAS de reactive FU
        if (ProspectResearcher) {
          try {
            const researcher = new ProspectResearcher({ claudeKey: CLAUDE_KEY });
            let prospectTitle = '';
            try {
              if (flowFastStorageRouter && flowFastStorageRouter.data) {
                const ffLeads = flowFastStorageRouter.data.leads || {};
                for (const lid of Object.keys(ffLeads)) {
                  if (ffLeads[lid].email === email.to) {
                    prospectTitle = ffLeads[lid].title || ffLeads[lid].titre || '';
                    break;
                  }
                }
              }
              if (!prospectTitle && leadEnrichStorageRouter) {
                const leData = leadEnrichStorageRouter.data || {};
                const enriched = leData.enrichedContacts || [];
                const found = enriched.find(c => c.email === email.to);
                if (found) prospectTitle = found.title || found.titre || '';
              }
            } catch (titleErr) {}
            const contact = _enrichContactWithOrg(email.to, email.contactName || '', email.company || '', prospectTitle);
            Promise.race([
              researcher.researchProspect(contact),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 30s')), 30000))
            ]).then(intel => {
              // Notification silencieuse — le hot lead alert notifiera si 3+ ouvertures
              log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — intel cache, notification silencieuse');
              // Cache l'intel pour usage ultérieur (reactive FU, hot lead alert)
              if (intel && intel.brief) {
                try {
                  proactiveAgentStorage.data._cachedIntel = proactiveAgentStorage.data._cachedIntel || {};
                  proactiveAgentStorage.data._cachedIntel[email.to] = { brief: intel.brief.substring(0, 3500), cachedAt: new Date().toISOString() };
                  var cKeys = Object.keys(proactiveAgentStorage.data._cachedIntel);
                  if (cKeys.length > 100) { for (var ck = 0; ck < cKeys.length - 100; ck++) delete proactiveAgentStorage.data._cachedIntel[cKeys[ck]]; }
                  proactiveAgentStorage._save();
                } catch (cacheErr2) {}
              }
            }).catch(() => {
              log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — research timeout, pas de cache');
            });
          } catch (e) {
            log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — researcher non dispo');
          }
        } else {
          log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — ProspectResearcher non charge');
        }
      } else {
        // 2ème+ ouverture pixel → signal d'intérêt fort → programmer reactive FU
        log.info('tracking', 'Rouverture pixel detectee pour ' + email.to + ' — programmation reactive FU');
        var pixelCachedIntel = '';
        try {
          var pCache = (proactiveAgentStorage.data._cachedIntel || {})[email.to];
          if (pCache && pCache.brief) pixelCachedIntel = pCache.brief;
        } catch (pce) {}
        try {
          var rfConfig3 = proactiveAgentStorage.getReactiveFollowUpConfig();
          if (rfConfig3.enabled) {
            // Guard 1 : blacklist automailer (human takeover, bounce, decline)
            if (automailerStorage.isBlacklisted(email.to)) {
              log.info('tracking', 'Skip reactive FU (reouvre pixel) pour ' + email.to + ' — blackliste');
            }
            // Guard 2 : ne PAS programmer de FU si le prospect a deja repondu (human takeover)
            else if ((function() {
              var pixelEvents = automailerStorage.getEmailEventsForRecipient(email.to);
              return pixelEvents.some(function(e) { return e.status === 'replied' || e.hasReplied; });
            })()) {
              log.info('tracking', 'Skip reactive FU (reouvre pixel) pour ' + email.to + ' — deja repondu (human takeover)');
            } else {
              var delayMs3 = (rfConfig3.minDelayMinutes + Math.random() * (rfConfig3.maxDelayMinutes - rfConfig3.minDelayMinutes)) * 60 * 1000;
              var scheduledAfter3 = new Date(Date.now() + delayMs3).toISOString();
              var addedFU3 = proactiveAgentStorage.addPendingFollowUp({
                prospectEmail: email.to,
                prospectName: email.contactName || '',
                prospectCompany: email.company || '',
                originalEmailId: email.id,
                originalSubject: email.subject || '',
                originalBody: (email.body || '').substring(0, 500),
                prospectIntel: pixelCachedIntel,
                scheduledAfter: scheduledAfter3
              });
              if (addedFU3) {
                log.info('tracking', 'Reactive FU programme (reouvre pixel) pour ' + email.to + ' — id: ' + addedFU3.id + ' — notification a l\'envoi');
              } else {
                log.info('tracking', 'Reactive FU deja programme pour ' + email.to + ' (dedup)');
              }
            }
          }
        } catch (rfErr3) {}
      }
      // Tracker l'ouverture dans Proactive Agent (hot lead detection — toujours, 1ère ou pas)
      try {
        const tracked = proactiveAgentStorage.trackEmailOpen(email.to, email.trackingId || trackingId);
        const paConfig = proactiveAgentStorage.getConfig();
        if (tracked.opens >= (paConfig.thresholds || {}).hotLeadOpens && !proactiveAgentStorage.isHotLeadNotified(email.to)) {
          // Notification via smart alerts proactive (plus riche, avec infos lead) — pas de doublon ici
          log.info('tracking', 'Hot lead detecte via pixel: ' + email.to + ' (' + tracked.opens + ' opens) — notification via smart alerts');
          proactiveAgentStorage.markHotLeadNotified(email.to);
          }
        } catch (paErr) { log.warn('tracking', 'Proactive tracking: ' + paErr.message); }
        // Sync CRM + avancement deal automatique (async, non-bloquant)
        (async () => {
          try {
            const hubspot = _getHubSpotClient();
            if (hubspot) {
              const contact = await hubspot.findContactByEmail(email.to);
              if (contact && contact.id) {
                const noteBody = 'Email "' + (email.subject || '') + '" — Ouvert (pixel tracking)\nDate : ' + new Date().toLocaleDateString('fr-FR');
                const note = await hubspot.createNote(noteBody);
                if (note && note.id) await hubspot.associateNoteToContact(note.id, contact.id);
                // Avancer le deal a "qualifiedtobuy" sur ouverture email
                const advanced = await hubspot.advanceDealStage(contact.id, 'qualifiedtobuy', 'email_opened');
                if (advanced > 0) log.info('tracking', 'Deal avance a qualifiedtobuy pour ' + email.to + ' (email ouvert)');
              }
            }
          } catch (crmErr) { log.warn('tracking', 'CRM sync: ' + crmErr.message); }
        })();
    } catch (trackErr) {
      log.warn('tracking', 'Erreur tracking pixel: ' + trackErr.message);
    }
    return;
  }

  // === UNSUBSCRIBE ENDPOINT ===
  if (req.url && req.url.startsWith('/unsubscribe')) {
    const urlObj = new URL(req.url, 'http://localhost');
    const email = decodeURIComponent(urlObj.searchParams.get('email') || '').trim().toLowerCase();

    if (req.method === 'GET') {
      // Page de confirmation de desabonnement
      const pageHtml = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Se desabonner</title>' +
        '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}' +
        '.card{background:#fff;border-radius:12px;padding:40px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.08)}' +
        'h1{font-size:20px;color:#222;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.5}' +
        'button{background:#dc3545;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;cursor:pointer;margin-top:16px}' +
        'button:hover{background:#c82333}.ok{color:#28a745;font-size:48px;margin-bottom:8px}</style></head>' +
        '<body><div class="card">' +
        (email ? '<h1>Se desabonner ?</h1><p>Vous ne recevrez plus d\'emails de notre part a l\'adresse :</p><p><strong>' + email.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</strong></p>' +
          '<form method="POST" action="/unsubscribe"><input type="hidden" name="email" value="' + email.replace(/"/g, '&quot;') + '">' +
          '<button type="submit">Confirmer le desabonnement</button></form>' :
          '<h1>Lien invalide</h1><p>Aucune adresse email fournie.</p>') +
        '</div></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml);
      return;
    }

    if (req.method === 'POST') {
      let postBody = '';
      req.on('data', chunk => { postBody += chunk; if (postBody.length > 10240) req.destroy(); });
      req.on('end', () => {
        // Extraire email depuis form data ou one-click RFC 8058
        let unsubEmail = email;
        if (!unsubEmail) {
          const match = postBody.match(/email=([^&\s]+)/);
          if (match) unsubEmail = decodeURIComponent(match[1]).trim().toLowerCase();
        }

        const confirmHtml = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Desabonne</title>' +
          '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}' +
          '.card{background:#fff;border-radius:12px;padding:40px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.08)}' +
          'h1{font-size:20px;color:#222;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.5}.ok{color:#28a745;font-size:48px;margin-bottom:8px}</style></head>';

        if (unsubEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(unsubEmail)) {
          try {
            const automailerStorage = require('../skills/automailer/storage.js');
            automailerStorage.addToBlacklist(unsubEmail, 'unsubscribe_link');
            // Stopper les follow-ups campagne en marquant hasReplied
            try {
              const allEmails = automailerStorage.getAllEmails();
              for (const em of allEmails) {
                if ((em.to || '').toLowerCase() === unsubEmail.toLowerCase() && !em.hasReplied) {
                  automailerStorage.updateEmailStatus(em.id, em.status, { hasReplied: true, replyType: 'unsubscribed' });
                }
              }
            } catch (ufErr) { /* non-bloquant */ }
            log.info('unsubscribe', 'Desabonnement confirme (blacklist + follow-ups annules): ' + unsubEmail);
            sendMessage(ADMIN_CHAT_ID, '🚫 *Desabonnement* via lien email : `' + unsubEmail + '`', 'Markdown').catch(() => {});
          } catch (e) {
            log.error('unsubscribe', 'Erreur blacklist: ' + e.message);
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(confirmHtml + '<body><div class="card"><div class="ok">&#10003;</div><h1>Desabonnement confirme</h1>' +
            '<p>Vous ne recevrez plus d\'emails de notre part.</p></div></body></html>');
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(confirmHtml + '<body><div class="card"><h1>Erreur</h1><p>Adresse email invalide.</p></div></body></html>');
        }
      });
      return;
    }
  }

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
  if (inboxListener) try { inboxListener.stop(); } catch (e) { log.error('router', 'Erreur stop inbox-listener:', e.message); }
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
  try { _saveHitlDrafts(); } catch (e) {}
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
    if (inboxListener) {
      try {
        inboxListener.stop();
        setTimeout(() => {
          if (inboxListener && inboxListener.isConfigured()) {
            inboxListener.start().catch(e => log.warn('router', 'IMAP restart echoue:', e.message));
          }
        }, 10000);
      } catch (e) {}
    }
    return; // NE PAS crasher
  }

  // Autres unhandled rejections — log + crash comme avant
  log.error('router', 'UNHANDLED REJECTION:', msg);
  log.error('router', stack ? stack.substring(0, 500) : 'no stack');
  // Sauvegarder les drafts HITL avant exit
  try { _saveHitlDrafts(); } catch (e) {}
  gracefulShutdown();
});
