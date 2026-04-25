'use strict';

/**
 * Combo Booster — multiplie le score Opus si plusieurs CATÉGORIES de signaux
 * durs convergent sur la même entreprise dans les 90 derniers jours.
 *
 * Hypothèse business : 3 signaux durs distincts <90j = boîte en transformation
 * majeure (jackpot), reply rate observé 15-25% vs 5-10% sur signal seul.
 *
 * Règle de comptage : on regroupe les event_types par CATÉGORIE (ex: 5 hiring_tech
 * = 1 catégorie "hiring_typed", pas 5). Le but est de détecter la diversité, pas
 * la répétition.
 *
 * Si une exclusion est présente (procédure collective, cessation) → multiplier 1.0
 * (le qualify Opus se chargera de discarder de toute façon).
 */

const HARD_SIGNAL_CATEGORIES = {
  funding:       ['funding', 'funding_seed', 'funding_series'],
  hiring_typed:  ['hiring_tech', 'hiring_sales', 'hiring_marketing', 'hiring_finance', 'hiring_hr'],
  exec_hire:     ['hiring_executive'],
  brand_launch:  ['marque_deposee'],
  media_buzz:    ['media_buzz'],
  ma_activity:   ['company_merger'],
  structural:    ['modification_statuts'],
  ad_spend:      ['ad_spend_detected']
};

const EXCLUSION_TYPES = ['procedure_collective', 'company_cessation'];

const DEFAULT_WINDOW_DAYS = 90;
const SCORE_CAP = 10.0;

function categorizeEventType(eventType) {
  for (const [category, types] of Object.entries(HARD_SIGNAL_CATEGORIES)) {
    if (types.includes(eventType)) return category;
  }
  return null;
}

/**
 * Calcule le multiplier combo pour un SIREN donné.
 *
 * @param {object} db - sqlite handle
 * @param {string} siren
 * @param {number} windowDays - défaut 90
 * @returns {object} { multiplier, hard_signals_count, categories, label, excluded }
 */
function computeComboBooster(db, siren, windowDays = DEFAULT_WINDOW_DAYS) {
  const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();

  // Check exclusions d'abord — si la boîte est en procédure collective, no boost
  const exclPlaceholders = EXCLUSION_TYPES.map(() => '?').join(',');
  const excluded = db.prepare(`
    SELECT 1 FROM events
    WHERE siren = ? AND event_date >= ? AND event_type IN (${exclPlaceholders})
    LIMIT 1
  `).get(siren, cutoff, ...EXCLUSION_TYPES);

  if (excluded) {
    return {
      multiplier: 1.0,
      hard_signals_count: 0,
      categories: [],
      label: null,
      excluded: true
    };
  }

  // Récupère les event_types distincts dans la fenêtre
  const allHardTypes = Object.values(HARD_SIGNAL_CATEGORIES).flat();
  const placeholders = allHardTypes.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT DISTINCT event_type FROM events
    WHERE siren = ? AND event_date >= ?
      AND event_type IN (${placeholders})
  `).all(siren, cutoff, ...allHardTypes);

  // Regroupe par catégorie
  const categoriesHit = new Set();
  for (const row of rows) {
    const cat = categorizeEventType(row.event_type);
    if (cat) categoriesHit.add(cat);
  }

  const distinctCategories = categoriesHit.size;
  let multiplier = 1.0;
  let label = null;

  if (distinctCategories >= 3) { multiplier = 2.5; label = 'JACKPOT'; }
  else if (distinctCategories === 2) { multiplier = 1.7; label = 'COMBO'; }

  return {
    multiplier,
    hard_signals_count: distinctCategories,
    categories: Array.from(categoriesHit).sort(),
    label,
    excluded: false
  };
}

/**
 * Applique le boost à un score brut, capé à 10.
 */
function applyBoost(rawScore, multiplier) {
  if (typeof rawScore !== 'number' || Number.isNaN(rawScore)) return rawScore;
  return Math.min(SCORE_CAP, rawScore * multiplier);
}

module.exports = {
  computeComboBooster,
  applyBoost,
  categorizeEventType,
  HARD_SIGNAL_CATEGORIES,
  EXCLUSION_TYPES,
  DEFAULT_WINDOW_DAYS,
  SCORE_CAP
};
