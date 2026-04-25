'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage } = require('./setup');
const {
  computeComboBooster,
  applyBoost,
  categorizeEventType,
  HARD_SIGNAL_CATEGORIES
} = require('../combo-booster');

function seedCompany(storage, siren = '111111111') {
  storage.upsertCompany({
    siren,
    raison_sociale: 'Test SAS',
    naf_code: '62.01Z',
    naf_label: 'Programmation',
    effectif_min: 10,
    effectif_max: 50,
    departement: '75'
  });
}

function insertEvent(storage, siren, eventType, daysAgo = 0) {
  const eventDate = new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
  storage.insertEvent({
    source: 'test',
    event_type: eventType,
    siren,
    raw_data: { test: true },
    event_date: eventDate
  });
}

test('combo-booster — categorize: funding mappé à funding', () => {
  assert.equal(categorizeEventType('funding'), 'funding');
  assert.equal(categorizeEventType('funding_series'), 'funding');
  assert.equal(categorizeEventType('hiring_executive'), 'exec_hire');
  assert.equal(categorizeEventType('hiring_tech'), 'hiring_typed');
  assert.equal(categorizeEventType('marque_deposee'), 'brand_launch');
  assert.equal(categorizeEventType('inconnu_type'), null);
});

test('combo-booster — 0 signal hard → multiplier 1.0', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000001');
    const r = computeComboBooster(storage.db, '100000001');
    assert.equal(r.multiplier, 1.0);
    assert.equal(r.label, null);
    assert.equal(r.hard_signals_count, 0);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — 1 catégorie (funding seul) → multiplier 1.0', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000002');
    insertEvent(storage, '100000002', 'funding', 10);
    const r = computeComboBooster(storage.db, '100000002');
    assert.equal(r.multiplier, 1.0);
    assert.equal(r.label, null);
    assert.equal(r.hard_signals_count, 1);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — 2 catégories distinctes <90j → COMBO ×1.7', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000003');
    insertEvent(storage, '100000003', 'funding', 10);
    insertEvent(storage, '100000003', 'hiring_tech', 5);
    const r = computeComboBooster(storage.db, '100000003');
    assert.equal(r.multiplier, 1.7);
    assert.equal(r.label, 'COMBO');
    assert.equal(r.hard_signals_count, 2);
    assert.deepEqual(r.categories.sort(), ['funding', 'hiring_typed']);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — 3 catégories distinctes <90j → JACKPOT ×2.5', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000004');
    insertEvent(storage, '100000004', 'funding', 30);
    insertEvent(storage, '100000004', 'hiring_executive', 15);
    insertEvent(storage, '100000004', 'hiring_tech', 5);
    const r = computeComboBooster(storage.db, '100000004');
    assert.equal(r.multiplier, 2.5);
    assert.equal(r.label, 'JACKPOT');
    assert.equal(r.hard_signals_count, 3);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — même catégorie répétée ne compte qu\'une fois', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000005');
    // 3 hiring_tech → 1 seule catégorie hiring_typed
    insertEvent(storage, '100000005', 'hiring_tech', 1);
    insertEvent(storage, '100000005', 'hiring_tech', 5);
    insertEvent(storage, '100000005', 'hiring_tech', 20);
    const r = computeComboBooster(storage.db, '100000005');
    assert.equal(r.multiplier, 1.0);
    assert.equal(r.hard_signals_count, 1);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — signal >90j ignoré', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000006');
    insertEvent(storage, '100000006', 'funding', 30);
    insertEvent(storage, '100000006', 'hiring_executive', 15);
    insertEvent(storage, '100000006', 'marque_deposee', 120); // >90j → ignoré
    const r = computeComboBooster(storage.db, '100000006');
    assert.equal(r.multiplier, 1.7); // 2 catégories valides, pas 3
    assert.equal(r.label, 'COMBO');
    assert.equal(r.hard_signals_count, 2);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — exclusion procedure_collective annule le boost', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedCompany(storage, '100000007');
    insertEvent(storage, '100000007', 'funding', 10);
    insertEvent(storage, '100000007', 'hiring_executive', 5);
    insertEvent(storage, '100000007', 'hiring_tech', 3);
    insertEvent(storage, '100000007', 'procedure_collective', 1);
    const r = computeComboBooster(storage.db, '100000007');
    assert.equal(r.multiplier, 1.0);
    assert.equal(r.excluded, true);
    assert.equal(r.label, null);
  } finally {
    cleanupStorage(storage, dbPath);
  }
});

test('combo-booster — applyBoost cap à 10', () => {
  assert.equal(applyBoost(8, 2.5), 10);
  assert.equal(applyBoost(5, 1.7), 8.5);
  assert.equal(applyBoost(3, 1.0), 3);
  assert.equal(applyBoost(7, 2.5), 10); // 17.5 → capé
});

test('combo-booster — applyBoost gère valeurs invalides', () => {
  assert.equal(applyBoost(NaN, 2.5), NaN);
  assert.equal(applyBoost(undefined, 2.5), undefined);
  assert.equal(applyBoost('5', 2.5), '5'); // non-number passthrough
});

test('combo-booster — categories couvre tous les types des patterns existants', () => {
  // Vérifie qu'on n'oublie aucun type "dur" utilisé dans les patterns/definitions
  const allCovered = Object.values(HARD_SIGNAL_CATEGORIES).flat();
  const expectedHardTypes = [
    'funding', 'funding_seed', 'funding_series',
    'hiring_tech', 'hiring_sales', 'hiring_marketing', 'hiring_finance', 'hiring_hr',
    'hiring_executive',
    'marque_deposee', 'media_buzz',
    'company_merger', 'modification_statuts', 'ad_spend_detected'
  ];
  for (const t of expectedHardTypes) {
    assert.ok(allCovered.includes(t), `type ${t} doit être couvert par HARD_SIGNAL_CATEGORIES`);
  }
});
