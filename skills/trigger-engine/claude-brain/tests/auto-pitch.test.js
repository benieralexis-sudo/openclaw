'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');

// On teste la logique d'enqueue auto-pitch en reproduisant la query du cron.
// (La méthode _enqueueAutoPitchesForRedLeads est dans cron.js, mais la query est stable.)

function enqueueAutoPitchesLogic(db, tenantId, threshold) {
  return db.prepare(`
    SELECT cl.siren
    FROM client_leads cl
    LEFT JOIN (
      SELECT tenant_id, siren, MAX(created_at) as last_pitch
      FROM claude_brain_results WHERE pipeline = 'pitch'
      GROUP BY tenant_id, siren
    ) pp ON pp.tenant_id = cl.client_id AND pp.siren = cl.siren
    WHERE cl.client_id = ?
      AND cl.opus_score >= ?
      AND cl.status IN ('new', 'qualifying')
      AND (pp.last_pitch IS NULL OR (julianday('now') - julianday(pp.last_pitch)) > 7)
    LIMIT 10
  `).all(tenantId, threshold);
}

function seedLead(storage, tenantId, siren, opusScore, status = 'new') {
  seedCompanyAndMatch(storage, siren);
  const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(siren).id;
  storage.db.prepare(`
    INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score)
    VALUES (?, ?, ?, 7.0, 'orange', ?, ?)
  `).run(tenantId, siren, pmId, status, opusScore);
}

test('Auto-pitch — selection leads Opus ≥ seuil (8.0)', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedLead(storage, 't1', '100000001', 9.2); // red, à pitcher
    seedLead(storage, 't1', '100000002', 8.0); // borderline, à pitcher
    seedLead(storage, 't1', '100000003', 7.5); // orange, PAS à pitcher
    seedLead(storage, 't1', '100000004', 5.0); // yellow, PAS à pitcher

    const leads = enqueueAutoPitchesLogic(storage.db, 't1', 8.0);
    const sirens = leads.map(l => l.siren).sort();
    assert.deepEqual(sirens, ['100000001', '100000002']);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Auto-pitch — skip si pitch existe dans les 7 derniers jours', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedLead(storage, 't1', '200000001', 9.0);
    // Pitch récent (3 jours)
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model, created_at)
      VALUES ('t1', 'pitch', '200000001', 1, '{}', 'claude-opus-4-7', datetime('now', '-3 days'))
    `).run();

    const leads = enqueueAutoPitchesLogic(storage.db, 't1', 8.0);
    assert.equal(leads.length, 0, 'pitch récent → skip');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Auto-pitch — inclut si pitch > 7 jours', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedLead(storage, 't1', '300000001', 9.0);
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model, created_at)
      VALUES ('t1', 'pitch', '300000001', 1, '{}', 'claude-opus-4-7', datetime('now', '-10 days'))
    `).run();

    const leads = enqueueAutoPitchesLogic(storage.db, 't1', 8.0);
    assert.equal(leads.length, 1, 'pitch > 7 jours → re-pitch autorisé');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Auto-pitch — skip si status déjà sent/booked/discarded', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedLead(storage, 't1', '400000001', 9.0, 'sent');
    seedLead(storage, 't1', '400000002', 9.0, 'booked');
    seedLead(storage, 't1', '400000003', 9.0, 'discarded');
    seedLead(storage, 't1', '400000004', 9.0, 'new'); // seul à pitcher

    const leads = enqueueAutoPitchesLogic(storage.db, 't1', 8.0);
    assert.equal(leads.length, 1);
    assert.equal(leads[0].siren, '400000004');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Auto-pitch — scope tenant respecté', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedTenant(storage, 't2');
    seedLead(storage, 't1', '500000001', 9.0);
    seedLead(storage, 't2', '500000002', 9.0);

    const leads1 = enqueueAutoPitchesLogic(storage.db, 't1', 8.0);
    const leads2 = enqueueAutoPitchesLogic(storage.db, 't2', 8.0);
    assert.equal(leads1.length, 1);
    assert.equal(leads2.length, 1);
    assert.equal(leads1[0].siren, '500000001');
    assert.equal(leads2[0].siren, '500000002');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Auto-pitch — threshold ajustable par tenant', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedLead(storage, 't1', '600000001', 7.0);
    seedLead(storage, 't1', '600000002', 8.0);
    seedLead(storage, 't1', '600000003', 9.0);

    // Seuil 7 : tout passe
    assert.equal(enqueueAutoPitchesLogic(storage.db, 't1', 7.0).length, 3);
    // Seuil 8 : 2 passent
    assert.equal(enqueueAutoPitchesLogic(storage.db, 't1', 8.0).length, 2);
    // Seuil 9 : 1 passe
    assert.equal(enqueueAutoPitchesLogic(storage.db, 't1', 9.0).length, 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Auto-pitch — limite LIMIT 10 respectée', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    // 15 leads tous ≥ 9
    for (let i = 0; i < 15; i++) {
      seedLead(storage, 't1', `70000${String(i).padStart(4, '0')}`, 9.0);
    }
    const leads = enqueueAutoPitchesLogic(storage.db, 't1', 8.0);
    assert.equal(leads.length, 10);
  } finally { cleanupStorage(storage, dbPath); }
});
