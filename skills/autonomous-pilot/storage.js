// Autonomous Pilot - Stockage JSON persistant
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');
const log = require('../../gateway/logger.js');

const DATA_DIR = process.env.AUTONOMOUS_PILOT_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'autonomous-pilot.json');

// --- ICP (Ideal Customer Profile) defaults — NEVER allow empty searchCriteria ---
const ICP_DEFAULTS = {
  titles: ['CEO', 'Founder', 'Co-founder', 'CTO', 'Fondateur', 'Directeur', 'Gerant', 'Associe', 'Directeur General', 'President', 'DG'],
  locations: ['France'],
  seniorities: ['founder', 'c_suite', 'director', 'owner'],
  companySize: ['1-10', '11-50', '51-200']
};

// --- Liste exhaustive de niches B2B pour le marche francais ---
const B2B_NICHE_LIST = [
  // Tech & Digital
  { slug: 'agences-marketing', keywords: 'agence marketing OR agence digitale', patterns: ['agence marketing', 'agence digitale', 'agence growth', 'agence communication', 'agence web', 'agence seo', 'agence sem'] },
  { slug: 'esn-ssii', keywords: 'ESN OR SSII', patterns: ['esn', 'ssii', 'consulting it', 'conseil informatique', 'societe services informatiques', 'services numeriques'] },
  { slug: 'saas-b2b', keywords: 'SaaS B2B OR editeur logiciel', patterns: ['saas b2b', 'logiciel b2b', 'editeur logiciel', 'startup saas', 'saas'] },
  { slug: 'startup-tech', keywords: 'startup OR tech', patterns: ['startup', 'fintech', 'proptech', 'healthtech', 'edtech', 'legaltech', 'regtech', 'insurtech'] },
  { slug: 'ecommerce', keywords: 'e-commerce OR ecommerce', patterns: ['e-commerce', 'ecommerce', 'commerce en ligne', 'marketplace', 'boutique en ligne'] },
  // Conseil & Services
  { slug: 'cabinet-conseil', keywords: 'cabinet conseil OR consulting', patterns: ['cabinet conseil', 'consulting', 'conseil en strategie', 'conseil management', 'conseil en organisation'] },
  { slug: 'cabinet-comptable', keywords: 'expert comptable OR cabinet comptable', patterns: ['expert comptable', 'cabinet comptable', 'expertise comptable', 'comptabilite'] },
  { slug: 'cabinet-avocat', keywords: 'cabinet avocat OR avocat affaires', patterns: ['cabinet avocat', 'avocat', 'avocat affaires', 'cabinet juridique', 'droit des affaires'] },
  { slug: 'cabinet-recrutement', keywords: 'cabinet recrutement OR recrutement', patterns: ['cabinet recrutement', 'recrutement', 'chasseur tete', 'talent acquisition', 'rh externalisee'] },
  // Finance & Assurance
  { slug: 'courtier-assurance', keywords: 'courtier assurance OR courtage', patterns: ['courtier assurance', 'courtage', 'assurance entreprise', 'courtier'] },
  { slug: 'gestion-patrimoine', keywords: 'gestion patrimoine OR CGP', patterns: ['gestion patrimoine', 'cgp', 'conseiller patrimoine', 'patrimoine', 'gestion fortune'] },
  // Formation & Education
  { slug: 'formation-pro', keywords: 'formation professionnelle OR organisme formation', patterns: ['formation professionnelle', 'organisme formation', 'centre formation', 'formation continue', 'formation entreprise'] },
  // Immobilier & Construction
  { slug: 'immobilier-pro', keywords: 'immobilier professionnel OR agence immobiliere', patterns: ['immobilier professionnel', 'agence immobiliere', 'promoteur immobilier', 'immobilier commercial', 'gestion locative'] },
  { slug: 'btp-construction', keywords: 'BTP OR construction', patterns: ['btp', 'construction', 'entreprise batiment', 'travaux publics', 'renovation'] },
  // Industrie & Manufacturing
  { slug: 'industrie-pme', keywords: 'industrie PME OR industriel', patterns: ['industrie', 'industriel', 'pme industrielle', 'manufacturing', 'production', 'usine'] },
  // Sante & Bien-etre
  { slug: 'sante-medtech', keywords: 'medtech OR sante entreprise', patterns: ['medtech', 'sante', 'dispositif medical', 'pharma', 'biotech', 'labo'] },
  // Transport & Logistique
  { slug: 'transport-logistique', keywords: 'transport OR logistique', patterns: ['transport', 'logistique', 'supply chain', 'fret', 'livraison', 'transitaire'] },
  // Commerce & Distribution
  { slug: 'franchise-reseau', keywords: 'franchise OR reseau commercial', patterns: ['franchise', 'reseau commercial', 'reseau distribution', 'concessionnaire', 'distributeur'] },
  // Communication & Media
  { slug: 'relations-publiques', keywords: 'relations publiques OR agence RP', patterns: ['relations publiques', 'agence rp', 'communication corporate', 'evenementiel', 'agence evenementiel'] },
  // Autres services B2B
  { slug: 'nettoyage-proprete', keywords: 'nettoyage professionnel OR proprete', patterns: ['nettoyage', 'proprete', 'nettoyage professionnel', 'facility management', 'entretien'] },
  { slug: 'securite-privee', keywords: 'securite privee OR gardiennage', patterns: ['securite privee', 'gardiennage', 'securite entreprise', 'surveillance', 'telesurveillance'] },
  { slug: 'energie-environnement', keywords: 'energie renouvelable OR transition energetique', patterns: ['energie renouvelable', 'transition energetique', 'solaire', 'environnement', 'cleantech', 'greentech'] }
];

