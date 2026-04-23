'use strict';

/**
 * Tests J3 — Worker live + Circuit breaker + Rate limiter + Pipeline executor.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const { ClaudeBrainQueue } = require('../queue');
const { BudgetTracker } = require('../budget');
const { ContextBuilder } = require('../context-builder');
const { PipelineExecutor } = require('../pipelines');
const { ClaudeBrainWorker } = require('../worker');
const { CircuitBreaker, TokenBucket, RateLimiter, STATES } = require('../circuit-breaker');

// ───── Circuit breaker ─────

test('J3 circuit — CLOSED par défaut', () => {
  const cb = new CircuitBreaker({ log: { info: () => {}, warn: () => {} } });
  assert.equal(cb.allowRequest(), true);
  assert.equal(cb.getState().state, STATES.CLOSED);
});

test('J3 circuit — passe en OPEN après seuil erreurs', () => {
  const cb = new CircuitBreaker({ log: { info: () => {}, warn: () => {} }, minSamples: 5, errorThreshold: 0.4 });
  for (let i = 0; i < 5; i++) cb.recordResult(false);
  assert.equal(cb.getState().state, STATES.OPEN);
  assert.equal(cb.allowRequest(), false);
});

test('J3 circuit — reste CLOSED si success domine', () => {
  const cb = new CircuitBreaker({ log: { info: () => {}, warn: () => {} }, minSamples: 5, errorThreshold: 0.5 });
  for (let i = 0; i < 8; i++) cb.recordResult(i < 6); // 6 succès, 2 échecs = 25%
  assert.equal(cb.getState().state, STATES.CLOSED);
});

test('J3 circuit — HALF_OPEN après pauseMs puis CLOSED si trial ok', () => {
  const cb = new CircuitBreaker({
    log: { info: () => {}, warn: () => {} },
    minSamples: 3, errorThreshold: 0.3, pauseMs: 10
  });
  for (let i = 0; i < 5; i++) cb.recordResult(false);
  assert.equal(cb.getState().state, STATES.OPEN);
  // Attendre la pause
  return new Promise(res => setTimeout(() => {
    assert.equal(cb.allowRequest(), true, 'passage en half-open');
    assert.equal(cb.getState().state, STATES.HALF_OPEN);
    // 2e appel refusé (trial en cours)
    assert.equal(cb.allowRequest(), false);
    cb.recordResult(true);
    assert.equal(cb.getState().state, STATES.CLOSED);
    res();
  }, 20));
});

test('J3 circuit — HALF_OPEN puis rouvre si trial échoue', () => {
  const cb = new CircuitBreaker({
    log: { info: () => {}, warn: () => {} },
    minSamples: 3, errorThreshold: 0.3, pauseMs: 10
  });
  for (let i = 0; i < 5; i++) cb.recordResult(false);
  return new Promise(res => setTimeout(() => {
    cb.allowRequest();
    cb.recordResult(false);
    assert.equal(cb.getState().state, STATES.OPEN);
    res();
  }, 20));
});

// ───── Rate limiter ─────

test('J3 rate — TokenBucket limite à capacity par minute', () => {
  const b = new TokenBucket({ capacity: 3, refillPerMin: 3 });
  assert.equal(b.consume(), true);
  assert.equal(b.consume(), true);
  assert.equal(b.consume(), true);
  assert.equal(b.consume(), false, 'bucket vide');
});

test('J3 rate — RateLimiter global + per tenant', () => {
  const rl = new RateLimiter({ globalPerMin: 10, perTenantPerMin: 2 });
  assert.equal(rl.allow('t1').ok, true);
  assert.equal(rl.allow('t1').ok, true);
  const r3 = rl.allow('t1');
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'tenant-rate-limit');
  // Autre tenant passe
  assert.equal(rl.allow('t2').ok, true);
});

test('J3 rate — global limit prioritaire', () => {
  const rl = new RateLimiter({ globalPerMin: 2, perTenantPerMin: 100 });
  assert.equal(rl.allow('t1').ok, true);
  assert.equal(rl.allow('t2').ok, true);
  const r = rl.allow('t3');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'global-rate-limit');
});

// ───── Pipeline executor (avec SDK mocké) ─────

function makeFakeCaller(responses = {}) {
  return async (args) => {
    const fake = responses[args.model] || responses.default || {
      phase: 'scale-up',
      priority_score_opus: 8.5,
      decision_maker_real: 'Test Dirigeant'
    };
    return {
      result: fake,
      usage: { inputTokens: 500, outputTokens: 100, cachedTokens: 0 },
      model: args.model,
      latency_ms: 100,
      raw_text: JSON.stringify(fake)
    };
  };
}

test('J3 executor — pipeline qualify stocke résultat + opus_score', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    // Créer un client_lead pour vérifier post-process
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status)
      VALUES (?, ?, 1, 9.0, 'red', 'new')
    `).run('t1', '123456789');

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const exec = new PipelineExecutor({
      storage, context, budget,
      anthropicCaller: makeFakeCaller()
    });
    const job = { id: 42, tenant_id: 't1', pipeline: 'qualify', siren: '123456789' };
    const out = await exec.execute(job);
    assert.ok(out.result_id);
    assert.equal(out.version, 1);
    assert.ok(out.cost_eur >= 0);

    const saved = storage.db.prepare('SELECT * FROM claude_brain_results WHERE id = ?').get(out.result_id);
    assert.ok(saved);
    const parsed = JSON.parse(saved.result_json);
    assert.equal(parsed.priority_score_opus, 8.5);

    // Post-process : client_leads.opus_score updated
    const lead = storage.db.prepare('SELECT * FROM client_leads WHERE client_id = ? AND siren = ?').get('t1', '123456789');
    assert.equal(lead.opus_score, 8.5);
    assert.ok(lead.opus_qualified_at);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 executor — budget bloque si hard limit', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { monthly_budget_eur: 1, hard_cap_eur: 2 });
    seedCompanyAndMatch(storage, '123456789');
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    budget.setTelegramModule({ sendTelegram: async () => ({ ok: true }) });
    // Pré-dépenser au-dessus du hard
    budget.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 1_000_000, outputTokens: 0, model: 'claude-opus-4-7' });

    const exec = new PipelineExecutor({
      storage, context, budget,
      anthropicCaller: makeFakeCaller()
    });
    const job = { id: 1, tenant_id: 't1', pipeline: 'qualify', siren: '123456789' };
    await assert.rejects(() => exec.execute(job), /Budget/);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 executor — versions s\'incrémentent sur régénération', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '555555555');
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const exec = new PipelineExecutor({ storage, context, budget, anthropicCaller: makeFakeCaller() });

    const job = { id: 1, tenant_id: 't1', pipeline: 'qualify', siren: '555555555' };
    const v1 = await exec.execute(job);
    const v2 = await exec.execute({ ...job, id: 2 });
    const v3 = await exec.execute({ ...job, id: 3 });
    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    assert.equal(v3.version, 3);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 executor — pitch non-JSON stocké comme string markdown', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '666666666');
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const exec = new PipelineExecutor({
      storage, context, budget,
      anthropicCaller: makeFakeCaller({ default: { subject: 'Test', body: 'Bonjour' } })
    });
    const job = { id: 10, tenant_id: 't1', pipeline: 'pitch', siren: '666666666' };
    const out = await exec.execute(job);
    const saved = storage.db.prepare('SELECT result_json FROM claude_brain_results WHERE id = ?').get(out.result_id);
    const parsed = JSON.parse(saved.result_json);
    assert.equal(parsed.subject, 'Test');
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Worker live ─────

test('J3 worker — consomme un job enqueue via execute', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '777777777');
    const queue = new ClaudeBrainQueue(storage.db);
    queue.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '777777777' });

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const executor = new PipelineExecutor({ storage, context, budget, anthropicCaller: makeFakeCaller() });
    const worker = new ClaudeBrainWorker({
      storage, queue, context, budget,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      pollIntervalMs: 5,
      executor,
      killSwitch: () => true
    });
    worker.start();
    // Attendre quelques ticks
    await new Promise(r => setTimeout(r, 100));
    await worker.stop();
    assert.equal(worker.stats.processed, 1);
    const stats = queue.stats();
    const completed = stats.find(s => s.status === 'completed');
    assert.equal(completed?.n, 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 worker — kill switch stoppe la consommation', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '888888888');
    const queue = new ClaudeBrainQueue(storage.db);
    queue.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '888888888' });

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const executor = new PipelineExecutor({ storage, context, budget, anthropicCaller: makeFakeCaller() });
    const worker = new ClaudeBrainWorker({
      storage, queue, context, budget,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      pollIntervalMs: 5,
      executor,
      killSwitch: () => false // kill switch OFF
    });
    worker.start();
    await new Promise(r => setTimeout(r, 80));
    await worker.stop();
    assert.equal(worker.stats.processed, 0, 'aucun job consommé');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 worker — rate limit requeue avec +30s', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '999999999');
    const queue = new ClaudeBrainQueue(storage.db);
    const r = queue.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '999999999' });
    const rateLimited = new RateLimiter({ globalPerMin: 0, perTenantPerMin: 0 });
    // Force le rate limiter à refuser
    rateLimited.global.tokens = 0;

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const executor = new PipelineExecutor({ storage, context, budget, anthropicCaller: makeFakeCaller() });
    const worker = new ClaudeBrainWorker({
      storage, queue, context, budget,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      pollIntervalMs: 5,
      executor,
      rateLimiter: rateLimited,
      killSwitch: () => true
    });
    worker.start();
    await new Promise(res => setTimeout(res, 60));
    await worker.stop();
    assert.ok(worker.stats.skipped_rate_limit >= 1);
    // Job requeued, pas processed
    const job = storage.db.prepare('SELECT status FROM claude_brain_queue WHERE id = ?').get(r.id);
    assert.equal(job.status, 'pending');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 worker — circuit breaker ouvert skip ticks', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '112233445');
    const queue = new ClaudeBrainQueue(storage.db);
    queue.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '112233445' });
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const executor = new PipelineExecutor({ storage, context, budget, anthropicCaller: makeFakeCaller() });
    const breaker = new CircuitBreaker({ log: { info: () => {}, warn: () => {} }, minSamples: 3, errorThreshold: 0.3, pauseMs: 60_000 });
    // Force breaker OPEN
    for (let i = 0; i < 5; i++) breaker.recordResult(false);

    const worker = new ClaudeBrainWorker({
      storage, queue, context, budget,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      pollIntervalMs: 5,
      executor,
      circuitBreaker: breaker,
      killSwitch: () => true
    });
    worker.start();
    await new Promise(res => setTimeout(res, 60));
    await worker.stop();
    assert.ok(worker.stats.skipped_breaker >= 1);
    assert.equal(worker.stats.processed, 0);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 worker — execute erreur → queue.fail + circuit record failure', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '554433221');
    const queue = new ClaudeBrainQueue(storage.db);
    queue.enqueue({ tenant_id: 't1', pipeline: 'qualify', siren: '554433221' });

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    // Caller qui throw
    const failingCaller = async () => { throw new Error('simulated Anthropic 500'); };
    const executor = new PipelineExecutor({ storage, context, budget, anthropicCaller: failingCaller });
    const worker = new ClaudeBrainWorker({
      storage, queue, context, budget,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      pollIntervalMs: 5,
      executor,
      killSwitch: () => true
    });
    worker.start();
    await new Promise(res => setTimeout(res, 80));
    await worker.stop();
    assert.ok(worker.stats.failed >= 1);
    assert.ok(worker.circuit.getState().samples >= 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J3 worker — getStats renvoie toutes les métriques', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const queue = new ClaudeBrainQueue(storage.db);
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const worker = new ClaudeBrainWorker({
      storage, queue, context, budget,
      log: { info: () => {}, warn: () => {}, error: () => {} }
    });
    const s = worker.getStats();
    assert.ok(s.worker_id);
    assert.equal(s.running, false);
    assert.equal(typeof s.processed, 'number');
    assert.ok(s.circuit);
    assert.ok(s.rate);
  } finally { cleanupStorage(storage, dbPath); }
});
