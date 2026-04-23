'use strict';

/**
 * Tests J1 — Claude Brain scaffolding.
 * - Migrations appliquées (tables existent, colonnes ajoutées)
 * - Queue enqueue + dedup fonctionnels
 * - Budget canSpend + recordUsage fonctionnels
 * - Context builder produit un contexte valide
 * - ClaudeBrain no-op quand disabled
 */

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const { ClaudeBrain } = require('../index');
const { ClaudeBrainQueue, makeIdempotencyKey } = require('../queue');
const { BudgetTracker, calcCostEur } = require('../budget');
const { ContextBuilder } = require('../context-builder');

// ───── Migrations ─────

test('J1 migrations — tables claude_brain_* existent', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const tables = storage.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'claude_brain%' ORDER BY name"
    ).all().map(t => t.name);
    assert.ok(tables.includes('claude_brain_queue'));
    assert.ok(tables.includes('claude_brain_results'));
    assert.ok(tables.includes('claude_brain_usage'));
    assert.ok(tables.includes('claude_brain_budget_alerts'));
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 migrations — clients.claude_brain_config + client_leads.opus_score', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const clientCols = storage.db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
    assert.ok(clientCols.includes('claude_brain_config'));
    const leadCols = storage.db.prepare("PRAGMA table_info(client_leads)").all().map(c => c.name);
    assert.ok(leadCols.includes('opus_score'));
    assert.ok(leadCols.includes('opus_qualified_at'));
    assert.ok(leadCols.includes('opus_result_id'));
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Queue ─────

test('J1 queue — enqueue + dedup idempotency', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const q = new ClaudeBrainQueue(storage.db);
    const r1 = q.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '123' });
    assert.equal(r1.enqueued, true);
    const r2 = q.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '123' });
    assert.equal(r2.enqueued, false);
    assert.equal(r2.reason, 'duplicate');
    assert.equal(r2.id, r1.id);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 queue — claim atomique + complete/fail', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const q = new ClaudeBrainQueue(storage.db);
    q.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '999' });
    const job1 = q.claim('worker-A');
    assert.ok(job1);
    assert.equal(job1.status, 'claimed');
    const job2 = q.claim('worker-B');
    assert.equal(job2, null, 'no pending job remaining');
    q.complete(job1.id);
    const stats = q.stats();
    const completed = stats.find(s => s.status === 'completed');
    assert.equal(completed?.n, 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 queue — fail requeue avec backoff', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const q = new ClaudeBrainQueue(storage.db);
    const r = q.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '777', max_retries: 2 });
    const job = q.claim('w1');
    q.fail(job.id, new Error('first fail'));
    const after = storage.db.prepare('SELECT status, retry_count FROM claude_brain_queue WHERE id = ?').get(r.id);
    assert.equal(after.status, 'pending');
    assert.equal(after.retry_count, 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 queue — dead letter après max_retries', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const q = new ClaudeBrainQueue(storage.db);
    const r = q.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '888', max_retries: 2 });
    for (let i = 0; i < 3; i++) {
      // On force status=pending puis claim+fail
      storage.db.prepare("UPDATE claude_brain_queue SET status='pending', scheduled_at=datetime('now') WHERE id=?").run(r.id);
      const j = q.claim('w' + i);
      if (j) q.fail(j.id, new Error('fail ' + i));
    }
    const after = storage.db.prepare('SELECT status, retry_count FROM claude_brain_queue WHERE id = ?').get(r.id);
    assert.equal(after.status, 'dead');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 queue — idempotency key deterministic', () => {
  const k1 = makeIdempotencyKey({ tenant_id: 't1', pipeline: 'qualify', siren: '123' });
  const k2 = makeIdempotencyKey({ tenant_id: 't1', pipeline: 'qualify', siren: '123' });
  const k3 = makeIdempotencyKey({ tenant_id: 't1', pipeline: 'qualify', siren: '124' });
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});

// ───── Budget ─────

test('J1 budget — calcCostEur opus', () => {
  const c = calcCostEur({ model: 'claude-opus-4-7', inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 });
  // 15 USD × 0.90 EUR/USD = 13.50 EUR pour 1M input tokens
  assert.ok(c > 13 && c < 14);
  const cached = calcCostEur({ model: 'claude-opus-4-7', inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 });
  // 100% cached = 1.50 USD × 0.90 = 1.35 EUR
  assert.ok(cached < 1.5);
});

test('J1 budget — canSpend respecte hard limit', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { monthly_budget_eur: 50, hard_cap_eur: 100 });
    const b = new BudgetTracker(storage.db);
    const r1 = b.canSpend('t1', 1);
    assert.equal(r1.ok, true);
    // simuler 99€ dépensés
    b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 7_000_000, outputTokens: 100, model: 'claude-opus-4-7' });
    const spent = b.getMonthlySpend('t1');
    assert.ok(spent > 80);
    const r2 = b.canSpend('t1', 50);
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'hard_limit_reached');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 budget — alertes soft + hard', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { monthly_budget_eur: 10, hard_cap_eur: 20 });
    const b = new BudgetTracker(storage.db);
    // Premier usage : sous seuil
    let r = b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 100_000, outputTokens: 100, model: 'claude-opus-4-7' });
    assert.equal(r.alert, null);
    // Grosse dépense : trigger soft puis hard
    r = b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 1_000_000, outputTokens: 10_000, model: 'claude-opus-4-7' });
    assert.ok(r.alert);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Context Builder ─────

test('J1 context-builder — build lead context valide', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', '123456789', 'qualify');
    assert.ok(ctx.systemPrompt.includes('qualify') || ctx.systemPrompt.includes('QUALIFY'));
    assert.ok(ctx.voicePrompt.includes('Tenant t1'));
    assert.equal(ctx.dataContext.company.siren, '123456789');
    assert.ok(ctx.dataContext.events_count >= 1);
    assert.equal(ctx.meta.tenantId, 't1');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 context-builder — renderDataContext produit un string compact', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '987654321');
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', '987654321', 'qualify');
    const rendered = cb.renderDataContext(ctx.dataContext);
    assert.ok(rendered.includes('987654321'));
    assert.ok(rendered.includes('Acme Test'));
    assert.ok(rendered.length < 10_000);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── ClaudeBrain ─────

test('J1 ClaudeBrain — no-op quand disabled', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    const cb = new ClaudeBrain(storage, { enabled: false, log: { info: () => {}, warn: () => {}, error: () => {} } });
    cb.start();
    const r = cb.enqueueQualify('t1', '123');
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'disabled');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 ClaudeBrain — enqueue quand enabled + tenant config ok', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '111222333');
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} } });
    const r = cb.enqueueQualify('t1', '111222333');
    assert.equal(r.enqueued, true);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J1 ClaudeBrain — ensureTenantConfig idempotent', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't2');
    // Remove config
    storage.db.prepare('UPDATE clients SET claude_brain_config = NULL WHERE id = ?').run('t2');
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} } });
    cb.ensureTenantConfig('t2');
    const after = storage.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get('t2');
    assert.ok(after.claude_brain_config);
    const cfg = JSON.parse(after.claude_brain_config);
    assert.equal(cfg.enabled, true);
    // Second call : no-op (ne change pas la config)
    storage.db.prepare('UPDATE clients SET claude_brain_config = ? WHERE id = ?')
      .run('{"enabled":false,"custom":true}', 't2');
    cb.ensureTenantConfig('t2');
    const after2 = storage.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get('t2');
    const cfg2 = JSON.parse(after2.claude_brain_config);
    assert.equal(cfg2.custom, true, 'config existante non écrasée');
  } finally { cleanupStorage(storage, dbPath); }
});
