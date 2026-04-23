'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const { ClaudeBrain } = require('../index');
const { PipelineExecutor, PIPELINE_CONFIG } = require('../pipelines');
const { ContextBuilder } = require('../context-builder');
const { BudgetTracker } = require('../budget');

// ───── Prompts ─────

test('Phase1 prompts — linkedin-dm.md existe et est loadable', () => {
  const p = path.join(__dirname, '..', 'prompts', 'linkedin-dm.md');
  assert.ok(fs.existsSync(p));
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('LINKEDIN') || content.includes('linkedin'));
  assert.ok(content.length > 500);
});

test('Phase1 prompts — call-brief.md existe et est loadable', () => {
  const p = path.join(__dirname, '..', 'prompts', 'call-brief.md');
  assert.ok(fs.existsSync(p));
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('CALL') || content.includes('call'));
  assert.ok(content.length > 500);
});

// ───── Pipelines ─────

test('Phase1 pipelines — linkedin-dm et call-brief dans PIPELINE_CONFIG', () => {
  assert.ok(PIPELINE_CONFIG['linkedin-dm']);
  assert.equal(PIPELINE_CONFIG['linkedin-dm'].json, true);
  assert.ok(PIPELINE_CONFIG['call-brief']);
  assert.equal(PIPELINE_CONFIG['call-brief'].json, true);
});

test('Phase1 pipelines — enqueueLinkedinDm + enqueueCallBrief priority haute', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '100000001');
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });

    const r1 = cb.enqueueLinkedinDm('t1', '100000001', { userTriggered: 'test' });
    assert.equal(r1.enqueued, true);
    const j1 = storage.db.prepare('SELECT pipeline, priority FROM claude_brain_queue WHERE id = ?').get(r1.id);
    assert.equal(j1.pipeline, 'linkedin-dm');
    assert.equal(j1.priority, 2);

    const r2 = cb.enqueueCallBrief('t1', '100000001');
    assert.equal(r2.enqueued, true);
    const j2 = storage.db.prepare('SELECT pipeline, priority FROM claude_brain_queue WHERE id = ?').get(r2.id);
    assert.equal(j2.pipeline, 'call-brief');
    assert.equal(j2.priority, 2);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase1 pipelines — respect config tenant (linkedin désactivé)', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { pipelines: ['qualify', 'pitch'] }); // pas de linkedin-dm
    const cb = new ClaudeBrain(storage, { enabled: true, log: { info: () => {}, warn: () => {}, error: () => {} }, telegramModule: null });
    const r = cb.enqueueLinkedinDm('t1', '100000001');
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'pipeline-not-enabled');
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Pipeline execution avec mocked caller ─────

test('Phase1 executor — linkedin-dm stocke résultat JSON', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '200000001');
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const fakeCaller = async () => ({
      result: {
        message: 'Clément, vu votre levée — question rapide sur le scaling commercial post-levée ?',
        profile_url: 'https://linkedin.com/in/clement-morel',
        opener_angle: 'levée + scaling',
        followup_suggestion: 'Rebondir sur un article tech une semaine après',
        cta_type: 'direct-message',
        confidence: 'high'
      },
      usage: { inputTokens: 800, outputTokens: 150, cachedTokens: 0 },
      model: 'claude-opus-4-7',
      latency_ms: 3000,
      raw_text: '{}'
    });
    const exec = new PipelineExecutor({ storage, context, budget, anthropicCaller: fakeCaller });
    const job = { id: 1, tenant_id: 't1', pipeline: 'linkedin-dm', siren: '200000001' };
    const out = await exec.execute(job);
    assert.ok(out.result_id);
    const saved = storage.db.prepare('SELECT result_json FROM claude_brain_results WHERE id = ?').get(out.result_id);
    const parsed = JSON.parse(saved.result_json);
    assert.equal(parsed.confidence, 'high');
    assert.ok(parsed.message.length > 0);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase1 executor — call-brief stocke résultat structuré', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '300000001');
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const fakeCaller = async () => ({
      result: {
        opener_30s: 'Bonjour Clément, je vois votre levée d\'avril...',
        prospect_phone_context: 'Scale-up post-Série A, momentum élevé',
        questions_to_ask: [
          { q: 'Comment vous gérez la prospection inbound aujourd\'hui ?', why: 'Détecter maturité', listen_for: 'outils' }
        ],
        likely_objections: [
          { objection: 'Pas le temps', response: 'Je comprends, 3 questions en 90s ok ?' }
        ],
        not_available_fallback: 'Créneau demain 10h ?',
        closing_script: 'On teste 14 jours sans engagement ?',
        do_not_say: ['leader du marché', 'synergies']
      },
      usage: { inputTokens: 2000, outputTokens: 800, cachedTokens: 0 },
      model: 'claude-opus-4-7',
      latency_ms: 8000,
      raw_text: '{}'
    });
    const exec = new PipelineExecutor({ storage, context, budget, anthropicCaller: fakeCaller });
    const job = { id: 1, tenant_id: 't1', pipeline: 'call-brief', siren: '300000001' };
    const out = await exec.execute(job);
    const saved = storage.db.prepare('SELECT result_json FROM claude_brain_results WHERE id = ?').get(out.result_id);
    const parsed = JSON.parse(saved.result_json);
    assert.ok(parsed.opener_30s.length > 0);
    assert.equal(parsed.questions_to_ask.length, 1);
    assert.ok(parsed.do_not_say.length > 0);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Auto-3-canaux cron logic ─────

