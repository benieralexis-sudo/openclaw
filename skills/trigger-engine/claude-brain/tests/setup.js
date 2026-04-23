'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { TriggerEngineStorage } = require('../../storage');

function createTempStorage() {
  const tmpPath = path.join(os.tmpdir(), `claude-brain-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const storage = new TriggerEngineStorage(tmpPath);
  return { storage, dbPath: tmpPath };
}

function cleanupStorage(storage, dbPath) {
  try { storage.close(); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
}

function seedTenant(storage, id = 't1', overrides = {}) {
  const cfg = {
    enabled: true,
    pipelines: ['qualify', 'pitch', 'brief'],
    monthly_budget_eur: 100,
    hard_cap_eur: 200,
    voice_template: 'Ton direct, tech-first',
    pitch_language: 'vous',
    ...overrides
  };
  storage.db.prepare(`
    INSERT INTO clients (id, name, industry, icp, patterns, min_score, monthly_lead_cap, status, claude_brain_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET claude_brain_config = excluded.claude_brain_config
  `).run(id, `Tenant ${id}`, 'b2b-saas', '{}', null, 7.0, 500, 'active', JSON.stringify(cfg));
}

function seedCompanyAndMatch(storage, siren = '123456789') {
  storage.upsertCompany({
    siren,
    raison_sociale: 'Acme Test SAS',
    naf_code: '62.01Z',
    naf_label: 'Programmation informatique',
    effectif_min: 10,
    effectif_max: 50,
    departement: '75'
  });
  storage.insertEvent({
    source: 'rodz',
    event_type: 'funding',
    siren,
    raw_data: { amount: '5M' },
    event_date: new Date().toISOString().slice(0, 10)
  });
  // Insert the pattern definition so the FK in patterns_matched resolves
  storage.upsertPattern({
    id: 'funding-recent',
    name: 'Funding recent',
    description: 'Test',
    min_score: 7.0,
    definition: {}
  });
  storage.insertPatternMatch({
    siren,
    pattern_id: 'funding-recent',
    score: 9.0,
    signals: ['rodz-funding'],
    window_start: new Date().toISOString(),
    window_end: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  });
}

module.exports = { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch };
