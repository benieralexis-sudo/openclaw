// Self-Improve - Backup, application et rollback des recommandations
const storage = require('./storage.js');

// Cross-skill imports
function getLeadEnrichStorage() {
  try { return require('../lead-enrich/storage.js'); }
  catch (e) {
    try { return require('/app/skills/lead-enrich/storage.js'); }
    catch (e2) { return null; }
  }
}

function getAutomailerStorage() {
  try { return require('../automailer/storage.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/storage.js'); }
    catch (e2) { return null; }
  }
}

class Optimizer {
  constructor() {}

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

    try {
      switch (reco.type) {
        case 'scoring_weight':
          return this._applyScoringWeight(reco);

        case 'send_timing':
          return this._applySendTiming(reco);

        case 'email_length':
          return this._applyEmailLength(reco);

        case 'targeting_criteria':
          return this._applyTargetingCriteria(reco);

        case 'industry_focus':
          return this._applyIndustryFocus(reco);

        default:
          return { success: false, error: 'Type de recommandation inconnu: ' + reco.type };
      }
    } catch (error) {
      console.error('[optimizer] Erreur application:', error.message);
      return { success: false, error: error.message };
    }
  }

  _applyScoringWeight(reco) {
    const params = reco.params || {};
    const currentWeights = storage.getScoringWeights() || {};

    const newWeights = { ...currentWeights };
    if (params.seniority) newWeights.seniority = { ...(currentWeights.seniority || {}), ...params.seniority };
    if (params.companySize) newWeights.companySize = { ...(currentWeights.companySize || {}), ...params.companySize };
    if (params.industry) newWeights.industry = { ...(currentWeights.industry || {}), ...params.industry };
    if (params.geo) newWeights.geo = { ...(currentWeights.geo || {}), ...params.geo };

    storage.setScoringWeights(newWeights);
    console.log('[optimizer] Scoring weights mis a jour');
    return { success: true, applied: 'scoring_weight', before: currentWeights, after: newWeights };
  }

  _applySendTiming(reco) {
    const params = reco.params || {};
    const currentPrefs = storage.getEmailPreferences();
    const updates = {};

    if (params.day) updates.preferredSendDay = params.day;
    if (params.hour !== undefined) updates.preferredSendHour = params.hour;

    storage.setEmailPreferences(updates);
    console.log('[optimizer] Timing email mis a jour');
    return { success: true, applied: 'send_timing', before: currentPrefs, after: storage.getEmailPreferences() };
  }

  _applyEmailLength(reco) {
    const params = reco.params || {};
    const currentPrefs = storage.getEmailPreferences();

    if (params.maxLength) {
      storage.setEmailPreferences({ maxLength: params.maxLength });
    }

    console.log('[optimizer] Longueur email mise a jour');
    return { success: true, applied: 'email_length', before: currentPrefs, after: storage.getEmailPreferences() };
  }

  _applyTargetingCriteria(reco) {
    const params = reco.params || {};
    const currentCriteria = storage.getTargetingCriteria();

    if (params.minScore !== undefined) {
      storage.setTargetingCriteria({ minScore: params.minScore });
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
        storage.markRecommendationApplied(id);
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