function getNicheList() {
  return B2B_NICHE_LIST;
}

let _data = null;

// --- State machine : etats et transitions valides du Pilot ---
const PILOT_STATES = {
  IDLE: 'idle',           // Brief pas encore defini
  ACTIVE: 'active',       // En fonctionnement normal
  PAUSED: 'paused',       // Mis en pause par le user
  ERROR: 'error'          // Erreur critique (config manquante)
};

const VALID_TRANSITIONS = {
  'idle':   ['active'],              // brief defini → actif
  'active': ['paused', 'error'],     // pause ou erreur
  'paused': ['active'],              // reprise
  'error':  ['active', 'idle']       // correction → actif ou reset
};

function _getPilotState(config) {
  if (!config.businessContext) return PILOT_STATES.IDLE;
  if (!config.enabled) return PILOT_STATES.PAUSED;
  return PILOT_STATES.ACTIVE;
}

function _canTransition(fromState, toState) {
  const allowed = VALID_TRANSITIONS[fromState];
  return allowed && allowed.includes(toState);
}

function _defaultData() {
  return {
    config: {
      enabled: true,
      adminChatId: '1409505520',
      businessContext: '',
      autonomyLevel: 'semi',
      offer: {
        setup: 0,
        monthly: 0,
        commitment: '',
        trial: '',
        description: ''
      },
      emailPreferences: {
        maxLines: 5,
        language: 'fr',
        tone: 'direct',
        forbiddenWords: [
          'SDR', 'pipeline', 'automatisation', 'solution', 'offre', 'plateforme',
          'outil', 'logiciel', 'SaaS', 'innovation', 'revolutionner', 'transformer',
          'optimiser', 'booster', 'scaler', 'ROI', 'KPI', 'growth hack',
          'synergie', 'levier', 'disruptif', 'game-changer', 'next-gen',
          'essai gratuit', 'pilote gratuit'
        ],
        hookStyle: 'problem-first',
        signatureStyle: ''
      },
      followUpConfig: {
        sequenceStepDays: [0, 3, 10],
        sequenceTotalSteps: 3,
        reactiveMinDelayMinutes: 120,
        reactiveMaxDelayMinutes: 240
      },
      brainSchedule: {
        enabled: true,
        businessHoursOnly: true,
        intervalHours: 4,
        dailyBriefingHour: 7
      }
    },
    goals: {
      weekly: {
        leadsToFind: 20,
        emailsToSend: 10,
        responsesTarget: 2,
        rdvTarget: 1,
        minOpenRate: 25,
        minLeadScore: 7,
        pushToCrmAboveScore: 7
      },
      searchCriteria: {
        titles: ['CEO', 'Founder', 'Co-founder', 'CTO', 'Fondateur', 'Directeur', 'Gerant', 'Associe', 'Directeur General', 'President', 'DG'],
        locations: ['France'],
        seniorities: ['founder', 'c_suite', 'director', 'owner'],
        industries: [],
        keywords: '',
        companySize: ['1-10', '11-50', '51-200'],
        limit: 10
      }
    },
    progress: {
      weekStart: new Date().toISOString().substring(0, 10),
      leadsFoundThisWeek: 0,
      leadsEnrichedThisWeek: 0,
      emailsSentThisWeek: 0,
      emailsOpenedThisWeek: 0,
      responsesThisWeek: 0,
      rdvBookedThisWeek: 0,
      contactsPushedThisWeek: 0,
      dealsPushedThisWeek: 0
    },
    actionQueue: [],
    actionHistory: [],
    diagnostic: {
      items: [],
      lastCheckAt: null
    },
    learnings: {
      bestSearchCriteria: [],
      bestEmailStyles: [],
      bestSendTimes: [],
      experiments: [],
      weeklyPerformance: []
    },
    stats: {
      totalBrainCycles: 0,
      totalActionsExecuted: 0,
      totalActionsConfirmed: 0,
      totalActionsRejected: 0,
      totalDiagnosticItems: 0,
      totalCriteriaUpdates: 0,
      createdAt: new Date().toISOString(),
      lastBrainCycleAt: null
    }
  };
}

