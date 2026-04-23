'use strict';

/**
 * Tests J2 — Cache + Budget dispatch + Context-builder par pipeline + AnthropicClient wrapper.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const {
  markEphemeral, buildCachedMessages, extractUsage, cacheHitRate, MIN_CACHEABLE_TOKENS
} = require('../cache');
const { BudgetTracker } = require('../budget');
const { ContextBuilder, PIPELINE_WINDOWS_DAYS, MAX_DATA_CONTEXT_CHARS } = require('../context-builder');
const {
  callAnthropic, resolveModel, parseJsonStrict, extractText, MODEL_MAP, DEFAULT_MODEL
} = require('../anthropic-client');

// ───── Cache ─────

test('J2 cache — markEphemeral ajoute cache_control', () => {
  const block = { type: 'text', text: 'hello' };
  const marked = markEphemeral(block);
  assert.deepEqual(marked.cache_control, { type: 'ephemeral' });
  // Original non muté
  assert.equal(block.cache_control, undefined);
});

test('J2 cache — buildCachedMessages structure API Anthropic', () => {
  const bigSystem = 'x'.repeat(MIN_CACHEABLE_TOKENS * 4 + 100);
  const bigVoice = 'y'.repeat(MIN_CACHEABLE_TOKENS * 4 + 100);
  const { system, messages } = buildCachedMessages({
    systemPrompt: bigSystem,
    voicePrompt: bigVoice,
    dataContext: 'z'.repeat(100)
  });
  assert.equal(system.length, 2);
  assert.equal(system[0].type, 'text');
  assert.equal(system[0].cache_control?.type, 'ephemeral');
  assert.equal(system[1].cache_control?.type, 'ephemeral');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  // Data context NON caché
  assert.equal(messages[0].content[0].cache_control, undefined);
});

test('J2 cache — buildCachedMessages ne cache pas les petits blocs', () => {
  const { system } = buildCachedMessages({
    systemPrompt: 'tiny',
    voicePrompt: 'tiny2',
    dataContext: 'data'
  });
  // Trop petit pour être cachable
  assert.equal(system[0].cache_control, undefined);
  assert.equal(system[1].cache_control, undefined);
});

test('J2 cache — enableCache=false désactive', () => {
  const big = 'x'.repeat(MIN_CACHEABLE_TOKENS * 4 + 100);
  const { system } = buildCachedMessages(
    { systemPrompt: big, voicePrompt: big, dataContext: 'data' },
    { enableCache: false }
  );
  assert.equal(system[0].cache_control, undefined);
});

test('J2 cache — extractUsage parse les 4 champs Anthropic', () => {
  const response = {
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 2000
    }
  };
  const u = extractUsage(response);
  assert.equal(u.inputTokens, 100 + 1000 + 2000);
  assert.equal(u.outputTokens, 50);
  assert.equal(u.cachedTokens, 2000);
  assert.equal(u.cacheCreationTokens, 1000);
});

test('J2 cache — cacheHitRate calc', () => {
  assert.equal(cacheHitRate({ inputTokens: 1000, cachedTokens: 900 }), 0.9);
  assert.equal(cacheHitRate({ inputTokens: 0 }), 0);
  assert.equal(cacheHitRate(null), 0);
});

// ───── Budget avec Telegram dispatch ─────

test('J2 budget — dispatch Telegram sur soft threshold', (t) => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { monthly_budget_eur: 10, hard_cap_eur: 20 });
    const b = new BudgetTracker(storage.db);
    const calls = [];
    b.setTelegramModule({
      sendTelegram: async (token, chatId, msg) => {
        calls.push({ token, chatId, msg });
        return { ok: true };
      }
    });
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.ADMIN_CHAT_ID = '999';
    b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 1_000_000, outputTokens: 10_000, model: 'claude-opus-4-7' });
    assert.ok(calls.length >= 1, 'Telegram dispatch appelé');
    assert.ok(calls[0].msg.includes('t1'));
  } finally {
    cleanupStorage(storage, dbPath);
    delete process.env.TELEGRAM_BOT_TOKEN;
  }
});

test('J2 budget — hard limit pause tenant', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { monthly_budget_eur: 5, hard_cap_eur: 10 });
    const b = new BudgetTracker(storage.db);
    b.setTelegramModule({ sendTelegram: async () => ({ ok: true }) });
    // Dépasse hard : 1M tokens = ~13.5€
    b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 1_000_000, outputTokens: 0, model: 'claude-opus-4-7' });
    const cfg = JSON.parse(storage.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get('t1').claude_brain_config);
    assert.equal(cfg.enabled, false, 'tenant paused');
    assert.ok(cfg.paused_reason);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J2 budget — alertes dedupées (pas de spam)', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { monthly_budget_eur: 10, hard_cap_eur: 20 });
    const b = new BudgetTracker(storage.db);
    const calls = [];
    b.setTelegramModule({
      sendTelegram: async (token, chatId, msg) => { calls.push(msg); return { ok: true }; }
    });
    process.env.TELEGRAM_BOT_TOKEN = 'test';
    // 3 usages qui dépassent tous le soft
    b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 800_000, outputTokens: 100, model: 'claude-opus-4-7' });
    b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 100_000, outputTokens: 100, model: 'claude-opus-4-7' });
    b.recordUsage({ tenantId: 't1', pipeline: 'qualify', inputTokens: 100_000, outputTokens: 100, model: 'claude-opus-4-7' });
    // Une seule alerte soft doit avoir été envoyée
    const softAlerts = calls.filter(m => m.includes('SOFT'));
    assert.ok(softAlerts.length <= 1, `${softAlerts.length} soft alerts (attendu: 0 ou 1)`);
  } finally {
    cleanupStorage(storage, dbPath);
    delete process.env.TELEGRAM_BOT_TOKEN;
  }
});

// ───── Context-builder par pipeline ─────

test('J2 context-builder — fenêtre qualify=90j', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', '123456789', 'qualify');
    assert.equal(ctx.dataContext.window_days, 90);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J2 context-builder — fenêtre brief=1825j (5 ans)', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', '123456789', 'brief');
    assert.equal(ctx.dataContext.window_days, 1825);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J2 context-builder — pitch inclut qualification précédente', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '123456789');
    // Stocker une qualif précédente
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run('t1', 'qualify', '123456789', JSON.stringify({ phase: 'scale-up', angle: 'test' }), 'claude-opus-4-7');
    const cb = new ContextBuilder(storage.db);
    const ctx = cb.build('t1', '123456789', 'pitch');
    assert.ok(ctx.dataContext.qualification);
    assert.equal(ctx.dataContext.qualification.phase, 'scale-up');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J2 context-builder — renderDataContext tronque à MAX_DATA_CONTEXT_CHARS', () => {
  const cb = new ContextBuilder(null);
  // Fake context énorme
  const fakeCtx = {
    company: { siren: '1', raison_sociale: 'X', naf: 'A', effectif: 1, departement: '75' },
    events_count: 1000,
    events_summary: 'X'.repeat(MAX_DATA_CONTEXT_CHARS * 2),
    active_matches: 'foo',
    contacts_count: 0,
    contacts_summary: 'none',
    window_days: 90
  };
  const rendered = cb.renderDataContext(fakeCtx);
  assert.ok(rendered.length <= MAX_DATA_CONTEXT_CHARS + 200);
  assert.ok(rendered.includes('tronqué'));
});

test('J2 context-builder — renderDataContextForLog ne fuite pas emails', () => {
  const cb = new ContextBuilder(null);
  const fakeCtx = {
    company: { siren: '123', raison_sociale: 'X', naf: '', effectif: 1, departement: '75' },
    events_count: 5,
    contacts_count: 2,
    active_matches: 'a, b'
  };
  const log = cb.renderDataContextForLog(fakeCtx);
  assert.ok(log.includes('siren=123'));
  assert.ok(!log.includes('@'));
});

// ───── Anthropic client ─────

test('J2 anthropic-client — resolveModel mapping', () => {
  assert.equal(resolveModel('opus'), 'claude-opus-4-7');
  assert.equal(resolveModel('sonnet'), 'claude-sonnet-4-6');
  assert.equal(resolveModel('haiku'), 'claude-haiku-4-5-20251001');
  assert.equal(resolveModel('claude-opus-4-7'), 'claude-opus-4-7');
  assert.equal(resolveModel(null), DEFAULT_MODEL);
  assert.equal(resolveModel('unknown-model'), DEFAULT_MODEL); // fallback
});

test('J2 anthropic-client — parseJsonStrict pure JSON', () => {
  const r = parseJsonStrict('{"phase":"scale-up","score":9}');
  assert.equal(r.phase, 'scale-up');
});

test('J2 anthropic-client — parseJsonStrict extrait JSON enrobé', () => {
  const r = parseJsonStrict('Voici la réponse :\n{"phase":"scale-up"}\n\nFin.');
  assert.equal(r.phase, 'scale-up');
});

test('J2 anthropic-client — parseJsonStrict rejette si pas de JSON', () => {
  assert.throws(() => parseJsonStrict('pas de json du tout'));
});

test('J2 anthropic-client — extractText combine plusieurs blocs text', () => {
  const response = {
    content: [
      { type: 'text', text: 'part1' },
      { type: 'text', text: 'part2' },
      { type: 'tool_use', id: 'x' }
    ]
  };
  assert.equal(extractText(response), 'part1\npart2');
});

test('J2 anthropic-client — callAnthropic avec SDK mocké', async () => {
  const fakeSdk = {
    messages: {
      create: async (args) => ({
        content: [{ type: 'text', text: '{"phase":"scale-up","priority_score_opus":9}' }],
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500 }
      })
    }
  };
  const r = await callAnthropic({
    systemPrompt: 'x'.repeat(5000),
    voicePrompt: 'Tenant Test',
    dataContext: 'SIREN 123',
    json: true,
    sdk: fakeSdk
  });
  assert.equal(r.result.phase, 'scale-up');
  assert.equal(r.usage.cachedTokens, 500);
  assert.ok(r.latency_ms >= 0);
});

test('J2 anthropic-client — callAnthropic retry sur parse JSON fail', async () => {
  let callCount = 0;
  const fakeSdk = {
    messages: {
      create: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ type: 'text', text: 'pas du json' }],
            usage: { input_tokens: 10, output_tokens: 5 }
          };
        }
        return {
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 50, output_tokens: 5 }
        };
      }
    }
  };
  const r = await callAnthropic({
    systemPrompt: 'sys', voicePrompt: 'voice', dataContext: 'data',
    json: true, sdk: fakeSdk
  });
  assert.equal(callCount, 2, 'retry effectué');
  assert.equal(r.result.ok, true);
  assert.equal(r.usage.inputTokens, 60, 'usage cumulé des 2 appels');
});

test('J2 anthropic-client — MODEL_MAP contient opus/sonnet/haiku', () => {
  assert.ok(MODEL_MAP.opus);
  assert.ok(MODEL_MAP.sonnet);
  assert.ok(MODEL_MAP.haiku);
});