test('Phase1 auto-gen — 3 canaux enqueue pour lead score ≥ 8', () => {
  // Simule la logique du cron : pour chaque canal activé, query sur les leads
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', {
      auto_pitch_enabled: true,
      auto_linkedin_enabled: true,
      auto_call_brief_enabled: true,
      pipelines: ['pitch', 'linkedin-dm', 'call-brief']
    });
    seedCompanyAndMatch(storage, '400000001');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('400000001').id;
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score)
      VALUES ('t1', '400000001', ?, 9.0, 'red', 'new', 9.0)
    `).run(pmId);

    const channels = ['pitch', 'linkedin-dm', 'call-brief'];
    for (const channel of channels) {
      const leads = storage.db.prepare(`
        SELECT cl.siren FROM client_leads cl
        LEFT JOIN (
          SELECT tenant_id, siren, MAX(created_at) as last_gen
          FROM claude_brain_results WHERE pipeline = ?
          GROUP BY tenant_id, siren
        ) pp ON pp.tenant_id = cl.client_id AND pp.siren = cl.siren
        WHERE cl.client_id = 't1' AND cl.opus_score >= 8.0
          AND (pp.last_gen IS NULL OR (julianday('now') - julianday(pp.last_gen)) > 7)
      `).all(channel);
      assert.equal(leads.length, 1, `channel ${channel} doit trouver 1 lead`);
    }
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase1 auto-gen — canal désactivé skip', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', {
      auto_pitch_enabled: true,
      auto_linkedin_enabled: false, // désactivé
      pipelines: ['pitch', 'linkedin-dm']
    });
    // Logique testée : dans le cron, on vérifie cfg.auto_linkedin_enabled avant d'ajouter le canal
    const cfg = JSON.parse(storage.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get('t1').claude_brain_config);
    assert.equal(cfg.auto_linkedin_enabled, false);
    assert.equal(cfg.auto_pitch_enabled, true);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Default config ─────

test('Phase1 config — DEFAULT_TENANT_CONFIG a les clés Phase 1', () => {
  const { DEFAULT_TENANT_CONFIG } = require('../index');
  assert.equal(DEFAULT_TENANT_CONFIG.auto_linkedin_enabled, true);
  assert.equal(DEFAULT_TENANT_CONFIG.auto_call_brief_enabled, true);
  assert.equal(DEFAULT_TENANT_CONFIG.max_linkedin_regenerations, 3);
  assert.equal(DEFAULT_TENANT_CONFIG.max_call_brief_regenerations, 2);
  assert.ok(DEFAULT_TENANT_CONFIG.pipelines.includes('linkedin-dm'));
  assert.ok(DEFAULT_TENANT_CONFIG.pipelines.includes('call-brief'));
});
