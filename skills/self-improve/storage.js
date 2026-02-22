// Self-Improve - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.SELF_IMPROVE_DATA_DIR || '/data/self-improve';
const DB_FILE = path.join(DATA_DIR, 'self-improve-db.json');

class SelfImproveStorage {
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
      console.log('[self-improve-storage] Base chargee (' +
        this.data.analysis.appliedRecommendations.length + ' recos appliquees, ' +
        this.data.metrics.weeklySnapshots.length + ' snapshots)');
    } catch (e) {
      this.data = this._defaultData();
      this._save();
      console.log('[self-improve-storage] Nouvelle base creee');
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[self-improve-storage] Erreur sauvegarde:', e.message);
    }
  }

  _generateId() {
    return 'reco_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  _defaultData() {
    return {
      config: {
        enabled: true,
        adminChatId: '1409505520',
        analysisDay: 'sunday',
        analysisHour: 21,
        autoApply: false,
        scoringWeights: null,
        emailPreferences: {
          maxLength: null,
          preferredSendHour: null,
          preferredSendDay: null
        },
        targetingCriteria: {
          minScore: null
        }
      },
      metrics: {
        weeklySnapshots: [],
        emailDetails: []
      },
      analysis: {
        lastAnalysis: null,
        lastRecommendations: [],
        pendingRecommendations: [],
        appliedRecommendations: []
      },
      feedback: {
        predictions: [],
        accuracyHistory: []
      },
      backups: [],
      stats: {
        totalAnalyses: 0,
        totalRecommendations: 0,
        totalApplied: 0,
        totalRollbacks: 0,
        currentAccuracy: null,
        lastAnalysisAt: null,
        createdAt: new Date().toISOString()
      },
      impactTracking: {
        activeTracking: [],
        completedTracking: []
      },
      typePerformance: {},
      funnel: {
        weeklyFunnelSnapshots: []
      },
      anomalyHistory: [],
      brainInsights: { lastCollectedAt: null, nichePerformance: {}, learnings: {}, weeklyPerformance: [] },
      abTestInsights: { lastCollectedAt: null, campaignResults: [], summary: null },
      temporalPatterns: { lastAnalyzedAt: null, dayHourGrid: {}, bestSlots: [], worstSlots: [], totalAnalyzed: 0 },
      cohortInsights: { lastAnalyzedAt: null, byIndustry: {}, byCompanySize: {}, byRole: {}, topCohorts: [], bottomCohorts: [] }
    };
  }

  // --- Config ---

  getConfig() {
    return this.data.config;
  }

  updateConfig(updates) {
    Object.assign(this.data.config, updates);
    this._save();
  }

  // --- Scoring weights overrides (lu par lead-enrich) ---

  getScoringWeights() {
    return this.data.config.scoringWeights;
  }

  setScoringWeights(weights) {
    this.data.config.scoringWeights = weights;
    this._save();
  }

  // --- Email preferences overrides (lu par automailer) ---

  getEmailPreferences() {
    return this.data.config.emailPreferences;
  }

  setEmailPreferences(prefs) {
    Object.assign(this.data.config.emailPreferences, prefs);
    this._save();
  }

  // --- Targeting criteria ---

  getTargetingCriteria() {
    return this.data.config.targetingCriteria;
  }

  setTargetingCriteria(criteria) {
    Object.assign(this.data.config.targetingCriteria, criteria);
    this._save();
  }

  // --- Metrics ---

  saveWeeklySnapshot(snapshot) {
    snapshot.date = snapshot.date || new Date().toISOString().split('T')[0];
    this.data.metrics.weeklySnapshots.unshift(snapshot);
    if (this.data.metrics.weeklySnapshots.length > 52) {
      this.data.metrics.weeklySnapshots = this.data.metrics.weeklySnapshots.slice(0, 52);
    }
    this._save();
  }

  getWeeklySnapshots(limit) {
    return this.data.metrics.weeklySnapshots.slice(0, limit || 12);
  }

  getLatestSnapshot() {
    return this.data.metrics.weeklySnapshots[0] || null;
  }

  // --- Analysis / Recommendations ---

  saveAnalysis(analysis) {
    this.data.analysis.lastAnalysis = {
      ...analysis,
      analyzedAt: new Date().toISOString()
    };
    this.data.stats.totalAnalyses++;
    this.data.stats.lastAnalysisAt = new Date().toISOString();
    this._save();
  }

  getLastAnalysis() {
    return this.data.analysis.lastAnalysis;
  }

  savePendingRecommendations(recos) {
    this.data.analysis.pendingRecommendations = recos.map(r => ({
      ...r,
      id: r.id || this._generateId(),
      createdAt: new Date().toISOString(),
      status: 'pending'
    }));
    this.data.analysis.lastRecommendations = this.data.analysis.pendingRecommendations;
    this.data.stats.totalRecommendations += recos.length;
    this._save();
  }

  getPendingRecommendations() {
    return this.data.analysis.pendingRecommendations;
  }

  getAppliedRecommendations(limit) {
    return this.data.analysis.appliedRecommendations.slice(0, limit || 20);
  }

  markRecommendationApplied(recoId) {
    const pending = this.data.analysis.pendingRecommendations;
    const idx = pending.findIndex(r => r.id === recoId);
    if (idx === -1) return null;

    const reco = pending.splice(idx, 1)[0];
    reco.status = 'applied';
    reco.appliedAt = new Date().toISOString();
    this.data.analysis.appliedRecommendations.unshift(reco);
    if (this.data.analysis.appliedRecommendations.length > 100) {
      this.data.analysis.appliedRecommendations = this.data.analysis.appliedRecommendations.slice(0, 100);
    }
    this.data.stats.totalApplied++;
    this._save();
    return reco;
  }

  dismissRecommendation(recoId) {
    const pending = this.data.analysis.pendingRecommendations;
    const idx = pending.findIndex(r => r.id === recoId);
    if (idx === -1) return false;
    pending.splice(idx, 1);
    this._save();
    return true;
  }

  // --- Backups ---

  saveBackup(backup) {
    this.data.backups.unshift({
      ...backup,
      id: 'bkp_' + Date.now().toString(36),
      createdAt: new Date().toISOString()
    });
    if (this.data.backups.length > 20) {
      this.data.backups = this.data.backups.slice(0, 20);
    }
    this._save();
  }

  getLatestBackup() {
    return this.data.backups[0] || null;
  }

  removeBackup(backupId) {
    this.data.backups = this.data.backups.filter(b => b.id !== backupId);
    this._save();
  }

  incrementRollbacks() {
    this.data.stats.totalRollbacks++;
    this._save();
  }

  // --- Feedback loop ---

  addPrediction(prediction) {
    this.data.feedback.predictions.push({
      ...prediction,
      createdAt: new Date().toISOString(),
      verified: false,
      correct: null
    });
    if (this.data.feedback.predictions.length > 500) {
      this.data.feedback.predictions = this.data.feedback.predictions.slice(-500);
    }
    this._save();
  }

  getUnverifiedPredictions() {
    return this.data.feedback.predictions.filter(p => !p.verified);
  }

  verifyPrediction(email, wasCorrect) {
    const pred = this.data.feedback.predictions.find(p => p.email === email && !p.verified);
    if (pred) {
      pred.verified = true;
      pred.correct = wasCorrect;
      pred.verifiedAt = new Date().toISOString();
      this._save();
    }
  }

  saveAccuracyRecord(record) {
    this.data.feedback.accuracyHistory.unshift({
      ...record,
      date: new Date().toISOString()
    });
    if (this.data.feedback.accuracyHistory.length > 52) {
      this.data.feedback.accuracyHistory = this.data.feedback.accuracyHistory.slice(0, 52);
    }
    this.data.stats.currentAccuracy = record.accuracy;
    this._save();
  }

  getAccuracyHistory(limit) {
    return this.data.feedback.accuracyHistory.slice(0, limit || 12);
  }

  // --- Stats ---

  getStats() {
    return this.data.stats;
  }

  // --- Impact Tracking ---

  startImpactTracking(recoId, recoType, recoDescription, baselineSnapshot) {
    if (!this.data.impactTracking) this.data.impactTracking = { activeTracking: [], completedTracking: [] };
    const tracking = {
      recoId,
      recoType,
      recoDescription,
      appliedAt: new Date().toISOString(),
      baselineSnapshot,
      measureAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      measured: false,
      impactSnapshot: null,
      delta: null,
      verdict: null
    };
    this.data.impactTracking.activeTracking.push(tracking);
    if (this.data.impactTracking.activeTracking.length > 50) {
      this.data.impactTracking.activeTracking = this.data.impactTracking.activeTracking.slice(-50);
    }
    this._save();
    return tracking;
  }

  getTrackingDueForMeasurement() {
    if (!this.data.impactTracking) return [];
    const now = new Date().toISOString();
    return this.data.impactTracking.activeTracking.filter(t => !t.measured && t.measureAt <= now);
  }

  completeImpactTracking(recoId, impactSnapshot, delta, verdict) {
    if (!this.data.impactTracking) return null;
    const idx = this.data.impactTracking.activeTracking.findIndex(t => t.recoId === recoId);
    if (idx === -1) return null;
    const tracking = this.data.impactTracking.activeTracking.splice(idx, 1)[0];
    tracking.measured = true;
    tracking.impactSnapshot = impactSnapshot;
    tracking.delta = delta;
    tracking.verdict = verdict;
    tracking.measuredAt = new Date().toISOString();
    this.data.impactTracking.completedTracking.unshift(tracking);
    if (this.data.impactTracking.completedTracking.length > 100) {
      this.data.impactTracking.completedTracking = this.data.impactTracking.completedTracking.slice(0, 100);
    }
    this._save();
    return tracking;
  }

  getCompletedImpactTracking(limit) {
    if (!this.data.impactTracking) return [];
    return this.data.impactTracking.completedTracking.slice(0, limit || 20);
  }

  // --- Type Performance ---

  getTypePerformance() {
    if (!this.data.typePerformance) this.data.typePerformance = {};
    return this.data.typePerformance;
  }

  updateTypePerformance(type, verdict) {
    if (!this.data.typePerformance) this.data.typePerformance = {};
    if (!this.data.typePerformance[type]) {
      this.data.typePerformance[type] = { applied: 0, improved: 0, worsened: 0, neutral: 0 };
    }
    const tp = this.data.typePerformance[type];
    tp.applied++;
    if (verdict === 'positive') tp.improved++;
    else if (verdict === 'negative') tp.worsened++;
    else tp.neutral++;
    this._save();
  }

  // --- Funnel ---

  saveFunnelSnapshot(snapshot) {
    if (!this.data.funnel) this.data.funnel = { weeklyFunnelSnapshots: [] };
    this.data.funnel.weeklyFunnelSnapshots.unshift(snapshot);
    if (this.data.funnel.weeklyFunnelSnapshots.length > 52) {
      this.data.funnel.weeklyFunnelSnapshots = this.data.funnel.weeklyFunnelSnapshots.slice(0, 52);
    }
    this._save();
  }

  getFunnelSnapshots(limit) {
    if (!this.data.funnel) return [];
    return this.data.funnel.weeklyFunnelSnapshots.slice(0, limit || 12);
  }

  // --- Anomaly History ---

  addAnomaly(anomaly) {
    if (!this.data.anomalyHistory) this.data.anomalyHistory = [];
    this.data.anomalyHistory.unshift({
      ...anomaly,
      detectedAt: new Date().toISOString(),
      resolved: false
    });
    if (this.data.anomalyHistory.length > 200) {
      this.data.anomalyHistory = this.data.anomalyHistory.slice(0, 200);
    }
    this._save();
  }

  getRecentAnomalies(limit) {
    if (!this.data.anomalyHistory) return [];
    return this.data.anomalyHistory.slice(0, limit || 20);
  }

  // --- Brain Insights ---

  saveBrainInsights(insights) {
    this.data.brainInsights = { ...insights, lastCollectedAt: new Date().toISOString() };
    this._save();
  }

  getBrainInsights() {
    return this.data.brainInsights || { lastCollectedAt: null, nichePerformance: {}, learnings: {}, weeklyPerformance: [] };
  }

  // --- A/B Test Insights ---

  saveABTestInsights(insights) {
    this.data.abTestInsights = { ...insights, lastCollectedAt: new Date().toISOString() };
    this._save();
  }

  getABTestInsights() {
    return this.data.abTestInsights || { lastCollectedAt: null, campaignResults: [], summary: null };
  }
  // --- Temporal Patterns ---

  saveTemporalPatterns(patterns) {
    this.data.temporalPatterns = { ...patterns, lastAnalyzedAt: new Date().toISOString() };
    this._save();
  }

  getTemporalPatterns() {
    return this.data.temporalPatterns || { lastAnalyzedAt: null, dayHourGrid: {}, bestSlots: [], worstSlots: [], totalAnalyzed: 0 };
  }

  // --- Cohort Insights ---

  saveCohortInsights(insights) {
    this.data.cohortInsights = { ...insights, lastAnalyzedAt: new Date().toISOString() };
    this._save();
  }

  getCohortInsights() {
    return this.data.cohortInsights || { lastAnalyzedAt: null, byIndustry: {}, byCompanySize: {}, byRole: {}, topCohorts: [], bottomCohorts: [] };
  }
}

module.exports = new SelfImproveStorage();
