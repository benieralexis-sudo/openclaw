// MoltBot - Routeur Telegram central (dispatch FlowFast + AutoMailer + CRM Pilot + Lead Enrich + Content Gen + Invoice Bot + Proactive Agent + Self-Improve + Web Intelligence + System Advisor)
const https = require('https');
const FlowFastTelegramHandler = require('../skills/flowfast/telegram-handler.js');
const AutoMailerHandler = require('../skills/automailer/automailer-handler.js');
const CRMPilotHandler = require('../skills/crm-pilot/crm-handler.js');
const LeadEnrichHandler = require('../skills/lead-enrich/enrich-handler.js');
const ContentHandler = require('../skills/content-gen/content-handler.js');
const InvoiceBotHandler = require('../skills/invoice-bot/invoice-handler.js');
const ProactiveEngine = require('../skills/proactive-agent/proactive-engine.js');
const ProactiveHandler = require('../skills/proactive-agent/proactive-handler.js');
const SelfImproveHandler = require('../skills/self-improve/self-improve-handler.js');
const WebIntelligenceHandler = require('../skills/web-intelligence/web-intelligence-handler.js');
const SystemAdvisorHandler = require('../skills/system-advisor/system-advisor-handler.js');
const flowfastStorage = require('../skills/flowfast/storage.js');
const moltbotConfig = require('./moltbot-config.js');

// --- Metriques globales (partage memoire pour System Advisor) ---
global.__moltbotMetrics = {
  skillUsage: {},
  responseTimes: {},
  errors: {},
  startedAt: new Date().toISOString()
};

function recordSkillUsage(skill) {
  const m = global.__moltbotMetrics.skillUsage;
  if (!m[skill]) m[skill] = { count: 0, lastUsedAt: null };
  m[skill].count++;
  m[skill].lastUsedAt = new Date().toISOString();
}

function recordResponseTime(skill, ms) {
  const m = global.__moltbotMetrics.responseTimes;
  if (!m[skill]) m[skill] = { times: [] };
  m[skill].times.push(ms);
  if (m[skill].times.length > 100) m[skill].times = m[skill].times.slice(-100);
}

function recordSkillError(skill, errMsg) {
  const m = global.__moltbotMetrics.errors;
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
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'onboarding@resend.dev';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN manquant !');
  process.exit(1);
}

// --- Handlers ---

const flowfastHandler = new FlowFastTelegramHandler(APOLLO_KEY, HUBSPOT_KEY, OPENAI_KEY, CLAUDE_KEY, SENDGRID_KEY, SENDER_EMAIL);
const automailerHandler = new AutoMailerHandler(OPENAI_KEY, CLAUDE_KEY, RESEND_KEY, SENDER_EMAIL);
const crmPilotHandler = new CRMPilotHandler(OPENAI_KEY, HUBSPOT_KEY);
// Apollo desactive temporairement (free plan ne permet plus l'acces API)
// Remettre APOLLO_KEY quand le plan sera upgrade
const leadEnrichHandler = new LeadEnrichHandler(OPENAI_KEY, '', HUBSPOT_KEY);
const contentHandler = new ContentHandler(OPENAI_KEY, CLAUDE_KEY);
const invoiceBotHandler = new InvoiceBotHandler(OPENAI_KEY, RESEND_KEY, SENDER_EMAIL);

// Demarrer les schedulers
automailerHandler.start();
crmPilotHandler.start();
leadEnrichHandler.start();
contentHandler.start();
invoiceBotHandler.start();

// Self-Improve (instancie apres les autres pour le sendTelegram callback)
let selfImproveHandler = null;

let offset = 0;

// --- API Telegram ---