function _ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function _load() {
  if (_data) return _data;
  _ensureDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      _data = JSON.parse(raw);
      const def = _defaultData();
      // Deep merge all sections
      if (!_data.config) _data.config = def.config;
      if (!_data.config.brainSchedule) _data.config.brainSchedule = def.config.brainSchedule;
      if (!_data.config.offer) _data.config.offer = def.config.offer;
      if (!_data.config.emailPreferences) _data.config.emailPreferences = def.config.emailPreferences;
      // Migration : injecter les 30 mots interdits si la liste est vide (ancien JSON sur disque)
      if (!_data.config.emailPreferences.forbiddenWords || _data.config.emailPreferences.forbiddenWords.length === 0) {
        _data.config.emailPreferences.forbiddenWords = def.config.emailPreferences.forbiddenWords;
        log.info('autonomous-pilot', 'Migration: 30 mots interdits injectes');
      }
      if (!_data.goals) _data.goals = def.goals;
      if (!_data.goals.weekly) _data.goals.weekly = def.goals.weekly;
      if (_data.goals.weekly.responsesTarget === undefined) _data.goals.weekly.responsesTarget = def.goals.weekly.responsesTarget;
      if (_data.goals.weekly.rdvTarget === undefined) _data.goals.weekly.rdvTarget = def.goals.weekly.rdvTarget;
      if (!_data.goals.searchCriteria) _data.goals.searchCriteria = def.goals.searchCriteria;
      if (!_data.goals.searchCriteria.industries) _data.goals.searchCriteria.industries = [];
      // --- Guard: fix empty ICP fields on load ---
      const scLoad = _data.goals.searchCriteria;
      if (!scLoad.titles || scLoad.titles.length === 0) {
        scLoad.titles = ICP_DEFAULTS.titles;
        log.warn('autonomous-pilot', 'Load guard: titles vide, ICP defaults restaures');
      }
      if (!scLoad.locations || scLoad.locations.length === 0) {
        scLoad.locations = ICP_DEFAULTS.locations;
        log.warn('autonomous-pilot', 'Load guard: locations vide, ICP defaults restaures');
      }
      if (!scLoad.seniorities || scLoad.seniorities.length === 0) {
        scLoad.seniorities = ICP_DEFAULTS.seniorities;
        log.warn('autonomous-pilot', 'Load guard: seniorities vide, ICP defaults restaures');
      }
      if (!scLoad.companySize || scLoad.companySize.length === 0) {
        scLoad.companySize = ICP_DEFAULTS.companySize;
        log.warn('autonomous-pilot', 'Load guard: companySize vide, ICP defaults restaures');
      }
      if (!_data.progress) _data.progress = def.progress;
      if (_data.progress.responsesThisWeek === undefined) _data.progress.responsesThisWeek = 0;
      if (_data.progress.rdvBookedThisWeek === undefined) _data.progress.rdvBookedThisWeek = 0;
      if (!_data.actionQueue) _data.actionQueue = [];
      if (!_data.actionHistory) _data.actionHistory = [];
      if (!_data.diagnostic) _data.diagnostic = def.diagnostic;
      if (!_data.learnings) _data.learnings = def.learnings;
      if (!_data.learnings.experiments) _data.learnings.experiments = [];
      if (!_data.stats) _data.stats = def.stats;
      if (_data.stats.totalCriteriaUpdates === undefined) _data.stats.totalCriteriaUpdates = 0;
      log.info('autonomous-pilot', 'Donnees chargees (' +
        _data.actionHistory.length + ' actions, ' +
        _data.diagnostic.items.length + ' diagnostics)');
    } else {
      _data = _defaultData();
      _save();
      log.info('autonomous-pilot', 'Nouvelle base creee');
    }
  } catch (e) {
    log.warn('autonomous-pilot', 'Erreur lecture, reset:', e.message);
    _data = _defaultData();
    _save();
  }
  return _data;
}

function _save() {
  _ensureDir();
  try {
    atomicWriteSync(DATA_FILE, _data);
  } catch (e) {
    log.warn('autonomous-pilot', 'Erreur ecriture:', e.message);
  }
}

function _generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

// --- Config ---

function getConfig() {
  return _load().config;
}

function updateConfig(updates) {
  const data = _load();
  const oldState = _getPilotState(data.config);

  Object.assign(data.config, updates);

  // Valider la transition d'etat
  const newState = _getPilotState(data.config);
  if (oldState !== newState) {
    if (_canTransition(oldState, newState)) {
      log.info('autonomous-pilot', 'Transition: ' + oldState + ' → ' + newState);
    } else {
      log.warn('autonomous-pilot', 'Transition invalide: ' + oldState + ' → ' + newState + ' (forcee)');
    }
    data.config._state = newState;
    data.config._stateChangedAt = new Date().toISOString();
  }

  _save();
  return data.config;
}

