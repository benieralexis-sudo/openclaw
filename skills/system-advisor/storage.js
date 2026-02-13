// System Advisor - Stockage JSON persistant
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.SYSTEM_ADVISOR_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'system-advisor.json');

let _data = null;

function _defaultData() {
  return {
    config: {
      enabled: true,
      adminChatId: '1409505520',
      alerts: {
        metricsCollection: { enabled: true, intervalMinutes: 5 },
        healthCheck: { enabled: true, intervalMinutes: 60 },
        dailyReport: { enabled: true, hour: 7 },
        weeklyReport: { enabled: true, dayOfWeek: 1, hour: 8 }
      },
      thresholds: {
        ramWarning: 80,
        ramCritical: 95,
        diskWarning: 80,
        diskCritical: 95,
        errorRateWarning: 10,
        inactivityHours: 24
      }
    },
    systemMetrics: {
      snapshots: [],
      hourlyAggregates: [],
      dailyAggregates: []
    },
    skillMetrics: {
      usage: {},
      responseTimes: {},
      errors: {},
      cronExecutions: []
    },
    healthChecks: {
      history: [],
      lastCheck: null
    },
    activeAlerts: [],
    alertHistory: [],
    stats: {
      totalSnapshots: 0,
      totalHealthChecks: 0,
      totalAlertsSent: 0,
      totalReportsSent: 0,
      lastSnapshotAt: null,
      lastHealthCheckAt: null,
      lastDailyReportAt: null,
      lastWeeklyReportAt: null,
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
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
      if (!_data.config) _data.config = def.config;
      if (!_data.config.thresholds) _data.config.thresholds = def.config.thresholds;
      if (!_data.config.alerts) _data.config.alerts = def.config.alerts;
      if (!_data.systemMetrics) _data.systemMetrics = def.systemMetrics;
      if (!_data.skillMetrics) _data.skillMetrics = def.skillMetrics;
      if (!_data.healthChecks) _data.healthChecks = def.healthChecks;
      if (!_data.activeAlerts) _data.activeAlerts = [];
      if (!_data.alertHistory) _data.alertHistory = [];
      if (!_data.stats) _data.stats = def.stats;
      console.log('[system-advisor-storage] Donnees chargees (' + _data.systemMetrics.snapshots.length + ' snapshots)');
    } else {
      _data = _defaultData();
      _save();
      console.log('[system-advisor-storage] Nouvelle base creee');
    }
  } catch (e) {
    console.log('[system-advisor-storage] Erreur lecture, reset:', e.message);
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
    console.log('[system-advisor-storage] Erreur ecriture:', e.message);
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
  Object.assign(data.config, updates);
  _save();
  return data.config;
}

function setThreshold(key, value) {
  const data = _load();
  data.config.thresholds[key] = value;
  _save();
}

// --- System Metrics ---

function saveSnapshot(snapshot) {
  const data = _load();
  data.systemMetrics.snapshots.push(snapshot);
  // Max 2016 snapshots (7 jours a 5min d'intervalle)
  if (data.systemMetrics.snapshots.length > 2016) {
    data.systemMetrics.snapshots = data.systemMetrics.snapshots.slice(-2016);
  }
  data.stats.totalSnapshots++;
  data.stats.lastSnapshotAt = new Date().toISOString();
  _save();
}

function getRecentSnapshots(count) {
  count = count || 12;
  const data = _load();
  return data.systemMetrics.snapshots.slice(-count);
}

function saveHourlyAggregate(aggregate) {
  const data = _load();
  data.systemMetrics.hourlyAggregates.push(aggregate);
  if (data.systemMetrics.hourlyAggregates.length > 168) {
    data.systemMetrics.hourlyAggregates = data.systemMetrics.hourlyAggregates.slice(-168);
  }
  _save();
}

function saveDailyAggregate(aggregate) {
  const data = _load();
  data.systemMetrics.dailyAggregates.push(aggregate);
  if (data.systemMetrics.dailyAggregates.length > 90) {
    data.systemMetrics.dailyAggregates = data.systemMetrics.dailyAggregates.slice(-90);
  }
  _save();
}

// --- Skill Metrics ---

function updateSkillUsage(skillName) {
  const data = _load();
  if (!data.skillMetrics.usage[skillName]) {
    data.skillMetrics.usage[skillName] = { today: 0, week: 0, total: 0, lastUsedAt: null };
  }
  data.skillMetrics.usage[skillName].today++;
  data.skillMetrics.usage[skillName].week++;
  data.skillMetrics.usage[skillName].total++;
  data.skillMetrics.usage[skillName].lastUsedAt = new Date().toISOString();
  _save();
}

function recordResponseTime(skillName, durationMs) {
  const data = _load();
  if (!data.skillMetrics.responseTimes[skillName]) {
    data.skillMetrics.responseTimes[skillName] = { avg: 0, min: Infinity, max: 0, count: 0, totalMs: 0 };
  }
  const rt = data.skillMetrics.responseTimes[skillName];
  rt.count++;
  rt.totalMs += durationMs;
  rt.avg = Math.round(rt.totalMs / rt.count);
  rt.min = Math.min(rt.min, durationMs);
  rt.max = Math.max(rt.max, durationMs);
  rt.lastResponseMs = durationMs;
  _save();
}

function recordSkillError(skillName, errorMessage) {
  const data = _load();
  if (!data.skillMetrics.errors[skillName]) {
    data.skillMetrics.errors[skillName] = { today: 0, week: 0, total: 0, recentErrors: [], lastErrorAt: null };
  }
  const err = data.skillMetrics.errors[skillName];
  err.today++;
  err.week++;
  err.total++;
  err.lastErrorAt = new Date().toISOString();
  err.recentErrors.push({ message: errorMessage.substring(0, 200), at: new Date().toISOString() });
  if (err.recentErrors.length > 20) {
    err.recentErrors = err.recentErrors.slice(-20);
  }
  _save();
}

function recordCronExecution(skill, cronName, success, durationMs) {
  const data = _load();
  data.skillMetrics.cronExecutions.push({
    skill: skill,
    cron: cronName,
    success: success,
    durationMs: durationMs,
    ranAt: new Date().toISOString()
  });
  if (data.skillMetrics.cronExecutions.length > 200) {
    data.skillMetrics.cronExecutions = data.skillMetrics.cronExecutions.slice(-200);
  }
  _save();
}

function getSkillMetrics() {
  const data = _load();
  return data.skillMetrics;
}

// Reset daily counters (appele par le cron quotidien)
function resetDailyCounters() {
  const data = _load();
  for (const skill of Object.keys(data.skillMetrics.usage)) {
    data.skillMetrics.usage[skill].today = 0;
  }
  for (const skill of Object.keys(data.skillMetrics.errors)) {
    data.skillMetrics.errors[skill].today = 0;
  }
  _save();
}

// Reset weekly counters (appele par le cron hebdo)
function resetWeeklyCounters() {
  const data = _load();
  for (const skill of Object.keys(data.skillMetrics.usage)) {
    data.skillMetrics.usage[skill].week = 0;
  }
  for (const skill of Object.keys(data.skillMetrics.errors)) {
    data.skillMetrics.errors[skill].week = 0;
  }
  _save();
}

// --- Health Checks ---

function saveHealthCheck(result) {
  const data = _load();
  data.healthChecks.lastCheck = result;
  data.healthChecks.history.push(result);
  if (data.healthChecks.history.length > 500) {
    data.healthChecks.history = data.healthChecks.history.slice(-500);
  }
  data.stats.totalHealthChecks++;
  data.stats.lastHealthCheckAt = new Date().toISOString();
  _save();
}

function getLastHealthCheck() {
  return _load().healthChecks.lastCheck;
}

// --- Alerts ---

function addAlert(alert) {
  const data = _load();
  const fullAlert = {
    id: _generateId('alert'),
    type: alert.type || 'info',
    level: alert.level || 'warning',
    message: alert.message || '',
    value: alert.value || null,
    threshold: alert.threshold || null,
    createdAt: new Date().toISOString(),
    resolvedAt: null
  };
  data.activeAlerts.push(fullAlert);
  data.alertHistory.push(fullAlert);
  if (data.alertHistory.length > 500) {
    data.alertHistory = data.alertHistory.slice(-500);
  }
  _save();
  return fullAlert;
}

function resolveAlert(alertId) {
  const data = _load();
  const idx = data.activeAlerts.findIndex(a => a.id === alertId);
  if (idx >= 0) {
    data.activeAlerts[idx].resolvedAt = new Date().toISOString();
    data.activeAlerts.splice(idx, 1);
    _save();
    return true;
  }
  return false;
}

function resolveAlertsByType(type) {
  const data = _load();
  data.activeAlerts = data.activeAlerts.filter(a => a.type !== type);
  _save();
}

function getActiveAlerts() {
  return _load().activeAlerts;
}

function getRecentAlerts(limit) {
  limit = limit || 10;
  return _load().alertHistory.slice(-limit).reverse();
}

function logAlert(type, message, data_extra) {
  const data = _load();
  data.alertHistory.push({
    id: _generateId('log'),
    type: type,
    message: (message || '').substring(0, 500),
    data: data_extra || null,
    sentAt: new Date().toISOString()
  });
  if (data.alertHistory.length > 500) {
    data.alertHistory = data.alertHistory.slice(-500);
  }
  data.stats.totalAlertsSent++;
  _save();
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

module.exports = {
  getConfig, updateConfig, setThreshold,
  saveSnapshot, getRecentSnapshots, saveHourlyAggregate, saveDailyAggregate,
  updateSkillUsage, recordResponseTime, recordSkillError, recordCronExecution,
  getSkillMetrics, resetDailyCounters, resetWeeklyCounters,
  saveHealthCheck, getLastHealthCheck,
  addAlert, resolveAlert, resolveAlertsByType, getActiveAlerts, getRecentAlerts, logAlert,
  getStats, updateStat
};
