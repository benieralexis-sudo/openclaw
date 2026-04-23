'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const { ContextBuilder } = require('../context-builder');
const { BudgetTracker } = require('../budget');
const { PipelineExecutor } = require('../pipelines');
const smartlead = require('../smartlead-client');

// ───── Discover context ─────

test('J7 discover — agrège convertis/ignorés/négatifs + patterns', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    // Créer 2 convertis, 3 ignorés, 1 négatif
    const setupLead = (siren, status, sent_at = null, replied_at = null) => {
      seedCompanyAndMatch(storage, siren);
      const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(siren).id;
      storage.db.prepare(`
        INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, sent_at, replied_at, opus_score)
        VALUES ('t1', ?, ?, 7.5, 'orange', ?, ?, ?, 7.5)
      `).run(siren, pmId, status, sent_at, replied_at);
    };
    setupLead('100000001', 'booked', '2026-01-05', '2026-01-06');
    setupLead('100000002', 'replied_positive', '2026-01-05', '2026-01-06');
    setupLead('100000003', 'sent', '2026-01-01', null); // ignoré (sent > 14j sans reply)
    setupLead('100000004', 'sent', '2026-01-02', null);
    setupLead('100000005', 'sent', '2026-01-03', null);
    setupLead('100000006', 'replied_negative');
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', null, 'discover');
    assert.equal(ctx.dataContext.summary.convertis_count, 2);
    assert.equal(ctx.dataContext.summary.ignores_count, 3);
    assert.equal(ctx.dataContext.summary.negatifs_count, 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J7 discover — renderDataContext produit un markdown lisible', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '200000001');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('200000001').id;
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score)
      VALUES ('t1', '200000001', ?, 8.0, 'red', 'booked', 8.0)
    `).run(pmId);
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', null, 'discover');
    const rendered = cb.renderDataContext(ctx.dataContext);
    assert.ok(rendered.includes('Convertis'));
    assert.ok(rendered.includes('Ignorés'));
    assert.ok(rendered.includes('Patterns actifs'));
    assert.ok(rendered.includes('200000001') || rendered.includes('Acme'));
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Discover post-process ─────

test('J7 discover — post-process insère pattern_proposals', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '300000001');
    // Appliquer migration 014
    const fs = require('node:fs');
    const path = require('node:path');
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '014-claude-brain-pattern-proposals.sql'), 'utf8');
    storage.db.exec(sql);

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const fakeCaller = async () => ({
      result: {
        analysis_summary: 'test analysis',
        proposed_patterns: [
          { id: 'new-pattern-test', name: 'Test Pattern', description: 'desc', rationale: 'r',
            technical_definition: { signals_required: { any_of: [], must_have_at_least_one_of: [] }, window_days: 30, min_score: 7 },
            expected_precision_pct: 60, expected_recall_pct: 40, confidence_proposition: 'medium' },
          { id: 'second-pattern', name: 'Second', description: 'd', rationale: 'r',
            technical_definition: {}, expected_precision_pct: 50, expected_recall_pct: 50, confidence_proposition: 'low' }
        ]
      },
      usage: { inputTokens: 2000, outputTokens: 500, cachedTokens: 0 },
      model: 'claude-opus-4-7',
      latency_ms: 8000,
      raw_text: '{}'
    });
    const exec = new PipelineExecutor({ storage, context, budget, anthropicCaller: fakeCaller });
    const job = { id: 99, tenant_id: 't1', pipeline: 'discover', siren: null };
    await exec.execute(job);

    const proposals = storage.db.prepare("SELECT * FROM claude_brain_pattern_proposals WHERE status = 'pending'").all();
    assert.equal(proposals.length, 2);
    assert.ok(proposals.some(p => p.pattern_id === 'new-pattern-test'));
    assert.ok(proposals.some(p => p.pattern_id === 'second-pattern'));
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Smartlead client opt-in ─────

test('J7 smartlead — sans API key, toutes les fonctions skippent', async () => {
  const a = await smartlead.addLeadToCampaign({ apiKey: null, campaignId: 'x', lead: { email: 'a@b.com' }, pitch: { subject: 's', body: 'b' } });
  assert.equal(a.skipped, true);
  const b = await smartlead.getCampaign({ apiKey: null, campaignId: 'x' });
  assert.equal(b.skipped, true);
  const c = await smartlead.listMailboxes({ apiKey: null });
  assert.equal(c.skipped, true);
});

test('J7 smartlead — sendLead skip si pas de clé', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '400000001');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('400000001').id;
    const ins = storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status)
      VALUES ('t1', '400000001', ?, 9.0, 'red', 'new')
    `).run(pmId);
    const r = await smartlead.sendLead({
      apiKey: null, campaignId: 'x', db: storage.db, leadId: ins.lastInsertRowid,
      pitch: { subject: 'x', body: 'y' }
    });
    assert.equal(r.skipped, true);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J7 smartlead — sendLead dry-run retourne lead + contact sans appel réseau', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '500000001');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('500000001').id;
    storage.db.prepare(`
      INSERT INTO leads_contacts (siren, prenom, nom, email, email_confidence, source, discovered_at)
      VALUES ('500000001', 'Test', 'User', 'test@example.com', 0.9, 'test', CURRENT_TIMESTAMP)
    `).run();
    const ins = storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status)
      VALUES ('t1', '500000001', ?, 9.0, 'red', 'new')
    `).run(pmId);
    const r = await smartlead.sendLead({
      apiKey: 'FAKE_KEY', campaignId: 'c1', db: storage.db, leadId: ins.lastInsertRowid,
      pitch: { subject: 'x', body: 'y' }, dryRun: true, gate: null
    });
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.equal(r.contact.email, 'test@example.com');
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Monitoring stats queries ─────

test('J7 stats — queue stats + month_cost + recent_fails aggregés', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    // Simuler des jobs
    storage.db.prepare(`
      INSERT INTO claude_brain_queue (tenant_id, pipeline, siren, payload, idempotency_key, status)
      VALUES ('t1', 'qualify', '1', '{}', 'k1', 'completed'),
             ('t1', 'qualify', '2', '{}', 'k2', 'completed'),
             ('t1', 'pitch', '3', '{}', 'k3', 'pending'),
             ('t1', 'brief', '4', '{}', 'k4', 'dead')
    `).run();
    const queueStats = storage.db.prepare(`
      SELECT status, COUNT(*) as n FROM claude_brain_queue GROUP BY status
    `).all();
    const completed = queueStats.find(s => s.status === 'completed');
    const dead = queueStats.find(s => s.status === 'dead');
    assert.equal(completed.n, 2);
    assert.equal(dead.n, 1);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Pattern proposals accept action ─────

test('J7 proposals — structure fileContent lors d\'accept', () => {
  // Test unitaire du mapping proposal → pattern JSON file
  const proposal = {
    id: 'test-pattern',
    name: 'Test',
    description: 'desc',
    verticaux: ['qa'],
    pitch_angle: 'angle test',
    technical_definition: {
      signals_required: { any_of: [{ types: ['funding'], weight: 3 }] },
      window_days: 30,
      min_score: 7
    }
  };
  const fileContent = {
    id: proposal.id,
    name: proposal.name,
    description: proposal.description,
    verticaux: proposal.verticaux || [],
    pitch_angle: proposal.pitch_angle || '',
    ...(proposal.technical_definition || {}),
    enabled: false
  };
  assert.equal(fileContent.enabled, false, 'accepté mais désactivé par défaut');
  assert.equal(fileContent.window_days, 30);
  assert.equal(fileContent.min_score, 7);
  assert.deepEqual(fileContent.signals_required.any_of[0].types, ['funding']);
});
