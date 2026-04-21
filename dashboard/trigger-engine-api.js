// ═══════════════════════════════════════════════════════════════════
// Dashboard API — Trigger Engine read-only endpoints
// ═══════════════════════════════════════════════════════════════════
// Uses Node 22 built-in `node:sqlite` (experimental but stable).
// Reads the .db file shared via Docker volume with telegram-router.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.warn('[trigger-engine-api] node:sqlite not available, API disabled');
}

const DB_PATH = process.env.TRIGGER_ENGINE_DB
  || path.join('/app/skills/trigger-engine/data', 'trigger-engine.db');

let _db = null;

function getDb() {
  if (!DatabaseSync) return null;
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    _db = new DatabaseSync(DB_PATH, { readOnly: true });
    _db.exec('PRAGMA busy_timeout = 2000;');
    return _db;
  } catch (e) {
    console.warn('[trigger-engine-api] open DB failed:', e.message);
    return null;
  }
}

function registerTriggerEngineRoutes(app, authMiddleware) {
  app.get('/api/trigger-engine/stats', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, reason: 'db-not-found' });

    try {
      const getCount = (sql, ...params) => db.prepare(sql).get(...params)?.n ?? 0;
      const stats = {
        enabled: true,
        companies: getCount('SELECT COUNT(*) as n FROM companies'),
        events_total: getCount('SELECT COUNT(*) as n FROM events'),
        events_attributed: getCount('SELECT COUNT(*) as n FROM events WHERE siren IS NOT NULL'),
        events_unprocessed: getCount('SELECT COUNT(*) as n FROM events WHERE processed_at IS NULL'),
        events_last_24h: getCount(`SELECT COUNT(*) as n FROM events WHERE captured_at >= datetime('now', '-1 day')`),
        patterns_total: getCount('SELECT COUNT(*) as n FROM patterns'),
        matches_active: getCount(`
          SELECT COUNT(*) as n FROM patterns_matched
          WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
        `),
        matches_last_24h: getCount(`SELECT COUNT(*) as n FROM patterns_matched WHERE matched_at >= datetime('now', '-1 day')`),
        clients_active: getCount("SELECT COUNT(*) as n FROM clients WHERE status = 'active'"),
        leads_new: getCount("SELECT COUNT(*) as n FROM client_leads WHERE status = 'new'"),
        events_by_source: db.prepare(`
          SELECT source, COUNT(*) as n FROM events GROUP BY source ORDER BY n DESC
        `).all(),
        metrics_daily: db.prepare(`
          SELECT * FROM metrics_daily ORDER BY date DESC LIMIT 7
        `).all()
      };
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/events', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, events: [] });

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const source = req.query.source || null;

    try {
      const sql = `
        SELECT e.id, e.source, e.event_type, e.siren, e.attribution_confidence,
               e.event_date, e.captured_at, e.processed_at,
               c.raison_sociale, c.nom_complet
        FROM events e
        LEFT JOIN companies c ON c.siren = e.siren
        ${source ? 'WHERE source = ?' : ''}
        ORDER BY e.captured_at DESC
        LIMIT ?
      `;
      const params = source ? [source, limit] : [limit];
      const events = db.prepare(sql).all(...params);
      res.json({ enabled: true, events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/matches', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, matches: [] });

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const minScore = parseFloat(req.query.min_score || '0');

    try {
      const matches = db.prepare(`
        SELECT pm.id, pm.siren, pm.pattern_id, pm.score, pm.signals,
               pm.matched_at, pm.expires_at,
               p.name as pattern_name, p.pitch_angle,
               c.raison_sociale, c.nom_complet, c.naf_label, c.departement
        FROM patterns_matched pm
        LEFT JOIN patterns p ON p.id = pm.pattern_id
        LEFT JOIN companies c ON c.siren = pm.siren
        WHERE (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
          AND pm.score >= ?
        ORDER BY pm.score DESC, pm.matched_at DESC
        LIMIT ?
      `).all(minScore, limit);

      for (const m of matches) {
        try { m.signals = JSON.parse(m.signals || '[]'); } catch (e) { m.signals = []; }
      }
      res.json({ enabled: true, matches });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/patterns', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, patterns: [] });

    try {
      const patterns = db.prepare('SELECT * FROM patterns WHERE enabled = 1').all();
      for (const p of patterns) {
        try { p.verticaux = JSON.parse(p.verticaux || '[]'); } catch (e) { p.verticaux = []; }
        try { p.definition = JSON.parse(p.definition || '{}'); } catch (e) { p.definition = {}; }
      }
      res.json({ enabled: true, patterns });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/ingestion-state', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, sources: [] });

    try {
      const sources = db.prepare('SELECT * FROM ingestion_state ORDER BY source').all();
      res.json({ enabled: true, sources });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerTriggerEngineRoutes, getDb };
