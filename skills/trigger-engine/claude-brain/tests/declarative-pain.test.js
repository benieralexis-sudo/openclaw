'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage } = require('./setup');
const { analyzePain, MIN_INTENT_STRENGTH, PAIN_SCORE_FLOOR } = require('../declarative-pain');

// Helpers
function fakeCaller(painResult) {
  return async () => ({
    result: painResult,
    usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 },
    model: 'claude-opus-4-7',
    latency_ms: 100,
    raw_text: JSON.stringify(painResult)
  });
}
function fakeLookup(siren, raisonSociale, naf = '62.01Z') {
  return async () => ({
    siren,
    raison_sociale: raisonSociale,
    nom_complet: raisonSociale,
    naf_code: naf,
    naf_label: 'Programmation',
    departement: '75',
    effectif_min: 10,
    effectif_max: 50
  });
}

// Wrap pour activer le flag dans chaque test
function withFlag(fn) {
  return async () => {
    const prev = process.env.DECLARATIVE_PAIN_ENABLED;
    process.env.DECLARATIVE_PAIN_ENABLED = 'true';
    try { await fn(); } finally {
      if (prev === undefined) delete process.env.DECLARATIVE_PAIN_ENABLED;
      else process.env.DECLARATIVE_PAIN_ENABLED = prev;
    }
  };
}

test('declarative-pain — désactivé par défaut (flag OFF)', async () => {
  delete process.env.DECLARATIVE_PAIN_ENABLED;
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'On cherche un outil de leadgen FR qui marche',
      sourceUrl: 'https://linkedin.com/post/1',
      sourceType: 'linkedin',
      anthropicCaller: fakeCaller({ match: true, intent_strength: 9, company_name: 'Test', pain_text: 'x', topic: 'leadgen' }),
      lookupByName: fakeLookup('999999999', 'Test SAS')
    });
    assert.equal(r.match, false);
    assert.equal(r.skip_reason, 'feature_disabled');
  } finally { cleanupStorage(storage, dbPath); }
});

