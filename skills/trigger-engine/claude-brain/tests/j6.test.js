'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const { AutoSendGate, CONTACT_BLACKOUT_DAYS, REPLY_RATE_MIN } = require('../auto-send-gate');
const { PipelineExecutor } = require('../pipelines');
const { ContextBuilder } = require('../context-builder');
const { BudgetTracker } = require('../budget');

// Helper : créer un lead + contact dispo
function setupReadyLead(storage, opts = {}) {
  seedTenant(storage, 't1', opts.tenantOverrides || {});
  const siren = opts.siren || '123456789';
  seedCompanyAndMatch(storage, siren);
  const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(siren).id;
  const ins = storage.db.prepare(`
    INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score)
    VALUES (?, ?, ?, 8.5, 'red', 'new', ?)
  `).run('t1', siren, pmId, opts.opus_score ?? 9.0);
  const leadId = ins.lastInsertRowid;
  if (opts.withContact !== false) {
    storage.db.prepare(`
      INSERT INTO leads_contacts (siren, prenom, nom, fonction, email, email_confidence, email_source, source, discovered_at)
      VALUES (?, 'Alice', 'Martin', 'DG', 'alice@${siren}.com', ?, ?, 'test', CURRENT_TIMESTAMP)
    `).run(siren, opts.confidence ?? 0.95, opts.emailSource ?? 'dropcontact-verified');
  }
  return { leadId, siren };
}

function mondayAt11() { const d = new Date(); d.setFullYear(2026, 0, 5); d.setHours(11, 0, 0, 0); return d; } // lundi 5 janvier 2026 11h

// ───── Brief pipeline ─────

test('J6 brief — pipeline stocke résultat markdown', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const context = new ContextBuilder(storage.db);
    const budget = new BudgetTracker(storage.db);
    const fakeCaller = async () => ({
      result: '# Brief Test\n## Section 1\nContenu markdown',
      usage: { inputTokens: 10000, outputTokens: 2000, cachedTokens: 5000 },
      model: 'claude-opus-4-7',
      latency_ms: 15000,
      raw_text: '# Brief Test'
    });
    const exec = new PipelineExecutor({ storage, context, budget, anthropicCaller: fakeCaller });
    const job = { id: 50, tenant_id: 't1', pipeline: 'brief', siren: '123456789' };
    const out = await exec.execute(job);
    assert.ok(out.result_id);
    const r = storage.db.prepare('SELECT result_json FROM claude_brain_results WHERE id = ?').get(out.result_id);
    assert.ok(r.result_json.includes('# Brief Test'));
    assert.ok(r.result_json.includes('## Section 1'));
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── AutoSendGate — 8 règles ─────

test('J6 gate — tout passe sur lead idéal', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, true, `fail: ${r.reason}\n${JSON.stringify(r.checks, null, 2)}`);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — opus_score trop bas refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage, { opus_score: 5.0 });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'opus_score_too_low');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — email confidence trop basse refuse (sans MX)', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage, { confidence: 0.3, emailSource: 'pattern-guess' });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'email_not_deliverable');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — MX verified passe même avec confidence 0.55', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage, { confidence: 0.55, emailSource: 'pattern-guess-guessed-domain+mx-verified' });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, true, `fail: ${r.reason}`);
    const emailCheck = r.checks.find(c => c.rule === 'email_deliverability');
    assert.equal(emailCheck.mxVerified, true);
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — pas d\'email refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage, { withContact: false });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'email_not_deliverable');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — contact récent refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    // Créer un autre lead du même SIREN avec sent_at récent
    seedCompanyAndMatch(storage, '111111111');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('123456789').id;
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, sent_at)
      VALUES ('t1', '123456789', ?, 7.0, 'orange', 'sent', datetime('now', '-10 days'))
    `).run(pmId);
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'recent_contact_60d');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — weekend refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const saturday = () => { const d = new Date(); d.setFullYear(2026, 0, 3); d.setHours(11, 0, 0, 0); return d; };
    const gate = new AutoSendGate(storage.db, { now: saturday });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timing_not_allowed');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — lundi matin refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const mondayEarly = () => { const d = new Date(); d.setFullYear(2026, 0, 5); d.setHours(9, 0, 0, 0); return d; };
    const gate = new AutoSendGate(storage.db, { now: mondayEarly });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timing_not_allowed');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — vendredi après 15h refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const friLate = () => { const d = new Date(); d.setFullYear(2026, 0, 9); d.setHours(16, 0, 0, 0); return d; };
    const gate = new AutoSendGate(storage.db, { now: friLate });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timing_not_allowed');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — nuit refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const night = () => { const d = new Date(); d.setFullYear(2026, 0, 7); d.setHours(22, 0, 0, 0); return d; };
    const gate = new AutoSendGate(storage.db, { now: night });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timing_not_allowed');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — reply rate trop bas refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    // Créer 25 leads sent, 0 positive → reply rate 0%
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('123456789').id;
    for (let i = 0; i < 25; i++) {
      seedCompanyAndMatch(storage, `5550${String(i).padStart(5, '0')}`);
      const localPm = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(`5550${String(i).padStart(5, '0')}`).id;
      storage.db.prepare(`
        INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, sent_at)
        VALUES ('t1', ?, ?, 7.0, 'orange', 'sent', datetime('now', '-3 days'))
      `).run(`5550${String(i).padStart(5, '0')}`, localPm);
    }
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'reply_rate_too_low');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — blacklist sémantique via NAF label', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    storage.db.prepare(`
      UPDATE companies SET naf_label = 'Société en procédure collective en cours' WHERE siren = '123456789'
    `).run();
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'semantic_blacklist_hit');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — blacklist via red_flag qualif Opus', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    storage.db.prepare(`
      INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model)
      VALUES ('t1', 'qualify', '123456789', 1, ?, 'claude-opus-4-7')
    `).run(JSON.stringify({
      phase: 'declin', red_flags: ['procédure collective en cours', 'difficulté financière']
    }));
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'semantic_blacklist_hit');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — règle 8 Opus OK', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const fakeCaller = async () => ({
      result: { verdict: 'OUI', reason: 'Pitch cohérent avec le contexte' },
      usage: { inputTokens: 100, outputTokens: 20 },
      model: 'claude-haiku-4-5-20251001'
    });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11, anthropicCaller: fakeCaller });
    const r = await gate.canSend({ leadId: 1, pitchText: 'Bonjour Alice, ...' });
    assert.equal(r.ok, true);
    const opusCheck = r.checks.find(c => c.rule === 'opus_final');
    assert.equal(opusCheck.verdict, 'OUI');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — règle 8 Opus DOUTE refuse', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage);
    const fakeCaller = async () => ({
      result: { verdict: 'DOUTE', reason: 'Ton trop agressif' },
      usage: { inputTokens: 100, outputTokens: 20 }
    });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11, anthropicCaller: fakeCaller });
    const r = await gate.canSend({ leadId: 1, pitchText: 'Salut, urgent appelle !' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'opus_final_rejected');
  } finally { cleanupStorage(storage, dbPath); }
});

test('J6 gate — ordre des checks respecté (early exit)', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    setupReadyLead(storage, { opus_score: 3.0 });
    const gate = new AutoSendGate(storage.db, { now: mondayAt11 });
    const r = await gate.canSend({ leadId: 1 });
    assert.equal(r.checks.length, 1, 'early exit sur première règle fail');
    assert.equal(r.checks[0].rule, 'opus_score');
  } finally { cleanupStorage(storage, dbPath); }
});