function updateEmailPreferences(updates) {
  const data = _load();
  if (!data.config.emailPreferences) data.config.emailPreferences = {};
  Object.assign(data.config.emailPreferences, updates);
  _save();
  return data.config.emailPreferences;
}

function updateOffer(updates) {
  const data = _load();
  if (!data.config.offer) data.config.offer = {};
  Object.assign(data.config.offer, updates);
  _save();
  return data.config.offer;
}

// --- Goals ---

function getGoals() {
  return _load().goals;
}

function updateWeeklyGoals(updates) {
  const data = _load();
  Object.assign(data.goals.weekly, updates);
  _save();
  return data.goals.weekly;
}

function updateSearchCriteria(updates) {
  const data = _load();
  Object.assign(data.goals.searchCriteria, updates);
  // --- Guard: NEVER allow empty ICP fields — fallback to ICP_DEFAULTS ---
  const sc = data.goals.searchCriteria;
  if (!sc.titles || sc.titles.length === 0) {
    sc.titles = ICP_DEFAULTS.titles;
    log.warn('autonomous-pilot', 'Guard: titles vide apres update, ICP defaults restaures');
  }
  if (!sc.locations || sc.locations.length === 0) {
    sc.locations = ICP_DEFAULTS.locations;
    log.warn('autonomous-pilot', 'Guard: locations vide apres update, ICP defaults restaures');
  }
  if (!sc.seniorities || sc.seniorities.length === 0) {
    sc.seniorities = ICP_DEFAULTS.seniorities;
    log.warn('autonomous-pilot', 'Guard: seniorities vide apres update, ICP defaults restaures');
  }
  if (!sc.companySize || sc.companySize.length === 0) {
    sc.companySize = ICP_DEFAULTS.companySize;
    log.warn('autonomous-pilot', 'Guard: companySize vide apres update, ICP defaults restaures');
  }
  data.stats.totalCriteriaUpdates = (data.stats.totalCriteriaUpdates || 0) + 1;
  _save();
  return data.goals.searchCriteria;
}

// --- Progress ---

function getProgress() {
  return _load().progress;
}

function incrementProgress(key, amount) {
  const data = _load();
  data.progress[key] = (data.progress[key] || 0) + (amount || 1);
  _save();
}

function resetWeeklyProgress() {
  const data = _load();
  const oldProgress = { ...data.progress };
  data.learnings.weeklyPerformance.unshift({
    ...oldProgress,
    goals: { ...data.goals.weekly },
    searchCriteria: { ...data.goals.searchCriteria },
    recordedAt: new Date().toISOString()
  });
  if (data.learnings.weeklyPerformance.length > 52) {
    data.learnings.weeklyPerformance = data.learnings.weeklyPerformance.slice(0, 52);
  }
  data.progress = {
    weekStart: new Date().toISOString().substring(0, 10),
    leadsFoundThisWeek: 0,
    leadsEnrichedThisWeek: 0,
    emailsSentThisWeek: 0,
    emailsOpenedThisWeek: 0,
    responsesThisWeek: 0,
    rdvBookedThisWeek: 0,
    contactsPushedThisWeek: 0,
    dealsPushedThisWeek: 0
  };
  _save();
  return oldProgress;
}

// --- Action Queue ---

function addToQueue(action) {
  const data = _load();
  const fullAction = {
    id: _generateId('act'),
    type: action.type,
    params: action.params || {},
    preview: action.preview || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    executedAt: null,
    result: null
  };
  data.actionQueue.push(fullAction);
  _save();
  return fullAction;
}

function getQueuedActions() {
  return _load().actionQueue.filter(a => a.status === 'pending');
}

function confirmAction(actionId) {
  const data = _load();
  const action = data.actionQueue.find(a => a.id === actionId);
  if (!action) return null;
  action.status = 'confirmed';
  action.confirmedAt = new Date().toISOString();
  data.stats.totalActionsConfirmed++;
  _save();
  return action;
}

function rejectAction(actionId) {
  const data = _load();
  const idx = data.actionQueue.findIndex(a => a.id === actionId);
  if (idx === -1) return false;
  data.actionQueue[idx].status = 'rejected';
  data.stats.totalActionsRejected++;
  data.actionHistory.unshift(data.actionQueue[idx]);
  data.actionQueue.splice(idx, 1);
  if (data.actionHistory.length > 500) {
    data.actionHistory = data.actionHistory.slice(0, 500);
  }
  _save();
  return true;
}

function completeAction(actionId, result) {
  const data = _load();
  const idx = data.actionQueue.findIndex(a => a.id === actionId);
  if (idx === -1) return false;
  data.actionQueue[idx].status = 'completed';
  data.actionQueue[idx].executedAt = new Date().toISOString();
  data.actionQueue[idx].result = result;
  data.stats.totalActionsExecuted++;
  data.actionHistory.unshift(data.actionQueue[idx]);
  data.actionQueue.splice(idx, 1);
  if (data.actionHistory.length > 500) {
    data.actionHistory = data.actionHistory.slice(0, 500);
  }
  _save();
  return true;
}

