// Tests unitaires du Processor

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { TriggerEngineStorage } = require('../storage');
const { TriggerEngineProcessor } = require('../processor');

function createTempDb() {
  const tmpPath = path.join(os.tmpdir(), `trigger-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return tmpPath;
}

test('processor marks events without SIREN as processed without matches', () => {
  const dbPath = createTempDb();
  const storage = new TriggerEngineStorage(dbPath);
  const proc = new TriggerEngineProcessor(storage, { log: { info: () => {}, error: () => {} } });

  storage.insertEvent({
    source: 'bodacc',
    event_type: 'company_creation',
    siren: null,
    raw_data: {},
    event_date: new Date().toISOString().slice(0, 10)
  });

  const result = proc.processUnprocessed(100);
  assert.equal(result.processed, 1);
  assert.equal(result.sirensEvaluated, 0);
  assert.equal(result.matches, 0);

  storage.close();
  fs.unlinkSync(dbPath);
});

test('processor matches scale-up pattern and inserts match', () => {
  const dbPath = createTempDb();
  const storage = new TriggerEngineStorage(dbPath);
  const proc = new TriggerEngineProcessor(storage, { log: { info: () => {}, error: () => {} } });

  const today = new Date().toISOString().slice(0, 10);
  const siren = '123456789';

  storage.upsertCompany({ siren, raison_sociale: 'Test Corp' });

  storage.insertEvent({
    source: 'rodz',
    event_type: 'funding',
    siren,
    raw_data: { amount: '8M' },
    event_date: today
  });
  storage.insertEvent({
    source: 'francetravail',
    event_type: 'hiring_tech',
    siren,
    raw_data: { title: 'Senior Dev' },
    event_date: today
  });
  storage.insertEvent({
    source: 'francetravail',
    event_type: 'hiring_tech',
    siren,
    raw_data: { title: 'QA Engineer' },
    event_date: today
  });

  const result = proc.processUnprocessed(100);
  assert.equal(result.processed, 3);
  assert.equal(result.sirensEvaluated, 1);
  assert.ok(result.matches >= 1, `expected >=1 match, got ${result.matches}`);

  const matches = storage.getActivePatternMatches(siren);
  assert.ok(matches.length >= 1);
  const patternIds = matches.map(m => m.pattern_id);
  const acceptable = ['scale-up-tech', 'tech-hiring', 'funding-recent'];
  assert.ok(
    patternIds.some(id => acceptable.includes(id)),
    `expected one of ${acceptable.join(',')}, got ${patternIds.join(',')}`
  );

  storage.close();
  fs.unlinkSync(dbPath);
});

test('processor skips excluded events (procedure_collective)', () => {
  const dbPath = createTempDb();
  const storage = new TriggerEngineStorage(dbPath);
  const proc = new TriggerEngineProcessor(storage, { log: { info: () => {}, error: () => {} } });

  const today = new Date().toISOString().slice(0, 10);
  const siren = '987654321';
  storage.upsertCompany({ siren, raison_sociale: 'Broken Corp' });

  storage.insertEvent({ source: 'rodz', event_type: 'funding', siren, raw_data: {}, event_date: today });
  storage.insertEvent({ source: 'francetravail', event_type: 'hiring_tech', siren, raw_data: {}, event_date: today });
  storage.insertEvent({ source: 'francetravail', event_type: 'hiring_tech', siren, raw_data: {}, event_date: today });
  storage.insertEvent({ source: 'bodacc', event_type: 'procedure_collective', siren, raw_data: {}, event_date: today });

  const result = proc.processUnprocessed(100);
  assert.equal(result.matches, 0, 'procedure_collective should exclude the scale-up match');

  storage.close();
  fs.unlinkSync(dbPath);
});

test('processor is idempotent (second run produces no new matches)', () => {
  const dbPath = createTempDb();
  const storage = new TriggerEngineStorage(dbPath);
  const proc = new TriggerEngineProcessor(storage, { log: { info: () => {}, error: () => {} } });

  const today = new Date().toISOString().slice(0, 10);
  const siren = '111222333';
  storage.upsertCompany({ siren, raison_sociale: 'Idem Corp' });
  storage.insertEvent({ source: 'rodz', event_type: 'funding', siren, raw_data: {}, event_date: today });
  storage.insertEvent({ source: 'francetravail', event_type: 'hiring_tech', siren, raw_data: {}, event_date: today });
  storage.insertEvent({ source: 'francetravail', event_type: 'hiring_tech', siren, raw_data: {}, event_date: today });

  const r1 = proc.processUnprocessed(100);
  const r2 = proc.processUnprocessed(100);

  assert.equal(r1.processed, 3);
  assert.equal(r2.processed, 0, 'second run should have no unprocessed events');

  storage.close();
  fs.unlinkSync(dbPath);
});

test('processor cleanupExpired removes old matches', () => {
  const dbPath = createTempDb();
  const storage = new TriggerEngineStorage(dbPath);
  const proc = new TriggerEngineProcessor(storage, { log: { info: () => {}, error: () => {} } });

  const siren = '444555666';
  storage.upsertCompany({ siren, raison_sociale: 'Expire Corp' });

  // Insert a match with expires_at in the past
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  storage.insertPatternMatch({
    siren,
    pattern_id: 'scale-up-tech',
    score: 8.0,
    signals: [],
    window_start: past,
    window_end: past,
    expires_at: past
  });

  const active = storage.getActivePatternMatches(siren);
  assert.equal(active.length, 0, 'already expired, not in active');

  const cleaned = proc.cleanupExpired();
  assert.ok(cleaned >= 1);

  storage.close();
  fs.unlinkSync(dbPath);
});
