'use strict';

/**
 * Hot Signal Detector — détecte les events "frais" (<48h) sur un SIREN.
 *
 * Logique : un signal capté <24h après l'événement réel = ULTRA-frais (boost +1).
 * Entre 24h et 48h = frais (boost +0.5). Au-delà : pas de boost.
 *
 * Le boost s'applique APRÈS le combo booster pour permettre les jackpots
 * "frais" (3 signaux durs dont 1 <48h = score à 10 quasi garanti).
 */

const HOT_WINDOW_HOURS = 48;
const FRESH_WINDOW_HOURS = 24;
const HOT_BOOST = 0.5;
const FRESH_BOOST = 1.0;

function eventAgeHours(event) {
  if (!event?.event_date) return Infinity;
  const eventMs = new Date(event.event_date).getTime();
  if (Number.isNaN(eventMs)) return Infinity;
  return (Date.now() - eventMs) / 3600000;
}

function isHotEvent(event) {
  return eventAgeHours(event) <= HOT_WINDOW_HOURS;
}

function isFreshEvent(event) {
  return eventAgeHours(event) <= FRESH_WINDOW_HOURS;
}

/**
 * Récupère les signals frais (<48h) pour un SIREN. Filtre uniquement les
 * event_types qui ont du sens "frais" (pas marque_deposee qui peut être
 * vieille de plusieurs semaines avant détection).
 */
function getHotSignalsForSiren(db, siren) {
  const cutoff = new Date(Date.now() - HOT_WINDOW_HOURS * 3600 * 1000).toISOString();
  return db.prepare(`
    SELECT id, event_type, event_date, source, captured_at
    FROM events
    WHERE siren = ?
      AND event_date >= ?
    ORDER BY event_date DESC
  `).all(siren, cutoff);
}

/**
 * Calcule le boost de fraîcheur. Prend le MEILLEUR boost (pas la somme) pour
 * éviter qu'une boîte avec 5 hiring_tech d'aujourd'hui soit boostée 5×.
 *
 * @returns {number} 0, 0.5 ou 1.0
 */
function computeFreshnessBoost(events) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  let best = 0;
  for (const e of events) {
    const age = eventAgeHours(e);
    if (age <= FRESH_WINDOW_HOURS) return FRESH_BOOST; // shortcut : on a trouvé du <24h
    if (age <= HOT_WINDOW_HOURS && best < HOT_BOOST) best = HOT_BOOST;
  }
  return best;
}

/**
 * Décrit l'état hot d'un lead (pour metadata + UI).
 */
function describeHotState(events) {
  const hotEvents = (events || []).filter(isHotEvent);
  if (hotEvents.length === 0) return { is_hot: false, is_fresh: false, hot_count: 0, freshest_age_hours: null };
  const freshest = hotEvents.reduce((min, e) => {
    const age = eventAgeHours(e);
    return age < min ? age : min;
  }, Infinity);
  return {
    is_hot: true,
    is_fresh: freshest <= FRESH_WINDOW_HOURS,
    hot_count: hotEvents.length,
    freshest_age_hours: Math.round(freshest * 10) / 10,
    fresh_event_types: hotEvents.map(e => e.event_type)
  };
}

module.exports = {
  isHotEvent,
  isFreshEvent,
  getHotSignalsForSiren,
  computeFreshnessBoost,
  describeHotState,
  eventAgeHours,
  HOT_WINDOW_HOURS,
  FRESH_WINDOW_HOURS,
  HOT_BOOST,
  FRESH_BOOST
};
