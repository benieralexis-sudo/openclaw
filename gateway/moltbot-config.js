// MoltBot - Configuration globale persistante (mode standby/production + budget API)
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = process.env.MOLTBOT_CONFIG_DIR || '/data/moltbot-config';
const CONFIG_FILE = path.join(CONFIG_DIR, 'moltbot-config.json');

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
    console.log('[moltbot-config] Erreur lecture config:', e.message);
    _config = _defaultConfig();
    save();
  }
  return _config;
}

function save() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2));
  } catch (e) {
    console.log('[moltbot-config] Erreur ecriture config:', e.message);
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
  console.log('[moltbot-config] Mode PRODUCTION active');
}

function deactivateAll() {
  load();
  _config.mode = 'standby';
  _config.cronsActive = false;
  _config.lastModeChange = new Date().toISOString();
  save();
  console.log('[moltbot-config] Mode STANDBY active');
}

// --- Budget API ---

// Estimation cout par modele ($ par 1K tokens)
const MODEL_RATES = {
  'gpt-4o-mini': 0.0004,
  'claude-sonnet-4-5-20250929': 0.009,
  'claude-opus-4-6': 0.045
};

function estimateCost(model, tokens) {
  const rate = MODEL_RATES[model] || 0.005;
  return (tokens / 1000) * rate;
}

function recordApiSpend(model, tokens) {
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

  const cost = estimateCost(model, tokens);
  _config.budget.todaySpent += cost;
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

function getBudgetStatus() {
  load();
  return { ..._config.budget };
}

function onBudgetExceeded(callback) {
  _budgetExceededCallback = callback;
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
  getBudgetStatus,
  onBudgetExceeded
};