// --- Queue cleanup (TTL 48h) ---

function cleanupQueue() {
  const data = _load();
  const TTL = 48 * 60 * 60 * 1000; // 48h
  const now = Date.now();
  const expired = [];
  const kept = [];

  for (const action of data.actionQueue) {
    const age = now - new Date(action.createdAt || 0).getTime();
    if (action.status === 'pending' && age > TTL) {
      action.status = 'expired';
      action.expiredAt = new Date().toISOString();
      data.actionHistory.unshift(action);
      expired.push(action.id);
    } else {
      kept.push(action);
    }
  }

  if (expired.length > 0) {
    data.actionQueue = kept;
    if (data.actionHistory.length > 500) {
      data.actionHistory = data.actionHistory.slice(0, 500);
    }
    _save();
    log.info('autonomous-pilot', 'Queue cleanup: ' + expired.length + ' action(s) expiree(s)');
  }

  return expired.length;
}

// --- Action History ---

function recordAction(action) {
  const data = _load();
  data.actionHistory.unshift({
    id: _generateId('act'),
    type: action.type,
    params: action.params || {},
    preview: action.preview || '',
    status: 'completed',
    result: action.result || null,
    createdAt: new Date().toISOString(),
    executedAt: new Date().toISOString()
  });
  if (data.actionHistory.length > 500) {
    data.actionHistory = data.actionHistory.slice(0, 500);
  }
  data.stats.totalActionsExecuted++;
  _save();
}

function getRecentActions(limit) {
  limit = limit || 20;
  return _load().actionHistory.slice(0, limit);
}

/**
 * Retourne un Set d'emails ayant echoue recemment
 * Cooldown progressif : 2 echecs → 5j, 3+ echecs → 14j
 * Inclut: skipped, blacklisted, gate blocked, invalid email, donnees insuffisantes
 */
function getRecentlyFailedEmails(cooldownDays) {
  cooldownDays = cooldownDays || 3;
  const history = _load().actionHistory;

  // Compter les echecs PAR email (toutes periodes confondues)
  const failCounts = {};
  for (const a of history) {
    if (a.type !== 'send_email') continue;
    const r = a.result;
    if (!r || typeof r !== 'object') continue;
    if (r.success === true) continue;
    const email = (a.params?.to || a.target || '').toLowerCase().trim();
    if (email && email.includes('@')) {
      if (!failCounts[email]) failCounts[email] = { count: 0, lastFail: 0 };
      failCounts[email].count++;
      const ts = a.executedAt ? new Date(a.executedAt).getTime()
        : a.createdAt ? new Date(a.createdAt).getTime()
        : a.timestamp ? new Date(a.timestamp).getTime() : 0;
      if (ts > failCounts[email].lastFail) failCounts[email].lastFail = ts;
    }
  }

  // Appliquer cooldown progressif
  const failed = new Set();
  const now = Date.now();
  for (const [email, info] of Object.entries(failCounts)) {
    let effectiveCooldown;
    if (info.count >= 3) {
      effectiveCooldown = 14; // 3+ echecs → exclu 14 jours
    } else if (info.count >= 2) {
      effectiveCooldown = 5;  // 2 echecs → exclu 5 jours
    } else {
      effectiveCooldown = cooldownDays; // 1 echec → cooldown normal (3j)
    }
    const cutoff = now - effectiveCooldown * 24 * 3600 * 1000;
    if (info.lastFail > cutoff) {
      failed.add(email);
    }
  }
  return failed;
}

// --- Diagnostic ---

function addDiagnosticItem(item) {
  const data = _load();
  const existing = data.diagnostic.items.find(
    i => i.message === item.message && i.status === 'open'
  );
  if (existing) return existing;

  const fullItem = {
    id: _generateId('diag'),
    type: item.type || 'owner_action',
    priority: item.priority || 'info',
    category: item.category || 'config',
    message: item.message || '',
    suggestion: item.suggestion || '',
    status: 'open',
    createdAt: new Date().toISOString(),
    resolvedAt: null
  };
  data.diagnostic.items.push(fullItem);
  data.stats.totalDiagnosticItems++;
  _save();
  return fullItem;
}

function resolveDiagnosticItem(id) {
  const data = _load();
  const item = data.diagnostic.items.find(i => i.id === id);
  if (!item) return false;
  item.status = 'resolved';
  item.resolvedAt = new Date().toISOString();
  _save();
  return true;
}

function getOpenDiagnostics() {
  return _load().diagnostic.items.filter(i => i.status === 'open');
}

function getAllDiagnostics() {
  return _load().diagnostic.items;
}

