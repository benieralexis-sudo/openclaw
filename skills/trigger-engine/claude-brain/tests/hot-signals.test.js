'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage } = require('./setup');
const {
  isHotEvent,
  isFreshEvent,
  computeFreshnessBoost,
  describeHotState,
  getHotSignalsForSiren,
  eventAgeHours,
  HOT_WINDOW_HOURS,
  FRESH_WINDOW_HOURS,
  HOT_BOOST,
  FRESH_BOOST
} = require('../hot-signal-detector');

function eventAt(daysAgo, hoursAgo = 0, type = 'funding') {
  const ms = Date.now() - (daysAgo * 24 + hoursAgo) * 3600 * 1000;
  return { event_type: type, event_date: new Date(ms).toISOString(), source: 'test' };
}

test('hot — eventAgeHours retourne l\'âge en heures', () => {
  const e = eventAt(0, 5);
  const age = eventAgeHours(e);
  assert.ok(age >= 4.9 && age <= 5.1, `expected ~5h got ${age}`);
});

test('hot — isHotEvent true si <48h', () => {
  assert.equal(isHotEvent(eventAt(0, 1)), true);   // 1h
  assert.equal(isHotEvent(eventAt(1, 0)), true);   // 24h
  assert.equal(isHotEvent(eventAt(1, 23)), true);  // 47h
  assert.equal(isHotEvent(eventAt(2, 1)), false);  // 49h
  assert.equal(isHotEvent(eventAt(7, 0)), false);
});

test('hot — isFreshEvent true si <24h', () => {
  assert.equal(isFreshEvent(eventAt(0, 1)), true);
  assert.equal(isFreshEvent(eventAt(0, 23)), true);
  assert.equal(isFreshEvent(eventAt(1, 1)), false);
});

test('hot — isHotEvent false si event_date manquant ou invalide', () => {
  assert.equal(isHotEvent({}), false);
  assert.equal(isHotEvent({ event_date: 'invalid' }), false);
  assert.equal(isHotEvent(null), false);
});

test('hot — computeFreshnessBoost retourne FRESH_BOOST si <24h', () => {
  const events = [eventAt(0, 5), eventAt(3, 0)]; // 5h + 72h
  assert.equal(computeFreshnessBoost(events), FRESH_BOOST);
});

test('hot — computeFreshnessBoost retourne HOT_BOOST si entre 24-48h', () => {
  const events = [eventAt(1, 12), eventAt(5, 0)]; // 36h + 120h
  assert.equal(computeFreshnessBoost(events), HOT_BOOST);
});

test('hot — computeFreshnessBoost retourne 0 si >48h', () => {
  const events = [eventAt(3, 0), eventAt(10, 0)];
  assert.equal(computeFreshnessBoost(events), 0);
});

test('hot — computeFreshnessBoost gère liste vide', () => {
  assert.equal(computeFreshnessBoost([]), 0);
  assert.equal(computeFreshnessBoost(null), 0);
  assert.equal(computeFreshnessBoost(undefined), 0);
});

test('hot — describeHotState renvoie metadata complète', () => {
  const events = [eventAt(0, 5, 'funding'), eventAt(1, 0, 'hiring_tech')];
  const desc = describeHotState(events);
  assert.equal(desc.is_hot, true);
  assert.equal(desc.is_fresh, true);
  assert.equal(desc.hot_count, 2);
  assert.ok(desc.freshest_age_hours <= 6);
  assert.deepEqual(desc.fresh_event_types, ['funding', 'hiring_tech']);
});

test('hot — describeHotState renvoie is_hot:false si rien <48h', () => {
  const events = [eventAt(5, 0)];
  const desc = describeHotState(events);
  assert.equal(desc.is_hot, false);
  assert.equal(desc.hot_count, 0);
  assert.equal(desc.freshest_age_hours, null);
});

test('hot — getHotSignalsForSiren ne retourne que les events <48h', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const siren = '200000001';
    storage.upsertCompany({ siren, raison_sociale: 'Test', naf_code: '62.01Z' });
    // 3 events : 5h, 30h, 5j
    const dates = [
      new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
      new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
    ];
    storage.insertEvent({ source: 'test', event_type: 'funding', siren, raw_data: {}, event_date: dates[0] });
    storage.insertEvent({ source: 'test', event_type: 'hiring_tech', siren, raw_data: {}, event_date: dates[1] });
    storage.insertEvent({ source: 'test', event_type: 'marque_deposee', siren, raw_data: {}, event_date: dates[2] });

    const hot = getHotSignalsForSiren(storage.db, siren);
    assert.equal(hot.length, 2);
    assert.ok(hot.every(e => ['funding', 'hiring_tech'].includes(e.event_type)));
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('hot — constants sanity check', () => {
  assert.equal(HOT_WINDOW_HOURS, 48);
  assert.equal(FRESH_WINDOW_HOURS, 24);
  assert.equal(FRESH_BOOST, 1.0);
  assert.equal(HOT_BOOST, 0.5);
});
