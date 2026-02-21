// Proactive Agent - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.PROACTIVE_DATA_DIR || '/data/proactive-agent';
const DB_FILE = path.join(DATA_DIR, 'proactive-agent-db.json');

class ProactiveStorage {
  constructor() {
    this.data = null;
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  }

  _load() {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      this.data = JSON.parse(raw);
      // Migration : ajouter reactiveFollowUps si absent (bases existantes)
      if (!this.data.reactiveFollowUps) {
        this.data.reactiveFollowUps = { pending: [], sent: [], config: { enabled: true, minDelayMinutes: 120, maxDelayMinutes: 240 } };
        this._save();
      }
      console.log('[proactive-storage] Base chargee (' + this.data.alertHistory.length + ' alertes)');
    } catch (e) {
      this.data = this._defaultData();
      this._save();
      console.log('[proactive-storage] Nouvelle base creee');
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[proactive-storage] Erreur sauvegarde:', e.message);
    }
  }

  _defaultData() {
    return {
      config: {
        enabled: true,
        adminChatId: '1409505520',
        alerts: {
          morningReport: { enabled: true, hour: 8, minute: 0 },
          pipelineAlerts: { enabled: true, hour: 9, minute: 0 },
          weeklyReport: { enabled: true, dayOfWeek: 1, hour: 9, minute: 0 },
          monthlyReport: { enabled: true, dayOfMonth: 1, hour: 9, minute: 0 },
          emailStatusCheck: { enabled: true, intervalMinutes: 30 },
          nightlyAnalysis: { enabled: true, hour: 2, minute: 0 }
        },
        thresholds: {
          stagnantDealDays: 7,
          hotLeadOpens: 3,
          dealCloseWarningDays: 3
        }
      },
      alertHistory: [],
      hotLeads: {},
      reactiveFollowUps: {
        pending: [],
        sent: [],
        config: {
          enabled: true,
          minDelayMinutes: 120,
          maxDelayMinutes: 240
        }
      },
      nightlyBriefing: null,
      metrics: {
        dailySnapshots: [],
        weeklySnapshots: [],
        monthlySnapshots: []
      },
      stats: {
        totalReportsSent: 0,
        totalAlertsSent: 0,
        lastMorningReport: null,
        lastWeeklyReport: null,
        lastMonthlyReport: null,
        lastNightlyAnalysis: null,
        lastEmailCheck: null,
        createdAt: new Date().toISOString()
      }
    };
  }

  _generateId() {
    return 'alert_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  // --- Config ---

  getConfig() {
    return this.data.config;
  }

  updateConfig(updates) {
    Object.assign(this.data.config, updates);
    this._save();
  }

  setAlertEnabled(alertName, enabled) {
    if (this.data.config.alerts[alertName]) {
      this.data.config.alerts[alertName].enabled = enabled;
      this._save();
    }
  }

  setThreshold(key, value) {
    if (this.data.config.thresholds.hasOwnProperty(key)) {
      this.data.config.thresholds[key] = value;
      this._save();
    }
  }

  // --- Alert history ---

  logAlert(type, message, data) {
    const alert = {
      id: this._generateId(),
      type: type,
      message: (message || '').substring(0, 500),
      sentAt: new Date().toISOString(),
      data: data || null
    };
    this.data.alertHistory.unshift(alert);
    if (this.data.alertHistory.length > 500) {
      this.data.alertHistory = this.data.alertHistory.slice(0, 500);
    }
    if (type.includes('report')) this.data.stats.totalReportsSent++;
    else this.data.stats.totalAlertsSent++;
    this._save();
    return alert;
  }

  getRecentAlerts(limit) {
    return this.data.alertHistory.slice(0, limit || 10);
  }

  getAlertsByType(type, limit) {
    return this.data.alertHistory
      .filter(a => a.type === type)
      .slice(0, limit || 10);
  }

  // --- Metrics snapshots ---

  saveDailySnapshot(snapshot) {
    snapshot.date = snapshot.date || new Date().toISOString().split('T')[0];
    this.data.metrics.dailySnapshots.unshift(snapshot);
    if (this.data.metrics.dailySnapshots.length > 90) {
      this.data.metrics.dailySnapshots = this.data.metrics.dailySnapshots.slice(0, 90);
    }
    this._save();
  }

  getDailySnapshots(days) {
    return this.data.metrics.dailySnapshots.slice(0, days || 7);
  }

  saveWeeklySnapshot(snapshot) {
    this.data.metrics.weeklySnapshots.unshift(snapshot);
    if (this.data.metrics.weeklySnapshots.length > 52) {
      this.data.metrics.weeklySnapshots = this.data.metrics.weeklySnapshots.slice(0, 52);
    }
    this._save();
  }

  getWeeklySnapshots(weeks) {
    return this.data.metrics.weeklySnapshots.slice(0, weeks || 4);
  }

  saveMonthlySnapshot(snapshot) {
    this.data.metrics.monthlySnapshots.unshift(snapshot);
    if (this.data.metrics.monthlySnapshots.length > 24) {
      this.data.metrics.monthlySnapshots = this.data.metrics.monthlySnapshots.slice(0, 24);
    }
    this._save();
  }

  getMonthlySnapshots(months) {
    return this.data.metrics.monthlySnapshots.slice(0, months || 6);
  }

  // --- Hot leads ---

  trackEmailOpen(email, resendId) {
    if (!this.data.hotLeads[email]) {
      this.data.hotLeads[email] = { opens: 0, lastOpenAt: null, notifiedAt: null, resendIds: [] };
    }
    this.data.hotLeads[email].opens++;
    this.data.hotLeads[email].lastOpenAt = new Date().toISOString();
    if (resendId && !this.data.hotLeads[email].resendIds.includes(resendId)) {
      this.data.hotLeads[email].resendIds.push(resendId);
    }
    this._save();
    return this.data.hotLeads[email];
  }

  getHotLeads(minOpens) {
    const threshold = minOpens || this.data.config.thresholds.hotLeadOpens;
    const hot = {};
    for (const email of Object.keys(this.data.hotLeads)) {
      if (this.data.hotLeads[email].opens >= threshold) {
        hot[email] = this.data.hotLeads[email];
      }
    }
    return hot;
  }

  isHotLeadNotified(email) {
    return this.data.hotLeads[email] && this.data.hotLeads[email].notifiedAt;
  }

  markHotLeadNotified(email) {
    if (this.data.hotLeads[email]) {
      this.data.hotLeads[email].notifiedAt = new Date().toISOString();
      this._save();
    }
  }

  // --- Reactive Follow-Ups ---

  addPendingFollowUp(followUp) {
    if (!this.data.reactiveFollowUps) {
      this.data.reactiveFollowUps = { pending: [], sent: [], config: { enabled: true, minDelayMinutes: 120, maxDelayMinutes: 240 } };
    }
    const email = (followUp.prospectEmail || '').toLowerCase();
    // Deduplication : 1 seul follow-up reactif par prospect
    const exists = this.data.reactiveFollowUps.pending.some(f => f.prospectEmail.toLowerCase() === email)
      || this.data.reactiveFollowUps.sent.some(f => f.prospectEmail.toLowerCase() === email && f.status === 'sent');
    if (exists) return null;

    const entry = {
      id: this._generateId(),
      prospectEmail: followUp.prospectEmail,
      prospectName: followUp.prospectName || '',
      prospectCompany: followUp.prospectCompany || '',
      originalEmailId: followUp.originalEmailId || null,
      originalSubject: followUp.originalSubject || '',
      originalBody: followUp.originalBody || '',
      prospectIntel: followUp.prospectIntel || '',
      scheduledAfter: followUp.scheduledAfter,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    this.data.reactiveFollowUps.pending.push(entry);
    if (this.data.reactiveFollowUps.pending.length > 50) {
      this.data.reactiveFollowUps.pending = this.data.reactiveFollowUps.pending.slice(-50);
    }
    this._save();
    return entry;
  }

  getPendingFollowUps() {
    if (!this.data.reactiveFollowUps) return [];
    return this.data.reactiveFollowUps.pending.filter(f => f.status === 'pending');
  }

  markFollowUpSent(followUpId, result) {
    if (!this.data.reactiveFollowUps) return null;
    const idx = this.data.reactiveFollowUps.pending.findIndex(f => f.id === followUpId);
    if (idx === -1) return null;
    const followUp = this.data.reactiveFollowUps.pending[idx];
    followUp.status = 'sent';
    followUp.sentAt = new Date().toISOString();
    followUp.result = result || {};
    this.data.reactiveFollowUps.sent.unshift(followUp);
    this.data.reactiveFollowUps.pending.splice(idx, 1);
    if (this.data.reactiveFollowUps.sent.length > 200) {
      this.data.reactiveFollowUps.sent = this.data.reactiveFollowUps.sent.slice(0, 200);
    }
    this._save();
    return followUp;
  }

  markFollowUpFailed(followUpId, error) {
    if (!this.data.reactiveFollowUps) return null;
    const idx = this.data.reactiveFollowUps.pending.findIndex(f => f.id === followUpId);
    if (idx === -1) return null;
    const followUp = this.data.reactiveFollowUps.pending[idx];
    followUp.status = 'failed';
    followUp.failedAt = new Date().toISOString();
    followUp.error = error || 'unknown';
    this.data.reactiveFollowUps.sent.unshift(followUp);
    this.data.reactiveFollowUps.pending.splice(idx, 1);
    this._save();
    return followUp;
  }

  hasReactiveFollowUp(prospectEmail) {
    if (!this.data.reactiveFollowUps) return false;
    const email = (prospectEmail || '').toLowerCase();
    return this.data.reactiveFollowUps.pending.some(f => f.prospectEmail.toLowerCase() === email)
      || this.data.reactiveFollowUps.sent.some(f => f.prospectEmail.toLowerCase() === email && f.status === 'sent');
  }

  getReactiveFollowUpConfig() {
    if (!this.data.reactiveFollowUps || !this.data.reactiveFollowUps.config) {
      return { enabled: true, minDelayMinutes: 120, maxDelayMinutes: 240 };
    }
    return this.data.reactiveFollowUps.config;
  }

  updateReactiveFollowUpConfig(updates) {
    if (!this.data.reactiveFollowUps) {
      this.data.reactiveFollowUps = { pending: [], sent: [], config: { enabled: true, minDelayMinutes: 120, maxDelayMinutes: 240 } };
    }
    Object.assign(this.data.reactiveFollowUps.config, updates);
    this._save();
  }

  // --- Nightly briefing ---

  saveNightlyBriefing(text) {
    this.data.nightlyBriefing = {
      text: text,
      generatedAt: new Date().toISOString()
    };
    this.data.stats.lastNightlyAnalysis = new Date().toISOString();
    this._save();
  }

  getNightlyBriefing() {
    return this.data.nightlyBriefing;
  }

  // --- Stats ---

  updateStat(key, value) {
    if (this.data.stats.hasOwnProperty(key)) {
      this.data.stats[key] = value;
      this._save();
    }
  }

  getStats() {
    return this.data.stats;
  }
}

module.exports = new ProactiveStorage();
