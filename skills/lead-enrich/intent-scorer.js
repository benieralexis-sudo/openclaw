// Intent Scorer — Calcule un score d'intent unifie (0-10) a partir des signaux collectes
// par ProspectResearcher (job postings, news, person profile, market signals, etc.)
// Cout : 0$ — pure logique, pas d'appel API
'use strict';

const log = require('../../gateway/logger.js');

// Poids par type de signal (calibres sur data B2B cold email)
const SIGNAL_WEIGHTS = {
  // Hiring = le plus fort signal d'achat
  scaling_sales: 3.0,        // Recrute commerciaux → veut grandir revenue
  hiring_activity: 2.0,      // Recrutement detecte (generique)
  active_hiring: 1.5,        // Beaucoup de postes ouverts (non categorises)
  building_product: 1.0,     // Recrute tech → build, moins direct pour nous

  // Business events = fort signal
  recent_funding: 2.5,       // Levee de fonds → cash dispo
  acquisition: 2.0,          // Acquisition → expansion
  geo_expansion: 2.0,        // Ouvre un nouveau bureau
  headcount_growth: 1.5,     // Effectif en croissance (Apollo vs Pappers)
  new_product: 1.5,          // Lance un nouveau produit/offre
  partnership: 1.0,          // Nouveau partenariat

  // Person signals = moyen
  leadership_change: 1.5,    // Nouveau dirigeant → veut prouver, budget frais
  thought_leader: 1.0,       // Personne active (conferences, publications)
  content_creator: 0.5,      // Publie du contenu (LinkedIn, blog)

  // Market signals (Web Intelligence)
  market_funding: 2.0,
  market_expansion: 1.5,
  market_hiring: 1.5,
  market_acquisition: 2.0,
  market_product_launch: 1.0,
  market_leadership_change: 1.0,

  // Clay signals (v9.0)
  tech_stack_clay: 0.5
};