function updateDiagnosticCheck() {
  const data = _load();
  data.diagnostic.lastCheckAt = new Date().toISOString();
  _save();
}

// --- Learnings ---

function getLearnings() {
  return _load().learnings;
}

function addLearning(category, entry) {
  const data = _load();
  if (!data.learnings[category]) data.learnings[category] = [];
  data.learnings[category].unshift({
    ...entry,
    recordedAt: new Date().toISOString()
  });
  if (data.learnings[category].length > 50) {
    data.learnings[category] = data.learnings[category].slice(0, 50);
  }
  _save();
}

function addExperiment(experiment) {
  const data = _load();
  data.learnings.experiments.unshift({
    id: _generateId('exp'),
    ...experiment,
    startedAt: new Date().toISOString(),
    status: 'running'
  });
  if (data.learnings.experiments.length > 100) {
    data.learnings.experiments = data.learnings.experiments.slice(0, 100);
  }
  _save();
}

function completeExperiment(experimentId, results) {
  const data = _load();
  const exp = data.learnings.experiments.find(e => e.id === experimentId);
  if (!exp) return false;
  exp.status = 'completed';
  exp.results = results;
  exp.completedAt = new Date().toISOString();
  _save();
  return true;
}

function getActiveExperiments() {
  const data = _load();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let cleaned = false;
  for (const e of data.learnings.experiments) {
    if (e.status !== 'running') continue;
    const startedAt = e.startedAt ? new Date(e.startedAt).getTime() : 0;
    if (startedAt && startedAt < cutoff) {
      e.status = 'completed';
      e.completedAt = new Date().toISOString();
      e.result = 'auto-closed: stale > 7 days';
      cleaned = true;
    }
  }
  if (cleaned) _save();
  return data.learnings.experiments.filter(e => e.status === 'running');
}

// --- Stats ---

function getStats() {
  return _load().stats;
}

function updateStat(key, value) {
  const data = _load();
  data.stats[key] = value;
  _save();
}

function incrementStat(key) {
  const data = _load();
  data.stats[key] = (data.stats[key] || 0) + 1;
  _save();
}

// --- Patterns (apprentissage brain v3) ---

function getPatterns() {
  const data = _load();
  if (!data.patterns) data.patterns = null;
  return data.patterns;
}

function savePatterns(patterns) {
  const data = _load();
  data.patterns = {
    ...patterns,
    updatedAt: new Date().toISOString()
  };
  _save();
  return data.patterns;
}

// --- Criteria adjustment history (brain v3) ---

function getCriteriaHistory() {
  const data = _load();
  if (!data.criteriaHistory) data.criteriaHistory = [];
  return data.criteriaHistory;
}

function addCriteriaAdjustment(adjustment) {
  const data = _load();
  if (!data.criteriaHistory) data.criteriaHistory = [];
  data.criteriaHistory.unshift({
    ...adjustment,
    adjustedAt: new Date().toISOString()
  });
  if (data.criteriaHistory.length > 100) {
    data.criteriaHistory = data.criteriaHistory.slice(0, 100);
  }
  _save();
}

// --- Prospect Research Cache ---

function getProspectResearch(email) {
  const data = _load();
  if (!data.prospectResearch) data.prospectResearch = {};
  return data.prospectResearch[email.toLowerCase()] || null;
}

function saveProspectResearch(email, intel) {
  const data = _load();
  if (!data.prospectResearch) data.prospectResearch = {};
  data.prospectResearch[email.toLowerCase()] = {
    ...intel,
    cachedAt: new Date().toISOString()
  };
  // Limiter a 500 entrees
  const keys = Object.keys(data.prospectResearch);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) =>
      new Date(data.prospectResearch[a].cachedAt || 0) - new Date(data.prospectResearch[b].cachedAt || 0)
    );
    const toRemove = sorted.slice(0, keys.length - 500);
    for (const k of toRemove) delete data.prospectResearch[k];
  }
  _save();
}

// --- Data-Poor Queue (leads en attente de meilleures donnees) ---

function addToDataPoorQueue(email, contact, reason) {
  const data = _load();
  if (!data.dataPoorQueue) data.dataPoorQueue = {};
  const key = email.toLowerCase();
  const existing = data.dataPoorQueue[key];
  if (existing) {
    existing.failCount = (existing.failCount || 1) + 1;
    existing.lastFailAt = new Date().toISOString();
    existing.reason = reason;
  } else {
    data.dataPoorQueue[key] = {
      email: email,
      contact: contact,
      failCount: 1,
      firstFailAt: new Date().toISOString(),
      lastFailAt: new Date().toISOString(),
      reason: reason
    };
  }
  // Limiter a 200 entrees
  const keys = Object.keys(data.dataPoorQueue);
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) =>
      new Date(data.dataPoorQueue[a].lastFailAt || 0) - new Date(data.dataPoorQueue[b].lastFailAt || 0)
    );
    for (const k of sorted.slice(0, keys.length - 200)) delete data.dataPoorQueue[k];
  }
  _save();
}

