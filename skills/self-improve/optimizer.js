// Self-Improve - Backup, application et rollback des recommandations
const storage = require('./storage.js');

// Cross-skill imports via skill-loader centralise
const { getStorage } = require('../../gateway/skill-loader.js');
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getAutomailerStorage() { return getStorage('automailer'); }

class Optimizer {
  constructor() {}

  // Capturer un baseline des metriques actuelles (pour mesure d'impact)
  _captureBaseline() {
    const automailer = getAutomailerStorage();
    const baseline = {
      openRate: 0, bounceRate: 0, replyRate: 0, avgScore: 0,
      totalSent: 0, totalOpened: 0, totalReplied: 0,
      capturedAt: new Date().toISOString()
    };

    if (automailer && automailer.data) {
      const emails = automailer.data.emails || [];
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recent = emails.filter(e => {
        const ts = e.sentAt ? new Date(e.sentAt).getTime() : 0;
        return ts >= oneWeekAgo;
      });
      baseline.totalSent = recent.filter(e => e.status !== 'queued').length;
      baseline.totalOpened = recent.filter(e => e.openedAt).length;
      baseline.totalReplied = recent.filter(e => e.hasReplied || e.status === 'replied').length;
      const totalBounced = recent.filter(e => e.status === 'bounced').length;
      if (baseline.totalSent > 0) {
        baseline.openRate = Math.round((baseline.totalOpened / baseline.totalSent) * 100);
        baseline.bounceRate = Math.round((totalBounced / baseline.totalSent) * 100);
        baseline.replyRate = Math.round((baseline.totalReplied / baseline.totalSent) * 100);
      }
    }

    const leadStorage = getLeadEnrichStorage();
    if (leadStorage && leadStorage.data) {
      const leads = Object.values(leadStorage.data.enrichedContacts || leadStorage.data.enrichedLeads || {});
      const scores = leads.map(l => (l.aiClassification && l.aiClassification.score) || 0).filter(s => s > 0);
      if (scores.length > 0) {
        baseline.avgScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
      }
    }

    return baseline;
  }

  // Creer un backup des configs actuelles avant modification
  createBackup() {
    const currentConfig = {
      scoringWeights: storage.getScoringWeights(),
      emailPreferences: storage.getEmailPreferences(),
      targetingCriteria: storage.getTargetingCriteria()
    };

    storage.saveBackup({
      type: 'pre_apply',
      config: currentConfig
    });

    console.log('[optimizer] Backup cree');
    return currentConfig;
  }

  // Appliquer une recommandation validee
  applyRecommendation(reco) {
    if (!reco || !reco.type) return { success: false, error: 'Recommandation invalide' };
    console.log('[optimizer] Applying reco type=' + reco.type + ' id=' + (reco.id || '?'));

    // Capturer baseline pour mesure d'impact
    const baselineSnapshot = this._captureBaseline();

    try {
      let result;
      switch (reco.type) {
        case 'scoring_weight':
          result = this._applyScoringWeight(reco); break;
        case 'send_timing':
          result = this._applySendTiming(reco); break;
        case 'email_length':
          result = this._applyEmailLength(reco); break;
        case 'targeting_criteria':
          result = this._applyTargetingCriteria(reco); break;
        case 'industry_focus':
          result = this._applyIndustryFocus(reco); break;
        case 'subject_style':
          result = this._applySubjectStyle(reco); break;
        case 'follow_up_cadence':
          result = this._applyFollowUpCadence(reco); break;
        case 'niche_targeting':
          result = this._applyNicheTargeting(reco); break;
        case 'prospect_priority':
          result = this._applyProspectPriority(reco); break;
        default:
          return { success: false, error: 'Type de recommandation inconnu: ' + reco.type };
      }

      // Demarrer le suivi d'impact si application reussie
      if (result && result.success) {
        console.log('[optimizer] Reco appliquee OK: type=' + reco.type);
        try {
          storage.startImpactTracking(reco.id, reco.type, reco.description || reco.type, baselineSnapshot);
        } catch (e) { console.error('[optimizer] Erreur demarrage impact tracking:', e.message); }
      } else {
        console.log('[optimizer] Reco ECHEC: type=' + reco.type + ' reason=' + (result && result.reason || result && result.error || 'unknown'));
      }

      return result;
    } catch (error) {
      console.error('[optimizer] Erreur application:', error.message);
      return { success: false, error: error.message };
    }
  }

