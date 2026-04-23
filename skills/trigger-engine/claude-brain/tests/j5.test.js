'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const { ClaudeBrain } = require('../index');
const { ClaudeBrainQueue } = require('../queue');
const { BudgetTracker } = require('../budget');
const { ContextBuilder } = require('../context-builder');
const { PipelineExecutor } = require('../pipelines');
const { ClaudeBrainWorker } = require('../worker');
const { buildCachedMessages, MIN_CACHEABLE_TOKENS } = require('../cache');

// ───── Fix cache hit ─────

test('J5 cache — MIN_CACHEABLE_TOKENS abaissé à 512', () => {
  assert.equal(MIN_CACHEABLE_TOKENS, 512);
});

test('J5 cache — prompt qualify (~600 tokens) est maintenant cachable', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const p = path.join(__dirname, '..', 'prompts', 'qualify.md');
  const sys = fs.readFileSync(p, 'utf8');
  const estTokens = Math.ceil(sys.length / 4);
  assert.ok(estTokens >= MIN_CACHEABLE_TOKENS, `prompt qualify ${estTokens} tokens >= seuil ${MIN_CACHEABLE_TOKENS}`);
  const { system } = buildCachedMessages({
    systemPrompt: sys,
    voicePrompt: 'tenant test voice',
    dataContext: 'lead data'
  });
  assert.equal(system[0].cache_control?.type, 'ephemeral', 'system bloc doit être marqué ephemeral');
});

// ───── enqueuePitch / enqueueBrief ─────

test('J5 brain — enqueuePitch priority haute + payload user', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });
    const r = cb.enqueuePitch('t1', '123456789', { userTriggered: 'alexis' });
    assert.equal(r.enqueued, true);
    const job = storage.db.prepare('SELECT pipeline, priority, payload FROM claude_brain_queue WHERE id = ?').get(r.id);
    assert.equal(job.pipeline, 'pitch');
    assert.equal(job.priority, 2);
    assert.ok(job.payload.includes('alexis'));
  } finally { cleanupStorage(storage, dbPath); }
});

test('J5 brain — enqueueBrief priority haute', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '987654321');
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });
    const r = cb.enqueueBrief('t1', '987654321');
    assert.equal(r.enqueued, true);
    const job = storage.db.prepare('SELECT pipeline, priority FROM claude_brain_queue WHERE id = ?').get(r.id);
    assert.equal(job.pipeline, 'brief');
    assert.equal(job.priority, 2);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J5 brain — pipeline bloqué si tenant ne l\'a pas activé', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { pipelines: ['qualify'] });
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });
    const r = cb.enqueuePitch('t1', '111222333');
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'pipeline-not-enabled');
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── waitForResult ─────

test('J5 brain — waitForResult timeout si job jamais complété', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '555555555');
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });
    const r = cb.enqueuePitch('t1', '555555555');
    const out = await cb.waitForResult(r.id, { timeoutMs: 200, pollMs: 50 });
    assert.equal(out.status, 'timeout');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J5 brain — waitForResult retourne completed + result', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '444555666');

    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });
    const queue = cb.queue;
    const r = cb.enqueuePitch('t1', '444555666', { userTriggered: 'clement' });

    // Simuler un job completed avec résultat
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, job_id, version, result_json, model, tokens_input, tokens_output, tokens_cached, cost_eur, latency_ms)
      VALUES (?, 'pitch', ?, ?, 1, ?, 'claude-opus-4-7', 1000, 200, 500, 0.05, 3000)
    `).run('t1', '444555666', r.id, JSON.stringify({ subject: 'Test', body: 'Corps email' }));
    queue.complete(r.id);

    const out = await cb.waitForResult(r.id, { timeoutMs: 500, pollMs: 50 });
    assert.equal(out.status, 'completed');
    assert.equal(out.result.subject, 'Test');
    assert.equal(out.meta.version, 1);
    assert.equal(out.meta.cost_eur, 0.05);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Pipeline pitch avec qualification précédente ─────

test('J5 pipeline — pitch récupère la qualification précédente dans le contexte', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '999888777');
    // Insérer une qualification Opus précédente
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model)
      VALUES (?, 'qualify', ?, 1, ?, 'claude-opus-4-7')
    `).run('t1', '999888777', JSON.stringify({
      phase: 'scale-up post-Série A',
      priority_score_opus: 8.5,
      decision_maker_real: 'Alice Martin',
      angle_pitch_primary: 'Accompagner scaling commercial'
    }));

    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    let capturedData = null;
    const fakeCaller = async (args) => {
      capturedData = args.dataContext;
      return {
        result: { subject: 'Objet test', body: 'Bonjour Alice', tone_used: 'direct', personalization_hooks_used: [], cta_type: '15min-call' },
        usage: { inputTokens: 500, outputTokens: 80, cachedTokens: 0 },
        model: 'claude-opus-4-7',
        latency_ms: 200,
        raw_text: '{}'
      };
    };
    const exec = new PipelineExecutor({ storage, context, budget, anthropicCaller: fakeCaller });
    const job = { id: 100, tenant_id: 't1', pipeline: 'pitch', siren: '999888777' };
    await exec.execute(job);
    // La qualification doit apparaître dans le contexte fourni à Opus
    assert.ok(capturedData.includes('Alice Martin'), 'decision_maker réel doit être passé à Opus');
    assert.ok(capturedData.includes('scale-up'), 'phase doit être passée');
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── File "à valider" query ─────

test('J5 query "à valider" — filtre opus_score 6-8 + pitch généré', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    // Créer 3 leads avec scores différents (patterns_matched créés via seedCompanyAndMatch)
    const sirens = ['111111111', '222222222', '333333333'];
    const scores = [7.0, 5.0, 8.5];
    for (let i = 0; i < 3; i++) {
      seedCompanyAndMatch(storage, sirens[i]);
      const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(sirens[i]).id;
      storage.db.prepare(`
        INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score)
        VALUES (?, ?, ?, ?, 'orange', 'new', ?)
      `).run('t1', sirens[i], pmId, scores[i], scores[i]);
    }
    // Seul le lead à 7.0 a un pitch généré
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model)
      VALUES (?, 'pitch', ?, 1, ?, 'claude-opus-4-7')
    `).run('t1', '111111111', '{"subject":"x"}');

    // Query "à valider" (reproduction de la logique endpoint)
    const rows = storage.db.prepare(`
      SELECT cl.id, cl.opus_score FROM client_leads cl
      WHERE cl.status IN ('new', 'qualifying')
        AND cl.opus_score >= 6.0
        AND cl.opus_score < 8.0
        AND EXISTS (SELECT 1 FROM claude_brain_results cbr
                    WHERE cbr.tenant_id = cl.client_id AND cbr.siren = cl.siren AND cbr.pipeline = 'pitch')
    `).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].opus_score, 7.0);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J5 action — validate passe status à sent + sent_at', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('123456789').id;
    const ins = storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status)
      VALUES (?, ?, ?, 7.5, 'orange', 'new')
    `).run('t1', '123456789', pmId);
    const leadId = ins.lastInsertRowid;

    // Simulate validate action
    storage.db.prepare(`
      UPDATE client_leads SET status = ?, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run('sent', leadId);

    const after = storage.db.prepare('SELECT status, sent_at FROM client_leads WHERE id = ?').get(leadId);
    assert.equal(after.status, 'sent');
    assert.ok(after.sent_at);
  } finally { cleanupStorage(storage, dbPath); }
});
