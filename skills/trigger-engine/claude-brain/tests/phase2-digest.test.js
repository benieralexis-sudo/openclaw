'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTempStorage, cleanupStorage, seedTenant, seedCompanyAndMatch } = require('./setup');
const {
  buildDigest, getDigestLeads, parisDate, parisHour, sendDailyDigests
} = require('../digest-email');
const {
  sendRealtimeAlerts, buildAlertEmail
} = require('../realtime-alert');

function seedQualifiedLead(storage, tenantId, siren, opusScore, hoursAgo = 1) {
  seedCompanyAndMatch(storage, siren);
  const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get(siren).id;
  storage.db.prepare(`
    INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score,
                              opus_qualified_at, created_at)
    VALUES (?, ?, ?, 7.0, 'orange', 'new', ?, datetime('now', '-' || ? || ' hours'), datetime('now', '-' || ? || ' hours'))
  `).run(tenantId, siren, pmId, opusScore, hoursAgo, hoursAgo);
}

// ───── Digest building ─────

test('Phase2 digest — getDigestLeads filtre leads last 24h', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr' });
    seedQualifiedLead(storage, 't1', '100000001', 9.0, 2);   // < 24h, doit être inclus
    seedQualifiedLead(storage, 't1', '100000002', 7.5, 10);  // < 24h, doit être inclus
    seedQualifiedLead(storage, 't1', '100000003', 5.0, 48);  // > 24h, doit être exclu
    const leads = getDigestLeads(storage.db, 't1');
    assert.equal(leads.length, 2);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 digest — buildDigest produit HTML + subject', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr' });
    seedQualifiedLead(storage, 't1', '200000001', 9.5);
    seedQualifiedLead(storage, 't1', '200000002', 6.5);
    const d = buildDigest(storage.db, 't1', 'Acme SAS');
    assert.ok(d);
    assert.ok(d.html.includes('iFIND') || d.html.includes('leads'));
    assert.equal(d.leads_count, 2);
    assert.equal(d.red_count, 1);
    assert.ok(d.subject.includes('urgent') || d.subject.includes('Acme'));
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 digest — buildDigest retourne null si 0 leads', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr' });
    const d = buildDigest(storage.db, 't1');
    assert.equal(d, null);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 digest — HTML sanitize XSS dans raison_sociale', () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr' });
    seedCompanyAndMatch(storage, '300000001');
    storage.db.prepare(`UPDATE companies SET raison_sociale = ? WHERE siren = ?`)
      .run('<script>alert(1)</script>EvilCorp', '300000001');
    const pmId = storage.db.prepare('SELECT id FROM patterns_matched WHERE siren = ?').get('300000001').id;
    storage.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority, status, opus_score, opus_qualified_at, created_at)
      VALUES ('t1', '300000001', ?, 7.0, 'orange', 'new', 8.5, datetime('now'), datetime('now'))
    `).run(pmId);
    const d = buildDigest(storage.db, 't1');
    assert.ok(!d.html.includes('<script>'));
    assert.ok(d.html.includes('&lt;script&gt;'));
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 digest — parisDate format YYYY-MM-DD', () => {
  const d = parisDate();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

test('Phase2 digest — parisHour retourne 0-23', () => {
  const h = parisHour();
  assert.ok(h >= 0 && h <= 23);
});

// ───── sendDailyDigests ─────

test('Phase2 digest — sendDailyDigests skip si digest_enabled=false', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr', digest_enabled: false });
    seedQualifiedLead(storage, 't1', '400000001', 9.0);
    const stats = await sendDailyDigests(storage.db, { log: { info: () => {}, warn: () => {}, error: () => {} } });
    assert.equal(stats.sent, 0);
    assert.ok(stats.skipped >= 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 digest — sendDailyDigests skip si digest_email absent', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1'); // pas de digest_email
    seedQualifiedLead(storage, 't1', '500000001', 9.0);
    const stats = await sendDailyDigests(storage.db, { log: { info: () => {}, warn: () => {}, error: () => {} } });
    assert.equal(stats.sent, 0);
    assert.ok(stats.skipped >= 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 digest — dédup via digest_sends table', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr' });
    seedQualifiedLead(storage, 't1', '600000001', 9.0);
    // Insert manuel dans digest_sends pour simuler envoi du jour
    storage.db.exec(`
      CREATE TABLE IF NOT EXISTS digest_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL, date TEXT NOT NULL, email TEXT NOT NULL,
        leads_count INTEGER DEFAULT 0, red_count INTEGER DEFAULT 0,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'sent', error TEXT,
        UNIQUE(tenant_id, date)
      );
    `);
    storage.db.prepare(`
      INSERT INTO digest_sends (tenant_id, date, email, leads_count, status)
      VALUES ('t1', ?, 'client@test.fr', 1, 'sent')
    `).run(parisDate());
    const stats = await sendDailyDigests(storage.db, { log: { info: () => {}, warn: () => {}, error: () => {} } });
    assert.equal(stats.sent, 0, 'already sent today → skip');
    assert.ok(stats.skipped >= 1);
  } finally { cleanupStorage(storage, dbPath); }
});

// ───── Realtime alerts ─────

test('Phase2 realtime — buildAlertEmail structure HTML complète', () => {
  const email = buildAlertEmail(
    { siren: '123', raison_sociale: 'Axomove', opus_score: 9.2 },
    { phase: 'scale-up', decision_maker_real: 'Clément Morel', angle_pitch_primary: 'gain temps', urgency_reason: '4 semaines post-levée' }
  );
  assert.ok(email.subject.includes('Axomove'));
  assert.ok(email.html.includes('9.2'));
  assert.ok(email.html.includes('Clément Morel'));
  assert.ok(email.html.includes('4 semaines'));
});

test('Phase2 realtime — sendRealtimeAlerts skip si realtime_alert_enabled=false', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', {
      digest_email: 'client@test.fr',
      realtime_alert_enabled: false
    });
    seedQualifiedLead(storage, 't1', '700000001', 9.5, 1);
    const stats = await sendRealtimeAlerts(storage.db, { log: { info: () => {}, warn: () => {}, error: () => {} } });
    assert.equal(stats.sent, 0);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 realtime — dédup 24h par (tenant, siren)', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', { digest_email: 'client@test.fr', realtime_alert_enabled: true });
    seedQualifiedLead(storage, 't1', '800000001', 9.5, 1);
    // Pré-insérer un alerte récente (< 24h)
    storage.db.exec(`
      CREATE TABLE IF NOT EXISTS realtime_alerts_sent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT, siren TEXT, opus_score REAL, email TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT, error TEXT
      );
    `);
    storage.db.prepare(`
      INSERT INTO realtime_alerts_sent (tenant_id, siren, opus_score, email, status, sent_at)
      VALUES ('t1', '800000001', 9.5, 'client@test.fr', 'sent', datetime('now', '-2 hours'))
    `).run();
    const stats = await sendRealtimeAlerts(storage.db, { log: { info: () => {}, warn: () => {}, error: () => {} } });
    assert.ok(stats.skipped >= 1);
  } finally { cleanupStorage(storage, dbPath); }
});

test('Phase2 realtime — threshold tenant configurable (10 au lieu de 9)', async () => {
  const { storage, dbPath } = createTempStorage();
  try {
    seedTenant(storage, 't1', {
      digest_email: 'client@test.fr',
      realtime_alert_enabled: true,
      realtime_alert_threshold: 10.0 // Impossible à atteindre
    });
    seedQualifiedLead(storage, 't1', '900000001', 9.5, 1); // Sous le seuil
    const stats = await sendRealtimeAlerts(storage.db, { log: { info: () => {}, warn: () => {}, error: () => {} } });
    assert.equal(stats.sent, 0);
  } finally { cleanupStorage(storage, dbPath); }
});
