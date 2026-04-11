// Intent Scorer v9.0 — Scoring composite 7 sources (0-15)
// Sources: recrutement, leadership, funding, headcount, techno concurrente, LinkedIn posts, visite site
// Priorites: 7+ = email+LinkedIn immediat, 4-6 = sequence standard, 0-3 = file d'attente
// Cout : 0$ — pure logique, pas d'appel API
'use strict';

const log = require('../../gateway/logger.js');

// === V9.0 COMPOSITE SCORING (7 sources, max ~20 pts brut → normalise 0-15) ===
// Chaque source a un poids calibre sur les benchmarks cold email 2026
const SIGNAL_WEIGHTS = {
  // SOURCE 1 — Recrutement commercial (+3 pts) — reply rate 15-20%
  scaling_sales: 3.0,        // Recrute commerciaux/SDR/BizDev → veut grandir revenue
  hiring_activity: 2.0,      // Recrutement detecte (generique)
  active_hiring: 1.5,        // Beaucoup de postes ouverts (non categorises)
  building_product: 1.0,     // Recrute tech → build, moins direct pour nous

  // SOURCE 2 — Nouveau dirigeant < 90j (+3 pts) — reply rate 14-25%
  leadership_change: 3.0,    // Nouveau CEO/DG/CTO → depense 3-5x les 100 premiers jours

  // SOURCE 3 — Levee de fonds < 6 mois (+3 pts) — reply rate 12-20%
  recent_funding: 3.0,       // Levee de fonds → cash dispo, 71% choisissent fournisseurs en 90j

  // SOURCE 4 — Croissance headcount > 15% (+2 pts) — reply rate 10-15%
  headcount_growth: 2.0,     // Effectif en croissance rapide

  // SOURCE 5 — Techno concurrente detectee (+2 pts) — reply rate 10-15%
  competitor_tech: 2.0,      // Utilise Waalaxy/Lemlist/HubSpot Sales/Pipedrive/Apollo
  tech_stack_clay: 0.5,      // Techno generique (non concurrente)

  // SOURCE 6 — Post LinkedIn pertinent (+2 pts) — reply rate 12-18%
  linkedin_post_relevant: 2.0, // Post/comment sur sujet pertinent (prospection, croissance, recrutement)
  thought_leader: 1.0,       // Personne active (conferences, publications)
  content_creator: 0.5,      // Publie du contenu (LinkedIn, blog)

  // SOURCE 7 — Visite ifind.fr (+3 pts pricing / +1 pt homepage) — reply rate 20-35%
  website_visit_pricing: 3.0, // Visite page tarifs/pricing → intent le plus chaud
  website_visit_page: 1.0,    // Visite autre page du site

  // Business events (autres)
  acquisition: 2.0,          // Acquisition → expansion
  geo_expansion: 2.0,        // Ouvre un nouveau bureau
  new_product: 1.5,          // Lance un nouveau produit/offre
  partnership: 1.0,          // Nouveau partenariat

  // Market signals (Web Intelligence)
  market_funding: 2.0,
  market_expansion: 1.5,
  market_hiring: 1.5,
  market_acquisition: 2.0,
  market_product_launch: 1.0,
  market_leadership_change: 1.5
};

// Technos concurrentes a detecter via BuiltWith
const COMPETITOR_TECHS = [
  'waalaxy', 'lemlist', 'la-growth-machine', 'lgm', 'hubspot',
  'pipedrive', 'apollo', 'outreach', 'salesloft', 'woodpecker',
  'mailshake', 'smartlead', 'instantly', 'dripify', 'expandi',
  'phantombuster', 'captain-data', 'overloop', 'reply.io'
];