test('declarative-pain — text trop court → skip', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'court',
      anthropicCaller: fakeCaller({ match: true }),
      lookupByName: fakeLookup('111', 'X')
    });
    assert.equal(r.match, false);
    assert.equal(r.skip_reason, 'text_too_short');
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — Opus dit no match → no_signal', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'Ravi de rejoindre Acme en tant que CTO ! Hâte d\'attaquer les défis techniques.',
      anthropicCaller: fakeCaller({ match: false, reason: 'job announcement' }),
      lookupByName: fakeLookup('111', 'Acme')
    });
    assert.equal(r.match, false);
    assert.equal(r.action, 'no_signal');
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — intent <5 → low_intent skip', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'Avis Glassdoor : ambiance générale moyenne, outils un peu vieux mais ça va.',
      anthropicCaller: fakeCaller({ match: true, intent_strength: 3, company_name: 'Acme', pain_text: 'x', topic: 'autre' }),
      lookupByName: fakeLookup('111', 'Acme')
    });
    assert.equal(r.match, false);
    assert.equal(r.action, 'low_intent');
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — match sans nom entreprise → no_attribution', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'On cherche un outil de leadgen FR qui marche vraiment, qui peut nous reco quelque chose ?',
      anthropicCaller: fakeCaller({ match: true, intent_strength: 8, company_name: null, pain_text: 'On cherche un outil', topic: 'leadgen' }),
      lookupByName: fakeLookup('111', 'Acme')
    });
    assert.equal(r.match, true);
    assert.equal(r.action, 'no_attribution');
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — match complet → event créé + lead boosté', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    // Seed un client_lead existant qu'on doit booster
    storage.upsertCompany({ siren: '300000001', raison_sociale: 'Pumeo', naf_code: '62.01Z' });
    storage.db.prepare(`
      INSERT INTO clients (id, name, industry, icp, status) VALUES (?, ?, ?, ?, ?)
    `).run('t1', 'Tenant 1', 'leadgen', '{}', 'active');
    storage.db.prepare(`
      INSERT INTO patterns (id, name, definition) VALUES (?, ?, ?)
    `).run('p1', 'p1', '{}');
    storage.db.prepare(`
      INSERT INTO patterns_matched (siren, pattern_id, score, signals, window_start, window_end)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('300000001', 'p1', 7, '[]', new Date().toISOString(), new Date().toISOString());
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, status, opus_score)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run('t1', '300000001', 7.0, 'new', 6.0);

    const r = await analyzePain({
      db: storage.db,
      text: 'On cherche désespérément un outil de leadgen FR qui marche vraiment chez Pumeo, on a testé Apollo et Lemlist sans succès.',
      sourceUrl: 'https://linkedin.com/post/123',
      sourceType: 'linkedin',
      anthropicCaller: fakeCaller({
        match: true,
        intent_strength: 9,
        company_name: 'Pumeo',
        pain_text: 'On cherche désespérément un outil de leadgen FR',
        topic: 'leadgen',
        author_role: 'Head of Sales',
        intent_strength_reasoning: 'recherche active explicite',
        suggested_pitch_angle: 'Référencer son post'
      }),
      lookupByName: fakeLookup('300000001', 'Pumeo')
    });

    assert.equal(r.match, true);
    assert.equal(r.action, 'detected');
    assert.equal(r.siren, '300000001');
    assert.equal(r.leads_boosted, 1);
    assert.ok(r.event_id);

    // Vérifier event créé
    const ev = storage.db.prepare('SELECT * FROM events WHERE id = ?').get(r.event_id);
    assert.equal(ev.event_type, 'declarative_pain');
    assert.equal(ev.source, 'declarative-pain');
    assert.equal(ev.siren, '300000001');
    const raw = JSON.parse(ev.raw_data);
    assert.equal(raw.topic, 'leadgen');
    assert.equal(raw.author_role, 'Head of Sales');

    // Vérifier client_lead boosté à PAIN_SCORE_FLOOR
    const lead = storage.db.prepare('SELECT opus_score FROM client_leads WHERE siren = ?').get('300000001');
    assert.equal(lead.opus_score, PAIN_SCORE_FLOOR);
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — dédup par source_url → already_analyzed', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    storage.upsertCompany({ siren: '300000002', raison_sociale: 'X', naf_code: '62.01Z' });
    // Insert un event pré-existant avec même URL
    storage.db.prepare(`
      INSERT INTO events (source, event_type, siren, raw_data, event_date)
      VALUES (?, ?, ?, ?, ?)
    `).run('declarative-pain', 'declarative_pain', '300000002', JSON.stringify({ source_url: 'https://linkedin.com/post/dup' }), new Date().toISOString());

    const r = await analyzePain({
      db: storage.db,
      text: 'On cherche un outil de leadgen FR pour notre boîte X.',
      sourceUrl: 'https://linkedin.com/post/dup',
      anthropicCaller: fakeCaller({ match: true, intent_strength: 9, company_name: 'X' }),
      lookupByName: fakeLookup('300000002', 'X')
    });
    assert.equal(r.match, false);
    assert.equal(r.skip_reason, 'already_analyzed');
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — boost ne descend jamais un score plus haut', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    storage.upsertCompany({ siren: '300000003', raison_sociale: 'High', naf_code: '62.01Z' });
    storage.db.prepare(`INSERT INTO clients (id, name, industry, icp, status) VALUES (?, ?, ?, ?, ?)`).run('t1', 'T', 'x', '{}', 'active');
    storage.db.prepare(`INSERT INTO patterns (id, name, definition) VALUES (?, ?, ?)`).run('p1', 'p1', '{}');
    storage.db.prepare(`INSERT INTO patterns_matched (siren, pattern_id, score, signals, window_start, window_end) VALUES (?, ?, ?, ?, ?, ?)`).run('300000003', 'p1', 9.5, '[]', new Date().toISOString(), new Date().toISOString());
    // lead déjà à 9.8 — le boost à 9.0 ne doit pas le descendre
    storage.db.prepare(`INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, status, opus_score) VALUES (?, ?, 1, ?, ?, ?)`).run('t1', '300000003', 9.5, 'new', 9.8);

    await analyzePain({
      db: storage.db,
      text: 'On cherche un nouvel outil chez High pour remplacer notre stack qui galère.',
      sourceUrl: 'https://linkedin.com/post/high',
      anthropicCaller: fakeCaller({ match: true, intent_strength: 9, company_name: 'High', pain_text: 'x', topic: 'leadgen' }),
      lookupByName: fakeLookup('300000003', 'High')
    });

    const lead = storage.db.prepare('SELECT opus_score FROM client_leads WHERE siren = ?').get('300000003');
    assert.equal(lead.opus_score, 9.8);
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — SIREN introuvable → siren_not_found', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'On cherche un outil de leadgen pour notre nouvelle boîte ZxZxZ qui démarre à peine.',
      sourceUrl: 'https://linkedin.com/post/zxzxz',
      anthropicCaller: fakeCaller({ match: true, intent_strength: 8, company_name: 'ZxZxZ', pain_text: 'x', topic: 'leadgen' }),
      lookupByName: async () => null  // SIRENE retourne rien
    });
    assert.equal(r.match, true);
    assert.equal(r.action, 'siren_not_found');
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — Opus throw → action error', withFlag(async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    const r = await analyzePain({
      db: storage.db,
      text: 'Texte assez long pour passer le seuil minimum de longueur du detector.',
      anthropicCaller: async () => { throw new Error('API down'); },
      lookupByName: fakeLookup('111', 'X')
    });
    assert.equal(r.match, false);
    assert.equal(r.action, 'error');
    assert.match(r.skip_reason, /API down/);
  } finally { cleanupStorage(storage, dbPath); }
}));

test('declarative-pain — pattern definition existe et est valide', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const p = path.join(__dirname, '../../patterns/definitions/declarative-pain.json');
  assert.ok(fs.existsSync(p));
  const def = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(def.id, 'declarative-pain');
  assert.equal(def.min_score, 9.0);
  assert.ok(def.signals_required.must_have_at_least_one_of[0].types.includes('declarative_pain'));
});

test('declarative-pain — prompt detect-pain.md existe et contient instructions clés', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const p = path.join(__dirname, '../prompts/detect-pain.md');
  assert.ok(fs.existsSync(p));
  const prompt = fs.readFileSync(p, 'utf8');
  assert.match(prompt, /JSON valide/i);
  assert.match(prompt, /intent_strength/);
  assert.match(prompt, /company_name/);
  assert.match(prompt, /match.*false/);
});

test('declarative-pain — pipeline detect-pain enregistré dans PIPELINE_CONFIG', () => {
  const { PIPELINE_CONFIG } = require('../pipelines');
  assert.ok(PIPELINE_CONFIG['detect-pain']);
  assert.equal(PIPELINE_CONFIG['detect-pain'].json, true);
});
