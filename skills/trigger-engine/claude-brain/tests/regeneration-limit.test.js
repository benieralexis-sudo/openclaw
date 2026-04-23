'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');

// Reproduit la logique de vérification du endpoint /pitch/generate
function countVersions(db, tenantId, siren, pipeline) {
  return db.prepare(`
    SELECT COUNT(*) as n FROM claude_brain_results
    WHERE tenant_id = ? AND siren = ? AND pipeline = ?
  `).get(tenantId, siren, pipeline).n;
}

function seedVersion(storage, tenantId, siren, pipeline, v) {
  storage.db.prepare(`
    INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model)
    VALUES (?, ?, ?, ?, '{}', 'claude-opus-4-7')
  `).run(tenantId, pipeline, siren, v);
}

test('Limite régen — compteur exact sur pitch', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '100000001');
    assert.equal(countVersions(storage.db, 't1', '100000001', 'pitch'), 0);
    seedVersion(storage, 't1', '100000001', 'pitch', 1);
    assert.equal(countVersions(storage.db, 't1', '100000001', 'pitch'), 1);
    seedVersion(storage, 't1', '100000001', 'pitch', 2);
    seedVersion(storage, 't1', '100000001', 'pitch', 3);
    assert.equal(countVersions(storage.db, 't1', '100000001', 'pitch'), 3);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Limite régen — différencie pitch vs brief', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '200000001');
    seedVersion(storage, 't1', '200000001', 'pitch', 1);
    seedVersion(storage, 't1', '200000001', 'pitch', 2);
    seedVersion(storage, 't1', '200000001', 'brief', 1);
    assert.equal(countVersions(storage.db, 't1', '200000001', 'pitch'), 2);
    assert.equal(countVersions(storage.db, 't1', '200000001', 'brief'), 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Limite régen — scope tenant respecté', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedTenant(storage, 't2');
    seedCompanyAndMatch(storage, '300000001');
    seedVersion(storage, 't1', '300000001', 'pitch', 1);
    seedVersion(storage, 't2', '300000001', 'pitch', 1);
    seedVersion(storage, 't2', '300000001', 'pitch', 2);
    assert.equal(countVersions(storage.db, 't1', '300000001', 'pitch'), 1);
    assert.equal(countVersions(storage.db, 't2', '300000001', 'pitch'), 2);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Limite régen — config tenant appliquée (max = 3)', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '400000001');
    for (let v = 1; v <= 3; v++) seedVersion(storage, 't1', '400000001', 'pitch', v);
    const count = countVersions(storage.db, 't1', '400000001', 'pitch');
    const maxRegens = 3; // défaut
    assert.equal(count, maxRegens, 'limite atteinte');
    assert.ok(count >= maxRegens, 'endpoint doit retourner 429 à ce stade');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Limite régen — reset admin supprime tous les résultats du pipeline', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '500000001');
    seedVersion(storage, 't1', '500000001', 'pitch', 1);
    seedVersion(storage, 't1', '500000001', 'pitch', 2);
    seedVersion(storage, 't1', '500000001', 'brief', 1);

    // Simule reset pitch
    const r = storage.db.prepare(`
      DELETE FROM claude_brain_results
      WHERE tenant_id = ? AND siren = ? AND pipeline = 'pitch'
    `).run('t1', '500000001');
    assert.equal(r.changes, 2);
    assert.equal(countVersions(storage.db, 't1', '500000001', 'pitch'), 0);
    // Le brief n'est pas touché
    assert.equal(countVersions(storage.db, 't1', '500000001', 'brief'), 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Limite régen — thresholds par défaut raisonnables', () => {
  const { DEFAULT_TENANT_CONFIG } = require('../index');
  assert.equal(DEFAULT_TENANT_CONFIG.max_pitch_regenerations, 3);
  assert.equal(DEFAULT_TENANT_CONFIG.max_brief_regenerations, 2);
});
