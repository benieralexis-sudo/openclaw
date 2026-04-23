'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');

// Reproduit la logique SQL du cron._enqueueStaleRequalify()
function staleCandidates(db) {
  return db.prepare(`
    SELECT DISTINCT cl.client_id, cl.siren, cbr.last_qualif
    FROM client_leads cl
    INNER JOIN (
      SELECT tenant_id, siren, MAX(created_at) as last_qualif
      FROM claude_brain_results
      WHERE pipeline = 'qualify'
      GROUP BY tenant_id, siren
    ) cbr ON cbr.tenant_id = cl.client_id AND cbr.siren = cl.siren
    WHERE cl.status IN ('new', 'qualifying', 'sent')
      AND (
        (julianday('now') - julianday(cbr.last_qualif)) > 14
        OR EXISTS (SELECT 1 FROM events e WHERE e.siren = cl.siren AND e.captured_at > cbr.last_qualif)
        OR EXISTS (SELECT 1 FROM leads_contacts lc WHERE lc.siren = cl.siren AND lc.discovered_at > cbr.last_qualif)
      )
    ORDER BY cbr.last_qualif ASC
    LIMIT 30
  `).all();
}

function setupLeadWithQualif(storage, tenantId, siren, qualifAgeDays = 0) {
  seedCompanyAndMatch(storage, siren);
  // Forcer les events seed à être PLUS VIEUX que la qualif
  // (simule le cas où BODACC a ingéré du data, puis qualif a tourné)
  storage.db.prepare(`UPDATE events SET captured_at = datetime('now', '-' || ? || ' days') WHERE siren = ?`)
    .run(qualifAgeDays + 5, siren);
  const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(siren).id;
  storage.db.prepare(`
    INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score)
    VALUES (?, ?, ?, 7.0, 'orange', 'new', 7.0)
  `).run(tenantId, siren, pmId);
  storage.db.prepare(`
    INSERT INTO claude_brain_results (tenant_id, pipeline, siren, version, result_json, model, created_at)
    VALUES (?, 'qualify', ?, 1, '{}', 'claude-opus-4-7', datetime('now', '-' || ? || ' days'))
  `).run(tenantId, siren, qualifAgeDays);
}

test('Stale requalify — qualif fraîche (<14j) sans nouveaux events : PAS de re-qualify', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '100000001', 3); // qualif 3 jours old
    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 0, 'rien ne doit être re-qualifié');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — qualif > 14 jours : re-qualify déclenchée', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '200000001', 20); // qualif 20 jours old
    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 1);
    assert.equal(cand[0].siren, '200000001');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — qualif récente MAIS nouvel event arrivé après : re-qualify', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '300000001', 2); // qualif 2 jours old
    // Un nouvel event arrive 1 jour après la qualif (donc hier)
    storage.db.prepare(`
      INSERT INTO events (source, event_type, siren, raw_data, event_date, captured_at)
      VALUES ('bodacc', 'new_event_type', '300000001', '{}', date('now', '-1 day'), datetime('now', '-1 day'))
    `).run();
    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 1, 'nouvel event doit déclencher re-qualify');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — qualif récente ET tous les events sont AVANT : PAS de re-qualify', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '400000001', 2);
    // Event inséré manuellement avec captured_at très ancien
    storage.db.prepare(`
      INSERT INTO events (source, event_type, siren, raw_data, event_date, captured_at)
      VALUES ('bodacc', 'old', '400000001', '{}', date('now', '-10 days'), datetime('now', '-10 days'))
    `).run();
    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 0, 'event plus vieux que qualif → pas de re-qualify');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — nouveau contact enrichi déclenche re-qualify', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '500000001', 1);
    // Contact enrichi 12h après la qualif
    storage.db.prepare(`
      INSERT INTO leads_contacts (siren, prenom, nom, email, email_confidence, source, discovered_at)
      VALUES ('500000001', 'Test', 'User', 'test@x.com', 0.9, 'test', datetime('now', '-12 hours'))
    `).run();
    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 1, 'nouveau contact doit déclencher re-qualify');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — skip leads status discarded/booked/replied_negative', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '600000001', 20);
    setupLeadWithQualif(storage, 't1', '600000002', 20);
    setupLeadWithQualif(storage, 't1', '600000003', 20);
    setupLeadWithQualif(storage, 't1', '600000004', 20);
    // Transitions
    storage.db.prepare("UPDATE client_leads SET status = 'discarded' WHERE siren = '600000001'").run();
    storage.db.prepare("UPDATE client_leads SET status = 'booked' WHERE siren = '600000002'").run();
    storage.db.prepare("UPDATE client_leads SET status = 'replied_negative' WHERE siren = '600000003'").run();
    // 600000004 reste 'new'

    const cand = staleCandidates(storage.db);
    const sirens = cand.map(c => c.siren);
    assert.equal(sirens.length, 1, 'seul le new doit être re-qualifié');
    assert.equal(sirens[0], '600000004');
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — leads jamais qualifiés ne sont PAS dans le scope (gérés par _enqueueQualifyForNewLeads)', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    seedCompanyAndMatch(storage, '700000001');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('700000001').id;
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status)
      VALUES ('t1', '700000001', ?, 7.0, 'orange', 'new')
    `).run(pmId);
    // Aucune qualif existante → ne doit pas matcher (INNER JOIN sur claude_brain_results)
    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 0);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Stale requalify — tri par qualif la plus ancienne d\'abord', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1');
    setupLeadWithQualif(storage, 't1', '800000001', 15); // 15j
    setupLeadWithQualif(storage, 't1', '800000002', 30); // 30j, plus vieux
    setupLeadWithQualif(storage, 't1', '800000003', 20); // 20j

    const cand = staleCandidates(storage.db);
    assert.equal(cand.length, 3);
    assert.equal(cand[0].siren, '800000002', 'le plus vieux en premier');
    assert.equal(cand[2].siren, '800000001', 'le plus récent en dernier');
  } finally { cleanupStorage(storage, dbPath); }
});
