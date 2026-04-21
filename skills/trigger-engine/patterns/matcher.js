// ═══════════════════════════════════════════════════════════════════
// Pattern Matcher — détection combinatoire des patterns
// ═══════════════════════════════════════════════════════════════════
// Prend en entrée les events d'une entreprise (sur fenêtre 30j),
// et détermine quels patterns matchent + score.
//
// Règle de scoring :
//   1. Si EXCLUSIONS présentes dans les events → score = 0 (pas de match)
//   2. Si les SIGNALS REQUIRED ne sont pas tous satisfaits → pas de match
//   3. Sinon : score = sum(weights signals required) + sum(weights bonuses matchés)
//   4. Clampé à [0, max_score]
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PATTERNS_DIR = path.join(__dirname, 'definitions');

/**
 * Charge tous les patterns JSON du dossier definitions/
 */
function loadPatterns() {
  const files = fs.readdirSync(PATTERNS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const content = fs.readFileSync(path.join(PATTERNS_DIR, f), 'utf8');
    return JSON.parse(content);
  });
}

/**
 * Vérifie si un event type est dans la liste demandée par le pattern
 */
function eventMatchesTypes(event, types) {
  if (!Array.isArray(types)) return false;
  return types.includes(event.event_type);
}

/**
 * Filtre les events sur fenêtre de X jours
 */
function eventsInWindow(events, windowDays) {
  const now = Date.now();
  const cutoff = now - (windowDays * 24 * 3600 * 1000);
  return events.filter(e => {
    const eventTime = new Date(e.event_date).getTime();
    return eventTime >= cutoff;
  });
}

/**
 * Évalue un pattern contre une liste d'events
 * @param {object} pattern - definition JSON du pattern
 * @param {Array} events - events de l'entreprise sur la fenêtre
 * @returns {object} { matched, score, signals, reason }
 */
function evaluatePattern(pattern, events) {
  const windowEvents = eventsInWindow(events, pattern.window_days || 30);

  // 1. Exclusions : si un event matching, pattern NE matche pas
  const exclusions = pattern.exclusions || [];
  for (const excl of exclusions) {
    const hit = windowEvents.find(e => eventMatchesTypes(e, excl.types));
    if (hit) {
      return {
        matched: false,
        score: 0,
        signals: [],
        reason: `excluded by ${hit.event_type}`
      };
    }
  }

  // 2. Signaux requis
  const required = pattern.signals_required || {};
  const matchedSignalEvents = [];
  let baseWeight = 0;

  // "any_of" : au moins 1 event matching l'un des types
  if (Array.isArray(required.any_of)) {
    const anyMatched = [];
    for (const group of required.any_of) {
      const matched = windowEvents.filter(e => eventMatchesTypes(e, group.types));
      if (matched.length > 0) {
        anyMatched.push({ group, matched });
      }
    }
    if (anyMatched.length === 0) {
      return { matched: false, score: 0, signals: [], reason: 'missing any_of requirement' };
    }
    // Prend le 1er groupe satisfait
    baseWeight += anyMatched[0].group.weight || 1.0;
    matchedSignalEvents.push(...anyMatched[0].matched);
  }

  // "must_have_at_least_one_of" : groupes additionnels, tous nécessaires
  if (Array.isArray(required.must_have_at_least_one_of)) {
    for (const group of required.must_have_at_least_one_of) {
      const matched = windowEvents.filter(e => eventMatchesTypes(e, group.types));
      const minCount = group.min_count || 1;
      if (matched.length < minCount) {
        return {
          matched: false,
          score: 0,
          signals: [],
          reason: `missing must_have: needs ${minCount} of ${group.types}, got ${matched.length}`
        };
      }
      baseWeight += group.weight || 1.0;
      matchedSignalEvents.push(...matched);
    }
  }

  // 3. Bonuses additifs
  let bonusWeight = 0;
  const bonuses = pattern.bonuses || [];
  for (const bonus of bonuses) {
    const matched = windowEvents.filter(e => {
      if (!eventMatchesTypes(e, bonus.types)) return false;
      // Optionnel : match par texte sur event_type ou contenu normalisé
      if (bonus.event_type_match) {
        const pattern = new RegExp(bonus.event_type_match, 'i');
        const text = JSON.stringify(e.normalized || {}) + e.event_type;
        if (!pattern.test(text)) return false;
      }
      return true;
    });
    if (matched.length > 0) {
      bonusWeight += bonus.weight || 0.5;
      matchedSignalEvents.push(...matched);
    }
  }

  const totalScore = Math.min(baseWeight + bonusWeight, pattern.max_score || 10);

  return {
    matched: totalScore >= (pattern.min_score || 7.0),
    score: totalScore,
    signals: [...new Set(matchedSignalEvents.map(e => e.id || `${e.source}-${e.event_date}-${e.event_type}`))],
    reason: totalScore >= (pattern.min_score || 7.0) ? 'matched' : `score ${totalScore.toFixed(1)} below threshold ${pattern.min_score}`
  };
}

/**
 * Process all patterns against a company's events
 * @param {string} siren
 * @param {Array} events
 * @param {Array} patterns (optional, loaded by default from disk)
 * @returns {Array<{pattern, result}>}
 */
function matchAllPatterns(siren, events, patterns = null) {
  const patternList = patterns || loadPatterns();
  const results = [];
  for (const pattern of patternList) {
    if (!pattern.enabled) continue;
    const result = evaluatePattern(pattern, events);
    if (result.matched) {
      results.push({ siren, pattern, ...result });
    }
  }
  return results;
}

module.exports = {
  loadPatterns,
  evaluatePattern,
  matchAllPatterns,
  eventsInWindow
};