function telegramAPI(method, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TOKEN + '/' + method,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Reponse Telegram invalide')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

async function sendMessage(chatId, text, parseMode) {
  const maxLen = 4096;
  if (text.length <= maxLen) {
    const result = await telegramAPI('sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode || undefined
    });
    if (!result.ok && parseMode) {
      return telegramAPI('sendMessage', { chat_id: chatId, text: text });
    }
    return result;
  }
  for (let i = 0; i < text.length; i += maxLen) {
    const chunk = text.slice(i, i + maxLen);
    await telegramAPI('sendMessage', {
      chat_id: chatId,
      text: chunk,
      parse_mode: parseMode || undefined
    }).catch(() => telegramAPI('sendMessage', { chat_id: chatId, text: chunk }));
  }
}

async function sendTyping(chatId) {
  await telegramAPI('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// --- Memoire conversationnelle ---
// Stocke les 15 derniers echanges par utilisateur pour le contexte
const conversationHistory = {};

function addToHistory(chatId, role, text, skill) {
  const id = String(chatId);
  if (!conversationHistory[id]) conversationHistory[id] = [];
  conversationHistory[id].push({
    role: role,
    text: text.substring(0, 200),
    skill: skill || null,
    ts: Date.now()
  });
  // Garder les 15 derniers
  if (conversationHistory[id].length > 15) {
    conversationHistory[id] = conversationHistory[id].slice(-15);
  }
}

function getHistoryContext(chatId) {
  const id = String(chatId);
  const history = conversationHistory[id] || [];
  if (history.length === 0) return '';

  return history.map(h => {
    const prefix = h.role === 'user' ? 'Utilisateur' : 'Bot';
    const skillTag = h.skill ? ' [' + h.skill + ']' : '';
    return prefix + skillTag + ': ' + h.text;
  }).join('\n');
}

// --- Modeles IA multi-niveaux ---
// GPT-4o-mini  : NLP rapide (classification, routage)
// Sonnet 4.5   : Redaction, conversation, humanisation
// Opus 4.6     : Rapports strategiques (hebdo/mensuel)

function callOpenAINLP(systemPrompt, userMessage, maxTokens) {
  maxTokens = maxTokens || 30;
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
      max_tokens: maxTokens
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.choices && response.choices[0]) {
            // Budget tracking
            if (response.usage) {
              const t = (response.usage.prompt_tokens || 0) + (response.usage.completion_tokens || 0);
              moltbotConfig.recordApiSpend('gpt-4o-mini', t);
            }
            resolve(response.choices[0].message.content.trim());
          } else {
            reject(new Error('Reponse OpenAI invalide: ' + JSON.stringify(response).substring(0, 200)));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout OpenAI NLP')); });
    req.write(postData);
    req.end();
  });
}

function callClaude(systemPrompt, userMessage, maxTokens, model) {
  maxTokens = maxTokens || 800;
  model = model || 'claude-sonnet-4-5-20250929';
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.content && response.content[0]) {
            // Budget tracking
            if (response.usage) {
              const t = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
              moltbotConfig.recordApiSpend(model, t);
            }
            resolve(response.content[0].text.trim());
          } else {
            reject(new Error('Reponse Claude invalide: ' + JSON.stringify(response).substring(0, 200)));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Claude')); });
    req.write(postData);
    req.end();
  });
}

// --- Proactive Agent ---

function callClaudeOpus(systemPrompt, userMessage, maxTokens) {
  return callClaude(systemPrompt, userMessage, maxTokens, 'claude-opus-4-6');
}

