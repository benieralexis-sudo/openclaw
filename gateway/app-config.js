// iFIND - Configuration globale persistante (mode standby/production + budget API)
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('./utils.js');
const log = require('./logger.js');

const CONFIG_DIR = process.env.APP_CONFIG_DIR || process.env.MOLTBOT_CONFIG_DIR || '/data/app-config';
const CONFIG_FILE = path.join(CONFIG_DIR, 'app-config.json');

function _defaultConfig() {
  return {
    mode: 'standby',
    cronsActive: false,
    startedAt: new Date().toISOString(),
    lastModeChange: new Date().toISOString(),
    budget: {
      dailyLimit: parseFloat(process.env.API_DAILY_BUDGET) || 5.0,
      todaySpent: 0,
      todayDate: new Date().toISOString().substring(0, 10),
      history: []
    }
  };
}

let _config = null;
let _budgetExceededCallback = null;
let _budgetNotifiedToday = false;

function load() {
  if (_config) return _config;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch (e) {}
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      _config = JSON.parse(raw);
      // Merge avec defaults pour les nouveaux champs
      const defaults = _defaultConfig();
      if (!_config.budget) _config.budget = defaults.budget;
      if (!_config.budget.dailyLimit) _config.budget.dailyLimit = defaults.budget.dailyLimit;
      if (!_config.budget.todayDate) _config.budget.todayDate = defaults.budget.todayDate;
      if (!_config.budget.history) _config.budget.history = [];
    } else {
      _config = _defaultConfig();
      save();
    }
  } catch (e) {
    log.warn('app-config', 'Erreur lecture config:', e.message);
    _config = _defaultConfig();
    save();
  }
  return _config;
}

function save() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    atomicWriteSync(CONFIG_FILE, _config);
  } catch (e) {
    log.warn('app-config', 'Erreur ecriture config:', e.message);
  }
}

function getConfig() {
  load();
  return _config;
}

function getMode() {
  load();
  return _config.mode;
}

function isProduction() {
  load();
  return _config.mode === 'production';
}

function isStandby() {
  load();
  return _config.mode !== 'production';
}

function activateAll() {
  load();
  _config.mode = 'production';
  _config.cronsActive = true;
  _config.lastModeChange = new Date().toISOString();
  save();
  log.info('app-config', 'Mode PRODUCTION active');
}

function deactivateAll() {
  load();
  _config.mode = 'standby';
  _config.cronsActive = false;
  _config.lastModeChange = new Date().toISOString();
  save();
  log.info('app-config', 'Mode STANDBY active');
}

// --- Budget API ---

// Estimation cout par modele ($ par 1K tokens) — input et output separes
const MODEL_RATES = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
  'claude-opus-4-6': { input: 0.015, output: 0.075 }
};
const DEFAULT_RATE = { input: 0.005, output: 0.015 };