// Decay temporel : les signaux recents valent plus
function getDecayMultiplier(detectedAt) {
  if (!detectedAt) return 0.7; // pas de date = on assume moyen
  const ageMs = Date.now() - new Date(detectedAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return 1.0;     // < 1 semaine = pleine valeur
  if (ageDays <= 30) return 0.7;    // < 1 mois = 70%
  if (ageDays <= 90) return 0.4;    // < 3 mois = 40%
  return 0.2;                        // > 3 mois = 20% (ancien mais non-zero)
}

/**
 * Calcule le score d'intent unifie a partir des signaux ProspectResearcher.
 * @param {Object} intel — l'objet intel retourne par researchProspect()
 * @returns {Object} { score: 0-10, signals: [...], topSignal: string|null, summary: string }
 */
function calculateIntentScore(intel) {
  if (!intel) return { score: 0, signals: [], topSignal: null, summary: 'aucune donnee' };

  const scoredSignals = [];
  let rawScore = 0;

  // 1. Intent signals deja collectes par ProspectResearcher
  if (intel.intentSignals && intel.intentSignals.length > 0) {
    for (const sig of intel.intentSignals) {
      const weight = SIGNAL_WEIGHTS[sig.type] || 0.5;
      const decay = getDecayMultiplier(sig.detectedAt || intel.researchedAt);
      const contribution = weight * decay;
      rawScore += contribution;
      scoredSignals.push({
        type: sig.type,
        detail: sig.detail,
        weight: weight,
        decay: decay,
        contribution: Math.round(contribution * 100) / 100
      });
    }
  }

  // 2. Job postings (si pas deja dans intentSignals)
  if (intel.jobPostings && !scoredSignals.some(s => s.type === 'scaling_sales' || s.type === 'active_hiring')) {
    const jp = intel.jobPostings;
    if (jp.totalJobs >= 1) {
      let type = 'active_hiring';
      if (jp.categories && jp.categories.sales > 0) type = 'scaling_sales';
      const weight = SIGNAL_WEIGHTS[type] || 1.0;
      // Plus de postes = signal plus fort (cap a x1.5)
      const volumeMultiplier = Math.min(1.5, 1 + (jp.totalJobs - 1) * 0.1);
      const contribution = weight * volumeMultiplier;
      rawScore += contribution;
      scoredSignals.push({
        type: type,
        detail: jp.totalJobs + ' postes ouverts' + (jp.categories.sales > 0 ? ' (dont ' + jp.categories.sales + ' commerciaux)' : ''),
        weight: weight,
        decay: 1.0,
        contribution: Math.round(contribution * 100) / 100
      });
    }
  }

  // 3. Market signals (Web Intelligence)
  if (intel.marketSignals && intel.marketSignals.length > 0) {
    for (const ms of intel.marketSignals) {
      const msType = 'market_' + (ms.type || 'unknown');
      const weight = SIGNAL_WEIGHTS[msType] || 0.5;
      const decay = getDecayMultiplier(ms.detectedAt);
      const contribution = weight * decay;
      rawScore += contribution;
      scoredSignals.push({
        type: msType,
        detail: (ms.article && ms.article.title || '').substring(0, 80),
        weight: weight,
        decay: decay,
        contribution: Math.round(contribution * 100) / 100
      });
    }
  }

  // 4. Apollo org data bonus (employee growth, recent funding)
  if (intel.apolloData) {
    const org = intel.apolloData;
    // Recent funding from Apollo
    if (org.lastFundingDate && !scoredSignals.some(s => s.type === 'recent_funding')) {
      const fundingAge = Date.now() - new Date(org.lastFundingDate).getTime();
      if (fundingAge < 180 * 24 * 60 * 60 * 1000) { // < 6 mois
        const decay = getDecayMultiplier(org.lastFundingDate);
        const contribution = SIGNAL_WEIGHTS.recent_funding * decay;
        rawScore += contribution;
        scoredSignals.push({
          type: 'recent_funding',
          detail: 'Levee de fonds (Apollo)',
          weight: SIGNAL_WEIGHTS.recent_funding,
          decay: decay,
          contribution: Math.round(contribution * 100) / 100
        });
      }
    }
  }

  // 5. Clay signals (v9.0) — headcount growth et funding depuis Clay
  if (intel.clayData) {
    const enr = intel.clayData.enrichment || {};

    // Headcount growth from Clay
    const hcGrowth = intel.clayData.headcountGrowth || enr.headcountGrowth || enr.headcount_growth || null;
    if (hcGrowth && typeof hcGrowth === 'number' && hcGrowth > 10 && !scoredSignals.some(s => s.type === 'headcount_growth')) {
      const weight = SIGNAL_WEIGHTS.headcount_growth || 1.5;
      const contribution = weight;
      rawScore += contribution;
      scoredSignals.push({
        type: 'headcount_growth',
        detail: '+' + hcGrowth + '% croissance effectif (Clay)',
        weight: weight,
        decay: 1.0,
        contribution: Math.round(contribution * 100) / 100
      });
    }

    // Funding from Clay
    const funding = intel.clayData.funding || enr.funding || null;
    if (funding && !scoredSignals.some(s => s.type === 'recent_funding')) {
      const weight = SIGNAL_WEIGHTS.recent_funding || 2.5;
      const fundingDetail = typeof funding === 'object' ? ('Levee ' + (funding.type || '') + ' ' + (funding.amount || '')).trim() : String(funding);
      const contribution = weight;
      rawScore += contribution;
      scoredSignals.push({
        type: 'recent_funding',
        detail: 'Funding Clay: ' + fundingDetail,
        weight: weight,
        decay: 1.0,
        contribution: Math.round(contribution * 100) / 100
      });
    }
  }

  // Signal Stacking : multiplicateur quand 3+ signaux DISTINCTS convergent
  // Un lead avec 3+ signaux est exponentiellement plus qualifie qu'un lead avec 1 signal fort
  // Ex: recrute + funding + headcount growth = lead chaud ×1.5
  const uniqueSignalTypes = new Set(scoredSignals.map(s => s.type.replace(/^market_/, '')));
  const signalCount = uniqueSignalTypes.size;
  const stackingMultiplier = signalCount >= 4 ? 1.8 : signalCount >= 3 ? 1.5 : 1.0;
  if (stackingMultiplier > 1.0) {
    log.info('intent-scorer', 'Signal Stacking: ' + signalCount + ' signaux distincts → ×' + stackingMultiplier);
  }
  const adjustedScore = rawScore * stackingMultiplier;

  // Normaliser sur 0-10
  const score = Math.min(10, Math.round(adjustedScore * 10) / 10);

  // Trier par contribution decroissante
  scoredSignals.sort((a, b) => b.contribution - a.contribution);

  // Top signal pour le brain
  const topSignal = scoredSignals.length > 0 ? scoredSignals[0] : null;

  // Summary lisible
  const stackLabel = stackingMultiplier > 1.0 ? ' [×' + stackingMultiplier + ' stacking]' : '';
  const summary = scoredSignals.length === 0
    ? 'aucun signal'
    : scoredSignals.slice(0, 3).map(s => s.type.replace(/_/g, ' ')).join(' + ') + stackLabel;

  return {
    score: score,
    signals: scoredSignals,
    signalCount: signalCount,
    stackingMultiplier: stackingMultiplier,
    topSignal: topSignal ? topSignal.type : null,
    summary: summary,
    calculatedAt: new Date().toISOString()
  };
}

/**
 * Genere un label court pour le brain prompt (ex: "intent: 7 (recrute BizDev + levee)")
 */
function formatIntentLabel(intentData) {
  if (!intentData || intentData.score === 0) return '';
  return 'intent: ' + intentData.score + '/10 (' + intentData.summary + ')';
}

/**
 * Genere le contexte intent pour le ClaudeEmailWriter
 * @param {Object} intentData — resultat de calculateIntentScore()
 * @param {Object} nicheContext — niche ICP du lead (optionnel)
 * @returns {string} bloc de texte a injecter dans le prompt writer
 */
function formatIntentForWriter(intentData, nicheContext) {
  if (!intentData || intentData.score < 3) return ''; // pas assez de signal

  let lines = [];
  lines.push('=== SIGNAUX D\'INTENT DETECTES (score: ' + intentData.score + '/10) ===');

  for (const sig of intentData.signals.slice(0, 3)) {
    lines.push('- [' + sig.type.toUpperCase().replace(/_/g, ' ') + '] ' + sig.detail);
  }

  // Angle suggere basé sur le signal le plus fort + niche
  if (nicheContext && nicheContext.triggers) {
    const topType = intentData.topSignal;
    // Mapper les types intent vers les triggers ICP
    const triggerMap = {
      'scaling_sales': 'hiring_sales',
      'hiring_activity': 'hiring_sales',
      'active_hiring': 'growth',
      'recent_funding': 'funding',
      'headcount_growth': 'growth',
      'geo_expansion': 'growth',
      'market_funding': 'funding',
      'market_hiring': 'hiring_sales',
      'market_expansion': 'growth'
    };
    const mapped = triggerMap[topType];
    if (mapped) {
      const trigger = nicheContext.triggers.find(t => t.signal === mapped);
      if (trigger && trigger.angle) {
        lines.push('ANGLE SUGGERE (base sur le signal + ta niche): "' + trigger.angle + '"');
      }
    }
  }

  lines.push('CONSIGNE: Utilise le signal le plus fort comme accroche NATURELLE. NE DIS PAS "j\'ai vu sur Welcome to the Jungle" ni "selon nos sources". Reste conversationnel: "j\'ai vu que vous recrutiez cote commercial" ou "belle levee recemment".');

  return lines.join('\n');
}

module.exports = {
  calculateIntentScore,
  formatIntentLabel,
  formatIntentForWriter,
  SIGNAL_WEIGHTS
};