const proactiveEngine = new ProactiveEngine({
  sendTelegram: async (chatId, message) => {
    await sendMessage(chatId, message, 'Markdown');
    addToHistory(chatId, 'bot', message.substring(0, 200), 'proactive-agent');
  },
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

// Web Intelligence handler (avec callback Telegram + historique)
const webIntelHandler = new WebIntelligenceHandler(OPENAI_KEY, CLAUDE_KEY, async (chatId, message) => {
  await sendMessage(chatId, message, 'Markdown');
  addToHistory(chatId, 'bot', message.substring(0, 200), 'web-intelligence');
});

// System Advisor handler (avec callback Telegram + historique)
const systemAdvisorHandler = new SystemAdvisorHandler(OPENAI_KEY, CLAUDE_KEY, async (chatId, message) => {
  await sendMessage(chatId, message, 'Markdown');
  addToHistory(chatId, 'bot', message.substring(0, 200), 'system-advisor');
});

// --- Controle centralise des crons (14 crons au total) ---

// Storages des skills a crons (pour toggle config.enabled)
const proactiveAgentStorage = require('../skills/proactive-agent/storage.js');
const selfImproveStorage = require('../skills/self-improve/storage.js');
const webIntelStorage = require('../skills/web-intelligence/storage.js');
const systemAdvisorStorage = require('../skills/system-advisor/storage.js');

function startAllCrons() {
  // Activer les configs internes (chaque start() verifie config.enabled)
  try { proactiveAgentStorage.updateConfig({ enabled: true }); } catch (e) {}
  try { selfImproveStorage.updateConfig({ enabled: true }); } catch (e) {}
  try { webIntelStorage.updateConfig({ enabled: true }); } catch (e) {}
  try { systemAdvisorStorage.updateConfig({ enabled: true }); } catch (e) {}

  proactiveEngine.start();
  if (selfImproveHandler) selfImproveHandler.start();
  webIntelHandler.start();
  systemAdvisorHandler.start();
  console.log('[router] 14 crons demarres (production)');
}

function stopAllCrons() {
  proactiveEngine.stop();
  if (selfImproveHandler) selfImproveHandler.stop();
  webIntelHandler.stop();
  systemAdvisorHandler.stop();

  // Desactiver les configs internes (double securite)
  try { proactiveAgentStorage.updateConfig({ enabled: false }); } catch (e) {}
  try { selfImproveStorage.updateConfig({ enabled: false }); } catch (e) {}
  try { webIntelStorage.updateConfig({ enabled: false }); } catch (e) {}
  try { systemAdvisorStorage.updateConfig({ enabled: false }); } catch (e) {}
  console.log('[router] Tous les crons stoppes (standby)');
}

// Demarrage conditionnel selon le mode persiste
if (moltbotConfig.isProduction()) {
  startAllCrons();
} else {
  console.log('[router] Mode STANDBY — crons desactives, zero token auto');
}

// Budget : notification + arret crons si depasse
moltbotConfig.onBudgetExceeded(async (budget) => {
  const msg = '⚠️ *Budget API journalier depasse*\n\n' +
    'Limite : $' + budget.dailyLimit.toFixed(2) + '\n' +
    'Depense : $' + budget.todaySpent.toFixed(4) + '\n\n' +
    'Actions automatiques suspendues. Les commandes manuelles restent actives.';
  await sendMessage('1409505520', msg, 'Markdown');
  stopAllCrons();
  moltbotConfig.deactivateAll();
});

// --- Statut systeme ---

function buildSystemStatus() {
  const config = moltbotConfig.getConfig();
  const mode = config.mode;
  const modeEmoji = mode === 'production' ? '🟢' : '🔴';
  const modeLabel = mode === 'production' ? 'PRODUCTION' : 'STAND-BY';

  const apiKeys = [
    { name: 'Telegram', key: TOKEN },
    { name: 'OpenAI (NLP)', key: OPENAI_KEY },
    { name: 'Claude (Anthropic)', key: CLAUDE_KEY },
    { name: 'HubSpot (CRM)', key: HUBSPOT_KEY },
    { name: 'Apollo (Enrichissement)', key: APOLLO_KEY },
    { name: 'Resend (Emails)', key: RESEND_KEY }
  ];

  const emailSafe = SENDER_EMAIL && SENDER_EMAIL !== 'onboarding@resend.dev' && SENDER_EMAIL.trim() !== '';
  const apolloOk = APOLLO_KEY && APOLLO_KEY.trim() !== '';

  const cronCounts = {
    'Proactive Agent': proactiveEngine.crons ? proactiveEngine.crons.length : 0,
    'Web Intelligence': webIntelHandler.crons ? webIntelHandler.crons.length : 0,
    'System Advisor': systemAdvisorHandler.crons ? systemAdvisorHandler.crons.length : 0,
    'Self-Improve': selfImproveHandler && selfImproveHandler.crons ? selfImproveHandler.crons.length : 0
  };

  const totalCrons = Object.values(cronCounts).reduce((a, b) => a + b, 0);

  const lines = [
    modeEmoji + ' *MOLTBOT — ' + modeLabel + '*',
    '_Derniere bascule : ' + new Date(config.lastModeChange).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + '_',
    ''
  ];

  // Crons
  lines.push('*Crons (' + totalCrons + '/14 actifs) :*');
  for (const [name, count] of Object.entries(cronCounts)) {
    const emoji = count > 0 ? '🟢' : '⏸️';
    lines.push('  ' + emoji + ' ' + name + ' : ' + count + ' cron(s)');
  }

  // Skills sans crons
  lines.push('');
  lines.push('*Skills manuelles :*');
  const manualSkills = ['FlowFast', 'AutoMailer', 'CRM Pilot', 'Lead Enrich', 'Content Gen', 'Invoice Bot'];
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
  lines.push('  Email : ' + (emailSafe ? '✅ ' + SENDER_EMAIL : '⚠️ Non configure (test only)'));
  lines.push('  Apollo : ' + (apolloOk ? '✅ Active' : '⚠️ Cle absente ou invalide'));

  // Budget
  const budget = moltbotConfig.getBudgetStatus();
  const budgetPct = budget.dailyLimit > 0 ? Math.round((budget.todaySpent / budget.dailyLimit) * 100) : 0;
  lines.push('');
  lines.push('*Budget API ($' + budget.dailyLimit.toFixed(2) + '/jour) :*');
  lines.push('  Aujourd\'hui : $' + budget.todaySpent.toFixed(4) + ' (' + budgetPct + '%)');
  if (moltbotConfig.isBudgetExceeded()) {
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

async function classifySkill(message, chatId) {
  const id = String(chatId);
  const text = message.toLowerCase().trim();

  // Commande /start uniquement
  if (text === '/start') return 'general';

  // Workflows multi-etapes en cours : garder le skill actif (indispensable)
  if (automailerHandler.pendingImports[id] || automailerHandler.pendingConversations[id] || automailerHandler.pendingEmails[id]) return 'automailer';
  if (crmPilotHandler.pendingConversations[id] || crmPilotHandler.pendingConfirmations[id]) return 'crm-pilot';
  if (leadEnrichHandler.pendingConversations[id] || leadEnrichHandler.pendingConfirmations[id]) return 'lead-enrich';
  if (contentHandler.pendingConversations[id]) return 'content-gen';
  if (invoiceBotHandler.pendingConversations[id] || invoiceBotHandler.pendingConfirmations[id]) return 'invoice-bot';
  if (flowfastHandler.pendingResults[id] || flowfastHandler.pendingEmails[id]) return 'flowfast';
  if (proactiveHandler.pendingConversations[id] || proactiveHandler.pendingConfirmations[id]) return 'proactive-agent';
  if (selfImproveHandler && (selfImproveHandler.pendingConversations[id] || selfImproveHandler.pendingConfirmations[id])) return 'self-improve';
  if (webIntelHandler.pendingConversations[id] || webIntelHandler.pendingConfirmations[id]) return 'web-intelligence';
  if (systemAdvisorHandler.pendingConversations[id] || systemAdvisorHandler.pendingConfirmations[id]) return 'system-advisor';

  // Classification NLP avec contexte conversationnel
  const historyContext = getHistoryContext(chatId);
  const lastSkill = userActiveSkill[id] || 'aucun';

  const systemPrompt = `Tu es le cerveau d'un bot Telegram appele MoltBot. Tu dois comprendre l'INTENTION de l'utilisateur pour router son message vers le bon skill.

SKILLS DISPONIBLES :
- "flowfast" : lancer une NOUVELLE recherche de prospects B2B — "cherche des CEO a Paris", "trouve-moi des directeurs commerciaux a Lyon". Uniquement pour CHERCHER de nouveaux leads, pas pour voir les resultats existants.
- "automailer" : campagnes email automatisees — creer/gerer des campagnes, envoyer des emails, gerer des listes de contacts email, voir les stats d'envoi, templates email. "comment vont mes campagnes ?" = automailer.
- "crm-pilot" : gestion CRM (HubSpot) — pipeline commercial, offres/deals, fiches contacts, notes, taches, rappels, rapports hebdo, suivi commercial.
- "lead-enrich" : enrichissement et resultats de leads — enrichir un profil, scorer des leads, voir les meilleurs leads, les leads trouves, les resultats interessants. "t'as trouve des trucs interessants ?" = lead-enrich. "mes leads" = lead-enrich.
- "content-gen" : generation de contenu — rediger des posts LinkedIn, pitchs, descriptions, scripts, emails marketing, bios, reformuler du texte.
- "invoice-bot" : facturation — creer/envoyer des factures, gerer des clients (facturation), suivi des paiements, coordonnees bancaires/RIB, devis.
- "proactive-agent" : mode proactif, rapports automatiques, alertes pipeline, monitoring — "rapport maintenant", "rapport de la semaine", "rapport du mois", "mes alertes", "mode proactif status", "active le mode proactif", "historique des alertes". Tout ce qui concerne des rapports recapitulatifs cross-skills ou le monitoring automatique.
- "self-improve" : amelioration automatique du bot, optimisation des performances, recommandations IA, feedback loop — "tes recommandations", "analyse maintenant", "applique les ameliorations", "metriques", "historique des ameliorations", "rollback", "status self-improve", "comment ca performe ?". Tout ce qui concerne l'optimisation du bot, l'amelioration continue, et les suggestions d'amelioration.
- "web-intelligence" : veille web, surveillance de prospects/concurrents/secteur, news, articles, tendances, RSS, Google News — "surveille un concurrent", "mes veilles", "quoi de neuf ?", "articles", "tendances", "stats veille", "ajoute un flux RSS", "scan maintenant", "des nouvelles ?". Tout ce qui concerne la surveillance web, les actualites, la veille concurrentielle ou sectorielle.
- "system-advisor" : monitoring technique du bot, sante du systeme, RAM, CPU, disque, uptime, erreurs, health check, alertes systeme, performances, temps de reponse des skills — "status systeme", "comment va le bot ?", "utilisation memoire", "espace disque", "erreurs recentes", "check sante", "rapport systeme", "uptime", "alertes systeme", "temps de reponse", "performances". ATTENTION : distinct de proactive-agent qui gere les rapports BUSINESS (pipeline, campagnes). System-advisor gere le monitoring TECHNIQUE (serveur, memoire, CPU).
- "general" : salutations, aide globale, bavardage sans rapport avec les skills ci-dessus.

REGLES CRITIQUES :
1. Comprends le SENS, pas les mots exacts. "comment vont mes envois ?" = automailer. "t'as trouve des trucs ?" = flowfast. "ou en est mon business ?" = crm-pilot.
2. Le CONTEXTE compte. Si la conversation recente parle de prospection et que l'utilisateur dit "et a Lyon ?", c'est flowfast (prospection a Lyon).
3. TRES IMPORTANT : Si le bot vient d'envoyer des messages automatiques (alertes veille, rapports, alertes systeme, etc.) et que l'utilisateur REAGIT a ces messages (demande un resume, commente, critique le format, dit "trop de messages", "fais un resume", "regroupe", etc.), route vers le skill qui a envoye ces messages. Par exemple : le bot envoie des alertes veille -> l'utilisateur dit "fais-moi un resume" -> c'est web-intelligence. Le bot envoie un rapport proactif -> l'utilisateur dit "c'est quoi ce truc ?" -> c'est proactive-agent.
4. "aide" ou "help" SEUL = general. Mais "aide sur mes factures" = invoice-bot.
5. En cas de doute entre deux skills, choisis celui qui correspond le mieux au contexte recent.
6. Reponds UNIQUEMENT par un seul mot : flowfast, automailer, crm-pilot, lead-enrich, content-gen, invoice-bot, proactive-agent, self-improve, web-intelligence, system-advisor ou general.`;

  const userContent = (historyContext
    ? 'HISTORIQUE RECENT :\n' + historyContext + '\n\nDernier skill utilise : ' + lastSkill + '\n\nNOUVEAU MESSAGE : '
    : 'Pas d\'historique.\n\nNOUVEAU MESSAGE : ')
    + message;

  try {
    const raw = await callOpenAINLP(systemPrompt, userContent, 15);
    const skill = raw.toLowerCase();

    // Parser la reponse
    if (skill.includes('system-advisor') || skill.includes('system') || skill.includes('advisor') || skill.includes('monitoring') || skill.includes('sante')) return 'system-advisor';
    if (skill.includes('web-intelligence') || skill.includes('web-intel') || skill.includes('veille') || skill.includes('intelligence')) return 'web-intelligence';
    if (skill.includes('self-improve') || skill.includes('improve') || skill.includes('amelior')) return 'self-improve';
    if (skill.includes('proactive-agent') || skill.includes('proactive') || skill.includes('proactif')) return 'proactive-agent';
    if (skill.includes('invoice-bot') || skill.includes('invoice')) return 'invoice-bot';
    if (skill.includes('content-gen') || skill.includes('content')) return 'content-gen';
    if (skill.includes('lead-enrich') || skill.includes('enrich')) return 'lead-enrich';
    if (skill.includes('crm-pilot') || skill.includes('crm')) return 'crm-pilot';
    if (skill.includes('automailer') || skill.includes('mailer')) return 'automailer';
    if (skill.includes('flowfast') || skill.includes('flow')) return 'flowfast';
    return 'general';
  } catch (e) {
    console.log('[router] Erreur classification Claude:', e.message);
    return 'general';
  }
}

// --- Humanisation des reponses ---

async function humanizeResponse(rawContent, userMessage, skill) {
  // Ne pas humaniser les reponses courtes (confirmations, erreurs simples)
  if (!rawContent || rawContent.length < 80) return rawContent;

  // Ne pas humaniser les messages de chargement intermediaires
  if (rawContent.startsWith('🔍 _') || rawContent.startsWith('✍️ _') || rawContent.startsWith('📧 _') || rawContent.startsWith('🚀 _')) return rawContent;

  const systemPrompt = `Tu es MoltBot, un assistant Telegram sympa et decontracte qui parle comme un pote professionnel.
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
    console.log('[router] Erreur humanisation:', e.message);
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
      '\nMais tu peux aussi me poser n\'importe quelle question business — strategie, conseils, idees. Parle-moi naturellement !'
    ].join('\n');
  }

  // Appel Claude pour une vraie reponse conversationnelle
  const systemPrompt = `Tu es MoltBot, l'assistant business IA personnel d'Alexis (il t'appelle Jojo). Tu es un expert en strategie commerciale B2B, marketing digital, vente et entrepreneuriat.

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
- Enrichissement de leads (Apollo, scoring IA)
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
    ? 'CONTEXTE DES DERNIERS ECHANGES :\n' + historyContext + '\n\nNOUVEAU MESSAGE D\'ALEXIS : ' + userMessage
    : userMessage;

  try {
    const result = await callClaude(systemPrompt, userContent, 800);
    return result || 'Hmm, j\'ai eu un souci. Reformule ta question ?';
  } catch (e) {
    console.log('[router] Erreur reponse business:', e.message);
    return 'Oups, petit bug de mon cote. Reessaie !';
  }
}

// --- Traitement des messages ---

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const userName = msg.from.first_name || 'Utilisateur';

  // Enregistrer l'utilisateur dans les deux storages
  flowfastStorage.setUserName(chatId, userName);

  console.log('[' + new Date().toISOString() + '] ' + userName + ' (' + chatId + '): ' + text);
  await sendTyping(chatId);

  // Sauvegarder le message dans l'historique
  addToHistory(chatId, 'user', text, null);

  const sendReply = async (reply) => {
    await sendMessage(chatId, reply.content, 'Markdown');
  };

  // ========== COMMANDES DE CONTROLE (avant NLP, zero token) ==========
  const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const activateAliases = ['active tout', 'lance la machine', 'mode production', 'demarre tout'];
  const deactivateAliases = ['desactive tout', 'mode stand by', 'mode standby', 'stoppe tout', 'arrete tout'];
  const statusAliases = ['statut systeme', 'statut système', 'status systeme', 'status système', 'status moltbot', 'etat du systeme'];

  if (activateAliases.some(a => textLower === a)) {
    moltbotConfig.activateAll();
    startAllCrons();
    const reply = [
      '🟢 *Mode PRODUCTION active !*',
      '',
      'Tous les crons sont lances :',
      '  - Proactive Agent : 6 crons',
      '  - Web Intelligence : 3 crons',
      '  - System Advisor : 4 crons',
      '  - Self-Improve : 1 cron',
      '',
      'Le bot travaille maintenant en autonomie.',
      '_Dis "statut systeme" pour voir le detail._'
    ].join('\n');
    addToHistory(chatId, 'bot', 'Mode production active', 'system');
    await sendMessage(chatId, reply, 'Markdown');
    return;
  }

  if (deactivateAliases.some(a => textLower === a)) {
    moltbotConfig.deactivateAll();
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
    const statusMsg = buildSystemStatus();
    addToHistory(chatId, 'bot', 'Statut systeme', 'system');
    await sendMessage(chatId, statusMsg, 'Markdown');
    return;
  }
  // ========== FIN COMMANDES DE CONTROLE ==========

  try {
    // Determiner le skill via NLP contextuel
    const skill = await classifySkill(text, chatId);
    console.log('[router] Skill: ' + skill + ' pour: "' + text.substring(0, 50) + '"');
    userActiveSkill[String(chatId)] = skill;

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

    // Apollo : bloquer enrichissement si cle absente
    if (skill === 'lead-enrich' || skill === 'flowfast') {
      const enrichAction = textLower.match(/enrichi|profil|score|cherche|trouve|prospect/);
      if (enrichAction && (!APOLLO_KEY || APOLLO_KEY.trim() === '')) {
        const warning = [
          '⚠️ *Enrichissement non disponible*',
          '',
          'La cle API Apollo n\'est pas configuree.',
          'Configure APOLLO_API_KEY dans .env pour activer.',
        ].join('\n');
        addToHistory(chatId, 'bot', 'Apollo bloque - cle manquante', skill);
        await sendMessage(chatId, warning, 'Markdown');
        return;
      }
    }

    // ===== FIN GARDES =====

    let response = null;

    const handlers = {
      'automailer': automailerHandler,
      'crm-pilot': crmPilotHandler,
      'lead-enrich': leadEnrichHandler,
      'content-gen': contentHandler,
      'invoice-bot': invoiceBotHandler,
      'proactive-agent': proactiveHandler,
      'self-improve': selfImproveHandler,
      'web-intelligence': webIntelHandler,
      'system-advisor': systemAdvisorHandler,
      'flowfast': flowfastHandler
    };

    const handler = handlers[skill];
    if (handler) {
      const startTime = Date.now();
      try {
        response = await handler.handleMessage(text, chatId, sendReply);
        recordSkillUsage(skill);
        recordResponseTime(skill, Date.now() - startTime);
      } catch (handlerError) {
        recordSkillUsage(skill);
        recordSkillError(skill, handlerError.message);
        recordResponseTime(skill, Date.now() - startTime);
        throw handlerError;
      }
    } else {
      // General : reponse IA conversationnelle business
      const generalResponse = await generateBusinessResponse(text, chatId);
      response = { type: 'text', content: generalResponse };
    }

    if (response && response.content) {
      let finalText = response.content;
      // Humaniser seulement les reponses de skills (pas "general" qui est deja conversationnel)
      if (skill !== 'general') {
        finalText = await humanizeResponse(response.content, text, skill);
      }
      // Sauvegarder la reponse dans l'historique
      addToHistory(chatId, 'bot', finalText.substring(0, 200), skill);
      await sendMessage(chatId, finalText, 'Markdown');
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erreur:', error.message);
    await sendMessage(chatId, '❌ Oups, une erreur est survenue. Reessaie !');
  }
}

// --- Callback queries (boutons) ---

async function handleCallback(update) {
  const cb = update.callback_query;
  if (!cb || !cb.data) return;

  const chatId = cb.message.chat.id;
  const data = cb.data;

  await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

  // Router les callbacks par prefixe
  if (data.startsWith('feedback_')) {
    const parts = data.split('_');
    const type = parts[1];
    const email = parts.slice(2).join('_');
    flowfastStorage.setLeadFeedback(email, type);
    flowfastStorage.addFeedback(chatId, type);
    await sendMessage(chatId, type === 'positive' ? '👍 Merci pour le feedback !' : '👎 Note, je ferai mieux la prochaine fois !');
  }
}

// --- Long polling ---

async function poll() {
  while (true) {
    try {
      const result = await telegramAPI('getUpdates', {
        offset: offset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query']
      });

      if (result.ok && result.result && result.result.length > 0) {
        for (const update of result.result) {
          offset = update.update_id + 1;
          if (update.callback_query) {
            handleCallback(update).catch(e => console.error('Erreur callback:', e.message));
          } else {
            handleUpdate(update).catch(e => console.error('Erreur handleUpdate:', e.message));
          }
        }
      }
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Erreur polling:', error.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// --- Demarrage ---

console.log('🤖 MoltBot Router demarre...');
telegramAPI('getMe').then(result => {
  if (result.ok) {
    console.log('🤖 Bot connecte : @' + result.result.username + ' (' + result.result.first_name + ')');
    telegramAPI('setMyCommands', {
      commands: [
        { command: 'start', description: '🤖 Demarrer MoltBot' },
        { command: 'aide', description: '❓ Voir l\'aide' }
      ]
    }).catch(() => {});
    console.log('🤖 Skills actives : Prospection + AutoMailer + CRM Pilot + Lead Enrich + Content Gen + Invoice Bot + Proactive Agent + Self-Improve + Web Intelligence + System Advisor');
    console.log('🤖 En attente de messages...');
    poll();
  } else {
    console.error('Erreur Telegram:', JSON.stringify(result));
    process.exit(1);
  }
}).catch(e => {
  console.error('Erreur fatale:', e.message);
  process.exit(1);
});

// Cleanup
process.on('SIGTERM', () => {
  console.log('🤖 Arret MoltBot Router...');
  automailerHandler.stop();
  crmPilotHandler.stop();
  leadEnrichHandler.stop();
  contentHandler.stop();
  invoiceBotHandler.stop();
  proactiveEngine.stop();
  if (selfImproveHandler) selfImproveHandler.stop();
  webIntelHandler.stop();
  systemAdvisorHandler.stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('🤖 Arret MoltBot Router...');
  automailerHandler.stop();
  crmPilotHandler.stop();
  leadEnrichHandler.stop();
  contentHandler.stop();
  invoiceBotHandler.stop();
  proactiveEngine.stop();
  if (selfImproveHandler) selfImproveHandler.stop();
  webIntelHandler.stop();
  systemAdvisorHandler.stop();
  process.exit(0);
});