// Mots-cles LinkedIn posts pertinents pour notre service
const RELEVANT_POST_KEYWORDS = [
  'prospection', 'prospecter', 'cold email', 'outbound', 'pipeline',
  'lead generation', 'leads', 'commercial', 'croissance', 'growth',
  'recrutement commercial', 'business development', 'bizdev', 'sdr',
  'rendez-vous', 'rdv qualifie', 'closing', 'linkedin automation',
  'sales', 'vente', 'acquisition client'
];

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

    // SOURCE 4 — Headcount growth from Clay (> 15%)
    const hcGrowth = intel.clayData.headcountGrowth || enr.headcountGrowth || enr.headcount_growth || null;
    if (hcGrowth && typeof hcGrowth === 'number' && hcGrowth > 15 && !scoredSignals.some(s => s.type === 'headcount_growth')) {
      const weight = SIGNAL_WEIGHTS.headcount_growth;
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

    // SOURCE 3 — Funding from Clay
    const funding = intel.clayData.funding || enr.funding || null;
    if (funding && !scoredSignals.some(s => s.type === 'recent_funding')) {
      const weight = SIGNAL_WEIGHTS.recent_funding;
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

    // SOURCE 5 — Techno concurrente (BuiltWith via Clay)
    const builtWith = intel.clayData.builtWith || enr.builtWith || enr.technologies || null;
    if (builtWith && !scoredSignals.some(s => s.type === 'competitor_tech')) {
      const techList = Array.isArray(builtWith) ? builtWith : typeof builtWith === 'string' ? builtWith.split(',') : [];
      const normalizedTechs = techList.map(t => String(t).toLowerCase().trim());
      const detectedCompetitors = normalizedTechs.filter(t => COMPETITOR_TECHS.some(ct => t.includes(ct)));
      if (detectedCompetitors.length > 0) {
        const weight = SIGNAL_WEIGHTS.competitor_tech;
        rawScore += weight;
        scoredSignals.push({
          type: 'competitor_tech',
          detail: 'Utilise: ' + detectedCompetitors.slice(0, 3).join(', '),
          weight: weight,
          decay: 1.0,
          contribution: weight
        });
      }
    }
  }

  // SOURCE 6 — Post LinkedIn pertinent
  if (intel.linkedinPosts && !scoredSignals.some(s => s.type === 'linkedin_post_relevant')) {
    const posts = Array.isArray(intel.linkedinPosts) ? intel.linkedinPosts : typeof intel.linkedinPosts === 'string' ? [intel.linkedinPosts] : [];
    const postsText = posts.map(p => typeof p === 'object' ? (p.text || p.content || JSON.stringify(p)) : String(p)).join(' ').toLowerCase();
    const matchedKeywords = RELEVANT_POST_KEYWORDS.filter(kw => postsText.includes(kw));
    if (matchedKeywords.length > 0) {
      const weight = SIGNAL_WEIGHTS.linkedin_post_relevant;
      rawScore += weight;
      scoredSignals.push({
        type: 'linkedin_post_relevant',
        detail: 'Post LinkedIn sur: ' + matchedKeywords.slice(0, 3).join(', '),
        weight: weight,
        decay: 1.0,
        contribution: weight
      });
    }
  }

  // SOURCE 7 — Visite ifind.fr (Dealfront/Leadfeeder)
  if (intel.websiteVisit) {
    const visitType = intel.websiteVisit.page === 'pricing' ? 'website_visit_pricing' : 'website_visit_page';
    if (!scoredSignals.some(s => s.type.startsWith('website_visit'))) {
      const weight = SIGNAL_WEIGHTS[visitType];
      rawScore += weight;
      scoredSignals.push({
        type: visitType,
        detail: 'Visite ifind.fr' + (intel.websiteVisit.page ? ' (' + intel.websiteVisit.page + ')' : ''),
        weight: weight,
        decay: 1.0,
        contribution: weight
      });
    }
  }

  // Signal Stacking : multiplicateur quand 3+ signaux DISTINCTS convergent
  const uniqueSignalTypes = new Set(scoredSignals.map(s => s.type.replace(/^market_/, '')));
  const signalCount = uniqueSignalTypes.size;
  const stackingMultiplier = signalCount >= 5 ? 1.3 : signalCount >= 4 ? 1.2 : signalCount >= 3 ? 1.1 : 1.0;
  if (stackingMultiplier > 1.0) {
    log.info('intent-scorer', 'Signal Stacking: ' + signalCount + ' signaux distincts x' + stackingMultiplier);
  }
  const adjustedScore = rawScore * stackingMultiplier;

  // Normaliser sur 0-15 (v9.0 — echelle etendue pour les 7 sources)
  const score = Math.min(15, Math.round(adjustedScore * 10) / 10);

  // Categorie d'action
  let actionCategory;
  if (score >= 7) {
    actionCategory = 'PRIORITE_ABSOLUE'; // Email immediat + LinkedIn le meme jour
  } else if (score >= 4) {
    actionCategory = 'SEQUENCE_PRIORITAIRE'; // Sequence 3 steps avec signal
  } else {
    actionCategory = 'FILE_ATTENTE'; // Attendre signal ou cold classique
  }

  // Trier par contribution decroissante
  scoredSignals.sort((a, b) => b.contribution - a.contribution);

  // Top signal pour le brain
  const topSignal = scoredSignals.length > 0 ? scoredSignals[0] : null;

  // Summary lisible
  const categoryEmoji = actionCategory === 'PRIORITE_ABSOLUE' ? '[CHAUD]' : actionCategory === 'SEQUENCE_PRIORITAIRE' ? '[TIEDE]' : '[FROID]';
  const summary = scoredSignals.length === 0
    ? 'aucun signal'
    : categoryEmoji + ' ' + scoredSignals.slice(0, 3).map(s => s.type.replace(/_/g, ' ')).join(' + ');

  return {
    score: score,
    signals: scoredSignals,
    signalCount: signalCount,
    stackingMultiplier: stackingMultiplier,
    actionCategory: actionCategory,
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
  const cat = intentData.actionCategory || (intentData.score >= 7 ? 'PRIORITE_ABSOLUE' : intentData.score >= 4 ? 'SEQUENCE_PRIORITAIRE' : 'FILE_ATTENTE');
  return 'intent: ' + intentData.score + '/15 ' + intentData.summary;
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
  const cat = intentData.actionCategory || 'SEQUENCE_PRIORITAIRE';
  lines.push('=== SIGNAUX D\'INTENT DETECTES (score: ' + intentData.score + '/15, categorie: ' + cat + ') ===');

  for (const sig of intentData.signals.slice(0, 3)) {
    lines.push('- [' + sig.type.toUpperCase().replace(/_/g, ' ') + '] ' + sig.detail);
  }

  // Angle suggere basé sur le signal le plus fort + niche
  if (nicheContext && nicheContext.triggers) {
    const topType = intentData.topSignal;
    const triggerMap = {
      'scaling_sales': 'hiring_sales',
      'hiring_activity': 'hiring_sales',
      'active_hiring': 'growth',
      'recent_funding': 'funding',
      'headcount_growth': 'growth',
      'geo_expansion': 'growth',
      'market_funding': 'funding',
      'market_hiring': 'hiring_sales',
      'market_expansion': 'growth',
      'competitor_tech': 'growth',
      'linkedin_post_relevant': 'growth',
      'website_visit_pricing': 'growth',
      'leadership_change': 'hiring_sales'
    };
    const mapped = triggerMap[topType];
    if (mapped) {
      const trigger = nicheContext.triggers.find(t => t.signal === mapped);
      if (trigger && trigger.angle) {
        lines.push('ANGLE SUGGERE (base sur le signal + ta niche): "' + trigger.angle + '"');
      }
    }
  }

  // Consignes specifiques par type de signal
  if (intentData.topSignal === 'competitor_tech') {
    lines.push('CONSIGNE: Mentionne naturellement l\'outil detecte. Ex: "j\'ai vu que vous utilisiez [outil] — nos clients ESN passent de X% a 15%+ de taux de reponse avec un pipeline IA". NE SOIS PAS AGRESSIF envers l\'outil concurrent.');
  } else if (intentData.topSignal === 'website_visit_pricing') {
    lines.push('CONSIGNE: NE mentionne PAS la visite du site (c\'est creepy). Utilise un angle naturel: "j\'ai vu que [Entreprise] s\'interesse a l\'outbound" ou commence par un autre signal. Le fait qu\'ils visitent = ils sont deja interesses, sois direct et concis.');
  } else if (intentData.topSignal === 'linkedin_post_relevant') {
    lines.push('CONSIGNE: Reference le post LinkedIn specifique de maniere NATURELLE. Ex: "votre post sur [sujet] m\'a parle". Montre que tu as vraiment lu, pas juste detecte un mot-cle.');
  } else {
    lines.push('CONSIGNE: Utilise le signal le plus fort comme accroche NATURELLE. NE DIS PAS "j\'ai vu sur Welcome to the Jungle" ni "selon nos sources". Reste conversationnel: "j\'ai vu que vous recrutiez cote commercial" ou "belle levee recemment".');
  }

  return lines.join('\n');
}

/**
 * Retourne la categorie d'action pour un score intent
 * @param {number} score — score intent 0-15
 * @returns {string} PRIORITE_ABSOLUE | SEQUENCE_PRIORITAIRE | FILE_ATTENTE
 */
function getActionCategory(score) {
  if (score >= 7) return 'PRIORITE_ABSOLUE';
  if (score >= 4) return 'SEQUENCE_PRIORITAIRE';
  return 'FILE_ATTENTE';
}

module.exports = {
  calculateIntentScore,
  formatIntentLabel,
  formatIntentForWriter,
  getActionCategory,
  SIGNAL_WEIGHTS,
  COMPETITOR_TECHS,
  RELEVANT_POST_KEYWORDS
};
