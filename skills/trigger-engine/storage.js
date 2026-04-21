// ═══════════════════════════════════════════════════════════════════
// Trigger Engine FR — Storage SQLite (Node built-in)
// ═══════════════════════════════════════════════════════════════════
// Uses Node 22's built-in `node:sqlite` module (experimental but stable
// for our use case). Zero native deps to compile.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = process.env.TRIGGER_ENGINE_DB
  || path.join(__dirname, 'data', 'trigger-engine.db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

class TriggerEngineStorage {
  constructor(dbPath = DEFAULT_DB_PATH, options = {}) {
    this.dbPath = dbPath;
    this.readonly = options.readonly === true;
    if (!this.readonly) this._ensureDataDir();
    this.db = new DatabaseSync(dbPath, { readOnly: this.readonly });
    if (!this.readonly) {
      // Apply pragmas via exec (node:sqlite doesn't have .pragma method like better-sqlite3)
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
      `);
      this._initSchema();
    }
  }

  _ensureDataDir() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _initSchema() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    this.db.exec(schema);
  }

  // ─── COMPANIES ───

  upsertCompany(company) {
    const stmt = this.db.prepare(`
      INSERT INTO companies (siren, raison_sociale, nom_complet, forme_juridique,
                             naf_code, naf_label, effectif_min, effectif_max,
                             departement, region, date_creation, date_cessation,
                             last_enriched_at, enriched_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(siren) DO UPDATE SET
        raison_sociale = excluded.raison_sociale,
        nom_complet = COALESCE(excluded.nom_complet, nom_complet),
        forme_juridique = COALESCE(excluded.forme_juridique, forme_juridique),
        naf_code = COALESCE(excluded.naf_code, naf_code),
        naf_label = COALESCE(excluded.naf_label, naf_label),
        effectif_min = COALESCE(excluded.effectif_min, effectif_min),
        effectif_max = COALESCE(excluded.effectif_max, effectif_max),
        departement = COALESCE(excluded.departement, departement),
        region = COALESCE(excluded.region, region),
        date_creation = COALESCE(excluded.date_creation, date_creation),
        date_cessation = COALESCE(excluded.date_cessation, date_cessation),
        last_enriched_at = excluded.last_enriched_at,
        enriched_source = excluded.enriched_source
    `);
    return stmt.run(
      company.siren,
      company.raison_sociale,
      company.nom_complet ?? null,
      company.forme_juridique ?? null,
      company.naf_code ?? null,
      company.naf_label ?? null,
      company.effectif_min ?? null,
      company.effectif_max ?? null,
      company.departement ?? null,
      company.region ?? null,
      company.date_creation ?? null,
      company.date_cessation ?? null,
      company.last_enriched_at ?? null,
      company.enriched_source ?? 'sirene'
    );
  }

  getCompany(siren) {
    return this.db.prepare('SELECT * FROM companies WHERE siren = ?').get(siren);
  }

  // ─── EVENTS ───

  insertEvent(event) {
    const stmt = this.db.prepare(`
      INSERT INTO events (source, event_type, siren, attribution_confidence,
                          raw_data, normalized, event_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      event.source,
      event.event_type,
      event.siren ?? null,
      event.attribution_confidence ?? null,
      typeof event.raw_data === 'string' ? event.raw_data : JSON.stringify(event.raw_data),
      event.normalized ? (typeof event.normalized === 'string' ? event.normalized : JSON.stringify(event.normalized)) : null,
      event.event_date
    );
  }

  getUnprocessedEvents(limit = 1000) {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE processed_at IS NULL
      ORDER BY event_date DESC
      LIMIT ?
    `).all(limit);
  }

  markEventProcessed(eventId) {
    return this.db.prepare(`
      UPDATE events SET processed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(eventId);
  }

  getEventsForSiren(siren, daysWindow = 30) {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE siren = ?
        AND event_date >= datetime('now', '-' || ? || ' days')
      ORDER BY event_date DESC
    `).all(siren, String(daysWindow));
  }

  // ─── PATTERNS ───

  upsertPattern(pattern) {
    const stmt = this.db.prepare(`
      INSERT INTO patterns (id, name, description, verticaux, definition,
                            pitch_angle, min_score, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        verticaux = excluded.verticaux,
        definition = excluded.definition,
        pitch_angle = excluded.pitch_angle,
        min_score = excluded.min_score,
        enabled = excluded.enabled
    `);
    return stmt.run(
      pattern.id,
      pattern.name,
      pattern.description ?? null,
      JSON.stringify(pattern.verticaux || []),
      JSON.stringify(pattern.definition || pattern || {}),
      pattern.pitch_angle ?? null,
      pattern.min_score ?? 7.0,
      pattern.enabled === false ? 0 : 1
    );
  }

  getEnabledPatterns() {
    const rows = this.db.prepare('SELECT * FROM patterns WHERE enabled = 1').all();
    return rows.map(r => ({
      ...r,
      verticaux: JSON.parse(r.verticaux || '[]'),
      definition: JSON.parse(r.definition || '{}')
    }));
  }

  // ─── PATTERNS_MATCHED ───

  insertPatternMatch(match) {
    const stmt = this.db.prepare(`
      INSERT INTO patterns_matched (siren, pattern_id, score, signals,
                                     window_start, window_end, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      match.siren,
      match.pattern_id,
      match.score,
      JSON.stringify(match.signals || []),
      match.window_start,
      match.window_end,
      match.expires_at ?? null
    );
  }

  getActivePatternMatches(siren) {
    return this.db.prepare(`
      SELECT * FROM patterns_matched
      WHERE siren = ?
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY score DESC
    `).all(siren);
  }

  cleanupExpiredMatches() {
    return this.db.prepare(`
      DELETE FROM patterns_matched
      WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
    `).run();
  }

  // ─── INGESTION STATE ───

  getIngestionState(source) {
    return this.db.prepare('SELECT * FROM ingestion_state WHERE source = ?').get(source);
  }

  updateIngestionState(source, state) {
    const stmt = this.db.prepare(`
      INSERT INTO ingestion_state (source, last_run_at, last_event_id,
                                    events_last_run, errors_last_run, last_error, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_run_at = excluded.last_run_at,
        last_event_id = COALESCE(excluded.last_event_id, last_event_id),
        events_last_run = excluded.events_last_run,
        errors_last_run = excluded.errors_last_run,
        last_error = excluded.last_error,
        enabled = excluded.enabled
    `);
    return stmt.run(
      source,
      state.last_run_at ?? new Date().toISOString(),
      state.last_event_id ?? null,
      state.events_last_run ?? 0,
      state.errors_last_run ?? 0,
      state.last_error ?? null,
      state.enabled === false ? 0 : 1
    );
  }

  // ─── METRICS ───

  incrementMetric(metric, value = 1) {
    const today = new Date().toISOString().slice(0, 10);
    // node:sqlite doesn't support dynamic column names in parameters, need to build SQL
    const sql = `
      INSERT INTO metrics_daily (date, ${metric})
      VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET ${metric} = ${metric} + excluded.${metric}
    `;
    this.db.prepare(sql).run(today, value);
  }

  // ─── STATS ───

  getStats() {
    const getCount = (sql, ...params) => this.db.prepare(sql).get(...params)?.n ?? 0;
    return {
      companies: getCount('SELECT COUNT(*) as n FROM companies'),
      events_total: getCount('SELECT COUNT(*) as n FROM events'),
      events_unprocessed: getCount('SELECT COUNT(*) as n FROM events WHERE processed_at IS NULL'),
      events_attributed: getCount('SELECT COUNT(*) as n FROM events WHERE siren IS NOT NULL'),
      patterns_matched_active: getCount(`
        SELECT COUNT(*) as n FROM patterns_matched
        WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
      `),
      clients_active: getCount("SELECT COUNT(*) as n FROM clients WHERE status = 'active'"),
      leads_new: getCount("SELECT COUNT(*) as n FROM client_leads WHERE status = 'new'"),
      leads_sent_today: getCount(`
        SELECT COUNT(*) as n FROM client_leads
        WHERE sent_at >= datetime('now', '-1 day')
      `)
    };
  }

  close() {
    this.db.close();
  }
}

if (require.main === module && process.argv.includes('--init')) {
  const storage = new TriggerEngineStorage();
  console.log('Schema initialized at:', storage.dbPath);
  console.log('Stats:', storage.getStats());
  storage.close();
}

module.exports = { TriggerEngineStorage, DEFAULT_DB_PATH };