  _applyScoringWeight(reco) {
    const params = reco.params || {};
    const currentWeights = storage.getScoringWeights() || {};

    // Clamp toutes les valeurs entre 0 et 2.0 pour eviter des poids aberrants
    const clampWeights = (obj) => {
      if (!obj || typeof obj !== 'object') return {};
      const clamped = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number') clamped[k] = Math.max(0, Math.min(2.0, v));
        else if (typeof v === 'object') clamped[k] = clampWeights(v);
        else clamped[k] = v;
      }
      return clamped;
    };
    const newWeights = { ...currentWeights };
    if (params.seniority) newWeights.seniority = clampWeights({ ...(currentWeights.seniority || {}), ...params.seniority });
    if (params.companySize) newWeights.companySize = clampWeights({ ...(currentWeights.companySize || {}), ...params.companySize });
    if (params.industry) newWeights.industry = clampWeights({ ...(currentWeights.industry || {}), ...params.industry });
    if (params.geo) newWeights.geo = clampWeights({ ...(currentWeights.geo || {}), ...params.geo });

    storage.setScoringWeights(newWeights);
    console.log('[optimizer] Scoring weights mis a jour');
    return { success: true, applied: 'scoring_weight', before: currentWeights, after: newWeights };
  }

  _applySendTiming(reco) {
    const params = reco.params || {};
    const currentPrefs = storage.getEmailPreferences();
    const updates = {};

    if (params.day) updates.preferredSendDay = params.day;
    if (params.hour !== undefined) {
      // Validation: heures business seulement (7h-20h)
      const hour = parseInt(params.hour, 10);
      if (isNaN(hour) || hour < 7 || hour > 20) {
        console.log('[optimizer] REJET send_timing: hour=' + params.hour + ' hors plage 7-20h');
        return { success: false, applied: 'send_timing', reason: 'hour ' + params.hour + ' hors plage 7-20h' };
      }
      updates.preferredSendHour = hour;
    }

    storage.setEmailPreferences(updates);
    console.log('[optimizer] Timing email mis a jour');
    return { success: true, applied: 'send_timing', before: currentPrefs, after: storage.getEmailPreferences() };
  }

  _applyEmailLength(reco) {
    const params = reco.params || {};
    const currentPrefs = storage.getEmailPreferences();
    const VALID_LENGTHS = ['short', 'medium', 'long'];

    if (params.maxLength) {
      if (!VALID_LENGTHS.includes(params.maxLength)) {
        console.log('[optimizer] REJET email_length: maxLength=' + params.maxLength + ' invalide (attendu: ' + VALID_LENGTHS.join('/') + ')');
        return { success: false, applied: 'email_length', reason: 'maxLength invalide: ' + params.maxLength };
      }
      storage.setEmailPreferences({ maxLength: params.maxLength });
    }

    console.log('[optimizer] Longueur email mise a jour');
    return { success: true, applied: 'email_length', before: currentPrefs, after: storage.getEmailPreferences() };
  }

  _applyTargetingCriteria(reco) {
    const params = reco.params || {};
    const currentCriteria = storage.getTargetingCriteria();

    if (params.minScore !== undefined) {
      // Validation: scoring est sur 0-10
      const score = parseFloat(params.minScore);
      if (isNaN(score) || score < 0 || score > 10) {
        console.log('[optimizer] REJET targeting_criteria: minScore=' + params.minScore + ' hors echelle 0-10');
        return { success: false, applied: 'targeting_criteria', reason: 'minScore ' + params.minScore + ' hors echelle 0-10' };
      }
      storage.setTargetingCriteria({ minScore: score });
    }

    console.log('[optimizer] Criteres de ciblage mis a jour');
    return { success: true, applied: 'targeting_criteria', before: currentCriteria, after: storage.getTargetingCriteria() };
  }

  _applyIndustryFocus(reco) {
    const params = reco.params || {};
    const currentWeights = storage.getScoringWeights() || {};

    if (params.includeIndustries && Array.isArray(params.includeIndustries)) {
      const industryWeights = {};
      for (const ind of params.includeIndustries) {
        industryWeights[ind.toLowerCase().replace(/[^a-z]/g, '_')] = 1.5;
      }
      const newWeights = {
        ...currentWeights,
        industry: { ...(currentWeights.industry || {}), ...industryWeights }
      };
      storage.setScoringWeights(newWeights);
    }

    console.log('[optimizer] Focus industrie mis a jour');
    return { success: true, applied: 'industry_focus', before: currentWeights, after: storage.getScoringWeights() };
  }

  _applySubjectStyle(reco) {
    const params = reco.params || {};
    const currentPrefs = storage.getEmailPreferences();
    const updates = {};
    if (params.subjectStyle) updates.subjectStyle = params.subjectStyle;
    if (params.preferredSubjectLength) updates.preferredSubjectLength = params.preferredSubjectLength;
    storage.setEmailPreferences(updates);
    console.log('[optimizer] Style sujet mis a jour');
    return { success: true, applied: 'subject_style', before: currentPrefs, after: storage.getEmailPreferences() };
  }

  _applyFollowUpCadence(reco) {
    const params = reco.params || {};
    const currentPrefs = storage.getEmailPreferences();
    const updates = {};
    if (params.maxSteps) updates.recommendedMaxSteps = params.maxSteps;
    if (params.stepDays) updates.recommendedStepDays = params.stepDays;
    storage.setEmailPreferences(updates);
    console.log('[optimizer] Cadence follow-up mise a jour');
    return { success: true, applied: 'follow_up_cadence', before: currentPrefs, after: storage.getEmailPreferences() };
  }

  _applyNicheTargeting(reco) {
    const params = reco.params || {};
    const currentCriteria = storage.getTargetingCriteria();
    const updates = {};
    if (params.focusNiches) updates.focusNiches = params.focusNiches;
    if (params.excludeNiches) updates.excludeNiches = params.excludeNiches;
    storage.setTargetingCriteria(updates);
    console.log('[optimizer] Niche targeting mis a jour');
    return { success: true, applied: 'niche_targeting', before: currentCriteria, after: storage.getTargetingCriteria() };
  }

  _applyProspectPriority(reco) {
    const params = reco.params || {};
    const currentCriteria = storage.getTargetingCriteria();
    const updates = {};
    if (params.preferredTitles) updates.preferredTitles = params.preferredTitles;
    if (params.preferredCompanySize) updates.preferredCompanySize = params.preferredCompanySize;
    if (params.minScore !== undefined) updates.minScore = params.minScore;
    storage.setTargetingCriteria(updates);
    console.log('[optimizer] Priorite prospect mise a jour');
    return { success: true, applied: 'prospect_priority', before: currentCriteria, after: storage.getTargetingCriteria() };
  }

  // Appliquer plusieurs recommandations d'un coup
  applyMultiple(recoIds) {
    const pending = storage.getPendingRecommendations();
    const results = [];

    // Backup avant toute modification
    this.createBackup();

    for (const id of recoIds) {
      const reco = pending.find(r => r.id === id);
      if (!reco) {
        results.push({ id: id, success: false, error: 'Non trouvee' });
        continue;
      }

      const result = this.applyRecommendation(reco);
      if (result.success) {
        storage.markRecommendationApplied(id, { before: result.before, after: result.after });
      }
      results.push({ id: id, ...result });
    }

    return results;
  }

  // Appliquer toutes les recommandations en attente
  applyAll() {
    const pending = storage.getPendingRecommendations();
    if (pending.length === 0) return { applied: 0, results: [] };

    const ids = pending.map(r => r.id);
    const results = this.applyMultiple(ids);

    return {
      applied: results.filter(r => r.success).length,
      total: pending.length,
      results: results
    };
  }

  // Rollback : restaurer le dernier backup
  rollbackLast() {
    const backup = storage.getLatestBackup();
    if (!backup) return { success: false, error: 'Aucun backup disponible' };

    try {
      const config = backup.config || {};

      // Restaurer les overrides
      if (config.scoringWeights !== undefined) {
        storage.setScoringWeights(config.scoringWeights);
      }
      if (config.emailPreferences) {
        storage.updateConfig({ emailPreferences: config.emailPreferences });
      }
      if (config.targetingCriteria) {
        storage.updateConfig({ targetingCriteria: config.targetingCriteria });
      }

      storage.incrementRollbacks();
      storage.removeBackup(backup.id);

      console.log('[optimizer] Rollback effectue (backup ' + backup.id + ')');
      return { success: true, restoredFrom: backup.createdAt };
    } catch (error) {
      console.error('[optimizer] Erreur rollback:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Historique des modifications
  getModificationHistory(limit) {
    const applied = storage.getAppliedRecommendations(limit || 10);
    return applied.map(r => ({
      id: r.id,
      type: r.type,
      description: r.description,
      appliedAt: r.appliedAt,
      expectedImpact: r.expectedImpact
    }));
  }
}

module.exports = Optimizer;