function getDataPoorLeadsReady() {
  const data = _load();
  if (!data.dataPoorQueue) return [];
  const now = Date.now();
  const ready = [];
  for (const [key, entry] of Object.entries(data.dataPoorQueue)) {
    // Cooldown progressif : 1 fail=7j, 2 fails=14j, 3+=skip definitif
    if (entry.failCount >= 3) continue;
    const cooldownDays = entry.failCount === 1 ? 7 : 14;
    const elapsed = now - new Date(entry.lastFailAt).getTime();
    if (elapsed >= cooldownDays * 24 * 60 * 60 * 1000) {
      ready.push(entry);
    }
  }
  return ready;
}

function removeFromDataPoorQueue(email) {
  const data = _load();
  if (!data.dataPoorQueue) return;
  delete data.dataPoorQueue[email.toLowerCase()];
  _save();
}

function getDataPoorStats() {
  const data = _load();
  if (!data.dataPoorQueue) return { total: 0, ready: 0, exhausted: 0 };
  const entries = Object.values(data.dataPoorQueue);
  const ready = getDataPoorLeadsReady();
  return {
    total: entries.length,
    ready: ready.length,
    exhausted: entries.filter(e => e.failCount >= 3).length
  };
}

// --- Niche Performance Tracking (auto-pivot) ---

function getNichePerformance() {
  const data = _load();
  if (!data.nichePerformance) data.nichePerformance = {};
  // Migration auto : fusionner les doublons underscore/tiret
  const normalized = {};
  let hasDuplicates = false;
  for (const [niche, stats] of Object.entries(data.nichePerformance)) {
    const key = String(niche).replace(/_/g, '-').toLowerCase().trim();
    if (normalized[key]) {
      hasDuplicates = true;
      normalized[key].sent += (stats.sent || 0);
      normalized[key].opened += (stats.opened || 0);
      normalized[key].replied += (stats.replied || 0);
      normalized[key].leads += (stats.leads || 0);
    } else {
      normalized[key] = { sent: stats.sent || 0, opened: stats.opened || 0, replied: stats.replied || 0, leads: stats.leads || 0 };
    }
  }
  if (hasDuplicates) {
    data.nichePerformance = normalized;
    _save();
  }
  return data.nichePerformance;
}

function trackNicheEvent(niche, event) {
  if (!niche) return;
  // Normaliser : toujours tirets, lowercase (evite doublons agences-marketing vs agences_marketing)
  const normalizedNiche = String(niche).replace(/_/g, '-').toLowerCase().trim();
  const data = _load();
  if (!data.nichePerformance) data.nichePerformance = {};
  if (!data.nichePerformance[normalizedNiche]) {
    data.nichePerformance[normalizedNiche] = { sent: 0, opened: 0, replied: 0, leads: 0 };
  }
  const np = data.nichePerformance[normalizedNiche];
  if (event === 'lead') np.leads = (np.leads || 0) + 1;
  else if (event === 'sent') np.sent = (np.sent || 0) + 1;
  else if (event === 'opened') np.opened = (np.opened || 0) + 1;
  else if (event === 'replied') np.replied = (np.replied || 0) + 1;
  else if (event === 'clicked') np.clicked = (np.clicked || 0) + 1;
  _save();
}

// --- Niche Health Monitor ---

function getNicheHealth() {
  const data = _load();
  if (!data.nicheHealth) data.nicheHealth = {};
  return data.nicheHealth;
}

function updateNicheHealth(slug, healthData) {
  const data = _load();
  if (!data.nicheHealth) data.nicheHealth = {};
  const key = String(slug).replace(/_/g, '-').toLowerCase().trim();

  const existing = data.nicheHealth[key] || {
    totalAvailable: 0, contacted: 0, exhaustionPct: 0,
    lastScanAt: null, history: [], alertSentAt: null, status: 'unknown'
  };

  Object.assign(existing, healthData);

  // Calculer le statut
  const pct = existing.exhaustionPct || 0;
  if (pct >= 95) existing.status = 'exhausted';
  else if (pct >= 80) existing.status = 'critical';
  else if (pct >= 50) existing.status = 'warning';
  else existing.status = 'healthy';

  // Historique (garder 30 entrees max)
  if (!existing.history) existing.history = [];
  const today = new Date().toISOString().split('T')[0];
  if (!existing.history.find(h => h.date === today)) {
    existing.history.push({
      date: today,
      available: existing.totalAvailable,
      contacted: existing.contacted
    });
    if (existing.history.length > 30) existing.history = existing.history.slice(-30);
  }

  data.nicheHealth[key] = existing;
  _save();
  return existing;
}