function estimateCost(model, inputTokens, outputTokens) {
  const rates = MODEL_RATES[model] || DEFAULT_RATE;
  // Backward compat : si outputTokens absent, estimer 30% output / 70% input
  if (outputTokens === undefined || outputTokens === null) {
    const total = inputTokens;
    inputTokens = Math.round(total * 0.7);
    outputTokens = Math.round(total * 0.3);
  }
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

function recordApiSpend(model, inputTokens, outputTokens) {
  load();
  const today = new Date().toISOString().substring(0, 10);

  // Reset journalier
  if (_config.budget.todayDate !== today) {
    if (_config.budget.todaySpent > 0) {
      _config.budget.history.push({
        date: _config.budget.todayDate,
        spent: Math.round(_config.budget.todaySpent * 10000) / 10000
      });
      if (_config.budget.history.length > 30) {
        _config.budget.history = _config.budget.history.slice(-30);
      }
    }
    _config.budget.todaySpent = 0;
    _config.budget.todayDate = today;
    _budgetNotifiedToday = false;
  }

  const cost = estimateCost(model, inputTokens, outputTokens);
  _config.budget.todaySpent += cost;

  // Track par service aussi
  const service = model.startsWith('gpt') ? 'openai' : 'claude';
  recordServiceUsage(service, { cost, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 });

  save();

  // Notification si budget depasse
  if (_config.budget.todaySpent >= _config.budget.dailyLimit && !_budgetNotifiedToday) {
    _budgetNotifiedToday = true;
    if (_budgetExceededCallback) {
      _budgetExceededCallback(_config.budget);
    }
  }

  return _config.budget.todaySpent;
}

function isBudgetExceeded() {
  load();
  const today = new Date().toISOString().substring(0, 10);
  if (_config.budget.todayDate !== today) return false;
  return _config.budget.todaySpent >= _config.budget.dailyLimit;
}

// Guard : a appeler AVANT un appel API couteux. Leve une erreur si budget depasse.
function assertBudgetAvailable() {
  if (isBudgetExceeded()) {
    throw new Error('Budget API journalier depasse ($' + _config.budget.todaySpent.toFixed(2) + '/$' + _config.budget.dailyLimit.toFixed(2) + '). Augmente API_DAILY_BUDGET ou attends demain.');
  }
}

function getBudgetStatus() {
  load();
  return { ..._config.budget };
}

function onBudgetExceeded(callback) {
  _budgetExceededCallback = callback;
}

// --- Service usage tracking (Apollo, FullEnrich, Gmail, Resend) ---

function _ensureServiceUsage() {
  load();
  if (!_config.serviceUsage) _config.serviceUsage = {};
  const today = new Date().toISOString().substring(0, 10);
  if (!_config.serviceUsage[today]) {
    // Archiver les jours precedents dans history
    if (!_config.serviceUsageHistory) _config.serviceUsageHistory = [];
    for (const [date, data] of Object.entries(_config.serviceUsage)) {
      if (date !== today && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        _config.serviceUsageHistory.push({ date, ...data });
      }
    }
    // Garder 90 jours d'historique
    if (_config.serviceUsageHistory.length > 90) {
      _config.serviceUsageHistory = _config.serviceUsageHistory.slice(-90);
    }
    // Nettoyer les anciens jours du serviceUsage courant
    for (const key of Object.keys(_config.serviceUsage)) {
      if (key !== today && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
        delete _config.serviceUsage[key];
      }
    }
    _config.serviceUsage[today] = {};
  }
  return _config.serviceUsage[today];
}

function recordServiceUsage(service, metrics) {
  const today = _ensureServiceUsage();
  if (!today[service]) today[service] = { calls: 0, cost: 0 };
  const s = today[service];
  s.calls = (s.calls || 0) + 1;
  if (metrics.cost) s.cost = (s.cost || 0) + metrics.cost;
  if (metrics.credits) s.credits = (s.credits || 0) + metrics.credits;
  if (metrics.emails) s.emails = (s.emails || 0) + metrics.emails;
  if (metrics.searches) s.searches = (s.searches || 0) + metrics.searches;
  if (metrics.reveals) s.reveals = (s.reveals || 0) + metrics.reveals;
  if (metrics.inputTokens) s.inputTokens = (s.inputTokens || 0) + metrics.inputTokens;
  if (metrics.outputTokens) s.outputTokens = (s.outputTokens || 0) + metrics.outputTokens;
  save();
}

function getServiceUsage() {
  _ensureServiceUsage();
  const today = new Date().toISOString().substring(0, 10);
  return {
    today: _config.serviceUsage[today] || {},
    history: _config.serviceUsageHistory || []
  };
}

// Couts fixes mensuels
const FIXED_MONTHLY_COSTS = {
  googleWorkspace: { amount: 7.00, currency: 'USD', label: 'Google Workspace' },
  domain: { amount: 0.58, currency: 'EUR', label: 'Domaine getifind.fr' }
};

function getFixedCosts() {
  return FIXED_MONTHLY_COSTS;
}

module.exports = {
  load,
  getConfig,
  getMode,
  isProduction,
  isStandby,
  activateAll,
  deactivateAll,
  recordApiSpend,
  isBudgetExceeded,
  assertBudgetAvailable,
  getBudgetStatus,
  onBudgetExceeded,
  recordServiceUsage,
  getServiceUsage,
  getFixedCosts
};
