// Autonomous Pilot - Stockage JSON persistant
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.AUTONOMOUS_PILOT_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'autonomous-pilot.json');

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
          'SDR', 'pipeline', 'pilote', 'automatisation', 'solution', 'offre', 'plateforme',
          'outil', 'logiciel', 'SaaS', 'innovation', 'revolutionner', 'transformer',
          'optimiser', 'booster', 'scaler', 'ROI', 'KPI', 'growth', 'hack',
          'synergie', 'levier', 'disruptif', 'game-changer', 'next-gen',
          'intelligence artificielle', 'machine learning', 'IA',
          'demo', 'essai gratuit', 'pilote gratuit'
        ],
        hookStyle: 'problem-first',
        signatureStyle: ''
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
        titles: ['CEO', 'CTO', 'Founder', 'Directeur'],
        locations: ['Paris, FR'],
        seniorities: ['c_suite', 'vp', 'director'],
        industries: [],
        keywords: '',
        companySize: ['11-50', '51-200'],
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
        console.log('[autonomous-pilot-storage] Migration: 30 mots interdits injectes');
      }
      if (!_data.goals) _data.goals = def.goals;
      if (!_data.goals.weekly) _data.goals.weekly = def.goals.weekly;
      if (_data.goals.weekly.responsesTarget === undefined) _data.goals.weekly.responsesTarget = def.goals.weekly.responsesTarget;
      if (_data.goals.weekly.rdvTarget === undefined) _data.goals.weekly.rdvTarget = def.goals.weekly.rdvTarget;
      if (!_data.goals.searchCriteria) _data.goals.searchCriteria = def.goals.searchCriteria;
      if (!_data.goals.searchCriteria.industries) _data.goals.searchCriteria.industries = [];
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
      console.log('[autonomous-pilot-storage] Donnees chargees (' +
        _data.actionHistory.length + ' actions, ' +
        _data.diagnostic.items.length + ' diagnostics)');
    } else {
      _data = _defaultData();
      _save();
      console.log('[autonomous-pilot-storage] Nouvelle base creee');
    }
  } catch (e) {
    console.log('[autonomous-pilot-storage] Erreur lecture, reset:', e.message);
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
    console.log('[autonomous-pilot-storage] Erreur ecriture:', e.message);
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
      console.log('[autonomous-pilot] Transition: ' + oldState + ' → ' + newState);
    } else {
      console.warn('[autonomous-pilot] Transition invalide: ' + oldState + ' → ' + newState + ' (forcee)');
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
  _save();
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
  return _load().learnings.experiments.filter(e => e.status === 'running');
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

module.exports = {
  PILOT_STATES, getPilotState: () => _getPilotState(_load().config),
  getConfig, updateConfig, updateEmailPreferences, updateOffer,
  getGoals, updateWeeklyGoals, updateSearchCriteria,
  getProgress, incrementProgress, resetWeeklyProgress,
  addToQueue, getQueuedActions, confirmAction, rejectAction, completeAction,
  recordAction, getRecentActions,
  addDiagnosticItem, resolveDiagnosticItem, getOpenDiagnostics, getAllDiagnostics, updateDiagnosticCheck,
  getLearnings, addLearning, addExperiment, completeExperiment, getActiveExperiments,
  getPatterns, savePatterns, getCriteriaHistory, addCriteriaAdjustment,
  getProspectResearch, saveProspectResearch,
  getStats, updateStat, incrementStat
};