function markNicheAlertSent(slug) {
  const data = _load();
  if (!data.nicheHealth) data.nicheHealth = {};
  const key = String(slug).replace(/_/g, '-').toLowerCase().trim();
  if (data.nicheHealth[key]) {
    data.nicheHealth[key].alertSentAt = new Date().toISOString();
    _save();
  }
}

function getNicheHealthSummary() {
  const data = _load();
  const health = data.nicheHealth || {};
  return B2B_NICHE_LIST.map(n => {
    const h = health[n.slug] || { status: 'unknown', exhaustionPct: 0, totalAvailable: 0, contacted: 0 };
    return { slug: n.slug, keywords: n.keywords, ...h };
  });
}

// --- Tracking d'angles email par industrie (anti-repetition) ---

function trackUsedAngle(industry, angle) {
  if (!industry || !angle) return;
  const data = _load();
  if (!data.usedAngles) data.usedAngles = {};
  const key = industry.toLowerCase().trim();
  if (!data.usedAngles[key]) data.usedAngles[key] = [];
  data.usedAngles[key].push({ angle: angle.substring(0, 150), usedAt: new Date().toISOString() });
  // Garder les 30 derniers angles par industrie
  if (data.usedAngles[key].length > 30) data.usedAngles[key] = data.usedAngles[key].slice(-30);
  _save();
}

function getRecentAnglesForIndustry(industry, limit) {
  if (!industry) return [];
  const data = _load();
  if (!data.usedAngles) return [];
  const key = industry.toLowerCase().trim();
  const angles = data.usedAngles[key] || [];
  return angles.sort((a, b) => (b.usedAt || '').localeCompare(a.usedAt || '')).slice(0, limit || 10).map(a => a.angle);
}

// --- Inter-Prospect Memory : intelligence sectorielle ---

function recordCompetitorContact(industry, companyData) {
  if (!industry || !companyData) return;
  const data = _load();
  if (!data.companyIntelligence) data.companyIntelligence = {};
  const key = industry.toLowerCase().trim();
  if (!data.companyIntelligence[key]) data.companyIntelligence[key] = [];

  // Dedup par domaine ou nom
  const existing = data.companyIntelligence[key].find(c =>
    (companyData.domain && c.domain === companyData.domain) ||
    (companyData.name && c.name && c.name.toLowerCase() === companyData.name.toLowerCase())
  );
  if (existing) {
    existing.contactedAt = new Date().toISOString();
    existing.contactCount = (existing.contactCount || 1) + 1;
    if (companyData.score) existing.score = companyData.score;
    if (companyData.employees) existing.employees = companyData.employees;
    if (companyData.city) existing.city = companyData.city;
  } else {
    data.companyIntelligence[key].push({
      name: companyData.name || '',
      domain: companyData.domain || '',
      keywords: (companyData.keywords || []).slice(0, 5),
      employees: companyData.employees || null,
      score: companyData.score || null,
      city: companyData.city || null,
      contactedAt: new Date().toISOString(),
      contactCount: 1
    });
  }

  // Max 50 entreprises par industrie
  if (data.companyIntelligence[key].length > 50) {
    data.companyIntelligence[key] = data.companyIntelligence[key].slice(-50);
  }
  _save();
}

function getCompetitorsInIndustry(industry, limit) {
  if (!industry) return [];
  const data = _load();
  if (!data.companyIntelligence) return [];
  const key = industry.toLowerCase().trim();
  return (data.companyIntelligence[key] || [])
    .sort((a, b) => (b.contactedAt || '').localeCompare(a.contactedAt || ''))
    .slice(0, limit || 10);
}

module.exports = {
  PILOT_STATES, ICP_DEFAULTS, B2B_NICHE_LIST, getNicheList,
  getPilotState: () => _getPilotState(_load().config),
  getConfig, updateConfig, updateEmailPreferences, updateOffer,
  getGoals, updateWeeklyGoals, updateSearchCriteria,
  getProgress, incrementProgress, resetWeeklyProgress,
  addToQueue, getQueuedActions, confirmAction, rejectAction, completeAction, cleanupQueue,
  recordAction, getRecentActions, getRecentlyFailedEmails,
  addDiagnosticItem, resolveDiagnosticItem, getOpenDiagnostics, getAllDiagnostics, updateDiagnosticCheck,
  getLearnings, addLearning, addExperiment, completeExperiment, getActiveExperiments,
  getPatterns, savePatterns, getCriteriaHistory, addCriteriaAdjustment,
  getProspectResearch, saveProspectResearch,
  addToDataPoorQueue, getDataPoorLeadsReady, removeFromDataPoorQueue, getDataPoorStats,
  getNichePerformance, trackNicheEvent,
  getNicheHealth, updateNicheHealth, markNicheAlertSent, getNicheHealthSummary,
  trackUsedAngle, getRecentAnglesForIndustry,
  recordCompetitorContact, getCompetitorsInIndustry,
  getStats, updateStat, incrementStat
};
