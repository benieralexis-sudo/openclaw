// Tests — Self-Improve Storage v4 (node:test)
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isoler le storage en /tmp
const tmpDir = path.join(os.tmpdir(), 'ifind-test-si-' + Date.now());
process.env.SELF_IMPROVE_DATA_DIR = tmpDir;

// Supprimer le cache require pour forcer une nouvelle instance
delete require.cache[require.resolve('./storage.js')];
const storage = require('./storage.js');

describe('Self-Improve Storage v4', () => {

  describe('Schema Versioning & Migration', () => {
    it('nouvelle base a la version 2', () => {
      assert.equal(storage.data.version, 2);
    });

    it('toutes les structures critiques existent', () => {
      assert.ok(storage.data.config);
      assert.ok(storage.data.metrics);
      assert.ok(storage.data.analysis);
      assert.ok(storage.data.feedback);
      assert.ok(storage.data.stats);
      assert.ok(storage.data.impactTracking);
      assert.ok(storage.data.funnel);
      assert.ok(storage.data.brainInsights);
      assert.ok(storage.data.abTestInsights);
      assert.ok(storage.data.temporalPatterns);
      assert.ok(storage.data.cohortInsights);
      assert.ok(Array.isArray(storage.data.anomalyHistory));
    });

    it('migration depuis ancienne version sans champs', () => {
      // Simuler une ancienne base sans version ni certains champs
      const dbFile = path.join(tmpDir, 'self-improve-db.json');
      fs.writeFileSync(dbFile, JSON.stringify({
        config: { enabled: true, adminChatId: '123' },
        metrics: { weeklySnapshots: [], emailDetails: [] },
        analysis: { lastAnalysis: null, lastRecommendations: [] },
        feedback: { predictions: [], accuracyHistory: [] },
        backups: [],
        stats: { totalAnalyses: 5 }
      }));
      // Recharger
      storage._load();
      assert.equal(storage.data.version, 2);
      assert.ok(storage.data.impactTracking);
      assert.ok(storage.data.config.emailPreferences);
      assert.ok(storage.data.config.targetingCriteria);
      assert.ok(Array.isArray(storage.data.analysis.pendingRecommendations));
      assert.equal(storage.data.stats.totalAnalyses, 5); // Preserve existing data
    });
  });

  describe('Deep Merge updateConfig', () => {
    it('preserve les sous-objets existants', () => {
      storage.data.config.emailPreferences = { maxLength: 'short', preferredSendHour: 10 };
      storage.updateConfig({ emailPreferences: { maxLength: 'long' } });
      assert.equal(storage.data.config.emailPreferences.maxLength, 'long');
      assert.equal(storage.data.config.emailPreferences.preferredSendHour, 10); // Preserve !
    });

    it('ecrase les valeurs scalaires', () => {
      storage.updateConfig({ enabled: false });
      assert.equal(storage.data.config.enabled, false);
    });
  });

  describe('Save Retry Logic', () => {
    it('_save ne crash pas (3 tentatives)', () => {
      // Juste verifier que ca ne throw pas
      storage._save();
      assert.ok(true);
    });
  });

  describe('Z-Test Precision', () => {
    it('p-value precise pour z=1.96 → ~0.05', () => {
      // Importer l'analyzer pour tester _normalCDF
      delete require.cache[require.resolve('./analyzer.js')];
      const Analyzer = require('./analyzer.js');
      const analyzer = new Analyzer('fake-key');
      const result = analyzer._zTestProportions(50, 100, 40, 100);
      assert.ok(result.zScore !== 0);
      // Pour 50/100 vs 40/100, z ≈ 1.43, p ≈ 0.15 (pas significatif)
      assert.equal(result.significant, false);
      assert.ok(result.pValue > 0.10);
    });

    it('detecte un ecart significatif 70/100 vs 40/100', () => {
      delete require.cache[require.resolve('./analyzer.js')];
      const Analyzer = require('./analyzer.js');
      const analyzer = new Analyzer('fake-key');
      const result = analyzer._zTestProportions(40, 100, 70, 100);
      assert.equal(result.significant, true);
      assert.ok(result.pValue < 0.05);
    });

    it('_normalCDF(0) = 0.5', () => {
      delete require.cache[require.resolve('./analyzer.js')];
      const Analyzer = require('./analyzer.js');
      const analyzer = new Analyzer('fake-key');
      const cdf = analyzer._normalCDF(0);
      assert.ok(Math.abs(cdf - 0.5) < 0.001);
    });
  });

  describe('Impact Tracking', () => {
    it('startImpactTracking cree un tracking actif', () => {
      const t = storage.startImpactTracking('reco_1', 'send_timing', 'Envoyer a 9h', { openRate: 25, replyRate: 2 });
      assert.equal(t.recoId, 'reco_1');
      assert.equal(t.recoType, 'send_timing');
      assert.equal(t.measured, false);
      assert.ok(t.measureAt);
      assert.ok(t.appliedAt);
    });

    it('getTrackingDueForMeasurement retourne les tracking expires', () => {
      // Forcer un tracking deja du
      storage.data.impactTracking.activeTracking[0].measureAt = new Date(Date.now() - 1000).toISOString();
      const due = storage.getTrackingDueForMeasurement();
      assert.equal(due.length, 1);
      assert.equal(due[0].recoId, 'reco_1');
    });

    it('completeImpactTracking deplace active → completed', () => {
      const result = storage.completeImpactTracking('reco_1', { openRate: 30 }, { openRate: 5 }, 'positive');
      assert.ok(result);
      assert.equal(result.verdict, 'positive');
      assert.equal(storage.data.impactTracking.activeTracking.length, 0);
      assert.equal(storage.data.impactTracking.completedTracking.length, 1);
    });

    it('getCompletedImpactTracking retourne les completions', () => {
      const completed = storage.getCompletedImpactTracking(5);
      assert.equal(completed.length, 1);
      assert.equal(completed[0].verdict, 'positive');
    });

    it('completeImpactTracking retourne null si non trouve', () => {
      const result = storage.completeImpactTracking('inexistant', {}, {}, 'neutral');
      assert.equal(result, null);
    });
  });

  describe('Type Performance', () => {
    it('updateTypePerformance cree et incremente', () => {
      storage.updateTypePerformance('send_timing', 'positive');
      storage.updateTypePerformance('send_timing', 'negative');
      storage.updateTypePerformance('send_timing', 'neutral');
      const tp = storage.getTypePerformance();
      assert.equal(tp.send_timing.applied, 3);
      assert.equal(tp.send_timing.improved, 1);
      assert.equal(tp.send_timing.worsened, 1);
      assert.equal(tp.send_timing.neutral, 1);
    });

    it('getTypePerformance retourne objet vide si pas de donnees', () => {
      storage.data.typePerformance = {};
      const tp = storage.getTypePerformance();
      assert.deepEqual(tp, {});
    });
  });

  describe('Funnel', () => {
    it('saveFunnelSnapshot + getFunnelSnapshots', () => {
      storage.saveFunnelSnapshot({ date: '2026-02-22', leadsFound: 20, emailsSent: 10, emailsReplied: 1 });
      storage.saveFunnelSnapshot({ date: '2026-02-23', leadsFound: 25, emailsSent: 12, emailsReplied: 2 });
      const snaps = storage.getFunnelSnapshots(2);
      assert.equal(snaps.length, 2);
      assert.equal(snaps[0].leadsFound, 25); // plus recent en premier
      assert.equal(snaps[1].leadsFound, 20);
    });

    it('getFunnelSnapshots respecte la limite', () => {
      const snaps = storage.getFunnelSnapshots(1);
      assert.equal(snaps.length, 1);
    });

    it('getFunnelSnapshots retourne vide si pas de donnees', () => {
      storage.data.funnel = null;
      const snaps = storage.getFunnelSnapshots(5);
      assert.deepEqual(snaps, []);
    });
  });

  describe('Anomalies', () => {
    it('addAnomaly + getRecentAnomalies', () => {
      storage.addAnomaly({ type: 'bounce_spike', severity: 'high', message: 'Bounce 15%' });
      storage.addAnomaly({ type: 'no_activity', severity: 'low', message: 'Pas d envoi' });
      const anomalies = storage.getRecentAnomalies(5);
      assert.equal(anomalies.length, 2);
      assert.equal(anomalies[0].type, 'no_activity'); // plus recent en premier
      assert.ok(anomalies[0].detectedAt);
      assert.equal(anomalies[0].resolved, false);
    });

    it('getRecentAnomalies retourne vide si pas de donnees', () => {
      storage.data.anomalyHistory = null;
      const anomalies = storage.getRecentAnomalies(5);
      assert.deepEqual(anomalies, []);
    });
  });

  describe('Brain Insights', () => {
    it('saveBrainInsights + getBrainInsights', () => {
      storage.saveBrainInsights({ nichePerformance: { tech: { sent: 10, opened: 3 } }, bestNiche: { name: 'tech' } });
      const insights = storage.getBrainInsights();
      assert.ok(insights.lastCollectedAt);
      assert.equal(insights.bestNiche.name, 'tech');
    });

    it('getBrainInsights retourne defaut si pas de donnees', () => {
      storage.data.brainInsights = null;
      const insights = storage.getBrainInsights();
      assert.equal(insights.lastCollectedAt, null);
    });
  });

  describe('AB Test Insights', () => {
    it('saveABTestInsights + getABTestInsights', () => {
      storage.saveABTestInsights({ campaignResults: [{ campaignId: 'c1', winner: 'B' }], summary: { aWins: 1, bWins: 2 } });
      const insights = storage.getABTestInsights();
      assert.ok(insights.lastCollectedAt);
      assert.equal(insights.campaignResults.length, 1);
      assert.equal(insights.summary.bWins, 2);
    });

    it('getABTestInsights retourne defaut si pas de donnees', () => {
      storage.data.abTestInsights = null;
      const insights = storage.getABTestInsights();
      assert.equal(insights.lastCollectedAt, null);
    });
  });

  describe('Temporal Patterns', () => {
    it('saveTemporalPatterns + getTemporalPatterns', () => {
      storage.saveTemporalPatterns({
        dayHourGrid: { '1_9': { day: 1, hour: 9, sent: 10, opened: 5 } },
        bestSlots: [{ dayName: 'Lundi', hour: 9, openRate: 50, sent: 10 }],
        worstSlots: [{ dayName: 'Vendredi', hour: 16, openRate: 10, sent: 8 }],
        totalAnalyzed: 50
      });
      const patterns = storage.getTemporalPatterns();
      assert.ok(patterns.lastAnalyzedAt);
      assert.equal(patterns.bestSlots[0].dayName, 'Lundi');
      assert.equal(patterns.totalAnalyzed, 50);
    });

    it('getTemporalPatterns retourne defaut si pas de donnees', () => {
      storage.data.temporalPatterns = null;
      const patterns = storage.getTemporalPatterns();
      assert.equal(patterns.lastAnalyzedAt, null);
    });
  });

  describe('Cohort Insights', () => {
    it('saveCohortInsights + getCohortInsights', () => {
      storage.saveCohortInsights({
        byIndustry: { tech: { sent: 20, opened: 10, replied: 2, openRate: 50, replyRate: 10 } },
        byCompanySize: {},
        byRole: {},
        topCohorts: [{ segment: 'industry', name: 'tech', openRate: 50, replyRate: 10, sent: 20 }],
        bottomCohorts: []
      });
      const insights = storage.getCohortInsights();
      assert.ok(insights.lastAnalyzedAt);
      assert.equal(insights.topCohorts[0].name, 'tech');
      assert.equal(insights.byIndustry.tech.openRate, 50);
    });

    it('getCohortInsights retourne defaut si pas de donnees', () => {
      storage.data.cohortInsights = null;
      const insights = storage.getCohortInsights();
      assert.equal(insights.lastAnalyzedAt, null);
    });
  });
});
