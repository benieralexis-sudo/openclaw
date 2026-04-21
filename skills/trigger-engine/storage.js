// ═══════════════════════════════════════════════════════════════════
// Trigger Engine FR — Storage SQLite
// ═══════════════════════════════════════════════════════════════════
// Handles the SQLite database: init, CRUD on companies/events/patterns/leads,
// ingestion state tracking, and metrics.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = process.env.TRIGGER_ENGINE_DB
  || path.join(__dirname, 'data', 'trigger-engine.db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

class TriggerEngineStorage {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this._ensureDataDir();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this._initSchema();
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
      VALUES (@siren, @raison_sociale, @nom_complet, @forme_juridique,
              @naf_code, @naf_label, @effectif_min, @effectif_max,
              @departement, @region, @date_creation, @date_cessation,
              @last_enriched_at, @enriched_source)
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
    return stmt.run({
      siren: company.siren,
      raison_sociale: company.raison_sociale,
      nom_complet: company.nom_complet || null,
      forme_juridique: company.forme_juridique || null,
      naf_code: company.naf_code || null,
      naf_label: company.naf_label || null,
      effectif_min: company.effectif_min ?? null,
      effectif_max: company.effectif_max ?? null,
      departement: company.departement || null,
      region: company.region || null,
      date_creation: company.date_creation || null,
      date_cessation: company.date_cessation || null,
      last_enriched_at: company.last_enriched_at || null,
      enriched_source: company.enriched_source || 'sirene'
    });
  }

  getCompany(siren) {
    return this.db.prepare('SELECT * FROM companies WHERE siren = ?').get(siren);
  }

  // ─── EVENTS ───

  insertEvent(event) {
    const stmt = this.db.prepare(`
      INSERT INTO events (source, event_type, siren, attribution_confidence,
                          raw_data, normalized, event_date)
      VALUES (@source, @event_type, @siren, @attribution_confidence,
              @raw_data, @normalized, @event_date)
    `);
    return stmt.run({
      source: event.source,
      event_type: event.event_type,
      siren: event.siren || null,
      attribution_confidence: event.attribution_confidence ?? null,
      raw_data: typeof event.raw_data === 'string' ? event.raw_data : JSON.stringify(event.raw_data),
      normalized: event.normalized ? (typeof event.normalized === 'string' ? event.normalized : JSON.stringify(event.normalized)) : null,
      event_date: event.event_date
    });
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
    `).all(siren, daysWindow);
  }

  // ─── PATTERNS ───

  upsertPattern(pattern) {
    const stmt = this.db.prepare(`
      INSERT INTO patterns (id, name, description, verticaux, definition,
                            pitch_angle, min_score, enabled)
      VALUES (@id, @name, @description, @verticaux, @definition,
              @pitch_angle, @min_score, @enabled)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        verticaux = excluded.verticaux,
        definition = excluded.definition,
        pitch_angle = excluded.pitch_angle,
        min_score = excluded.min_score,
        enabled = excluded.enabled
    `);
    return stmt.run({
      id: pattern.id,
      name: pattern.name,
      description: pattern.description || null,
      verticaux: JSON.stringify(pattern.verticaux || []),
      definition: JSON.stringify(pattern.definition || {}),
      pitch_angle: pattern.pitch_angle || null,
      min_score: pattern.min_score ?? 7.0,
      enabled: pattern.enabled === false ? 0 : 1
    });
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
      VALUES (@siren, @pattern_id, @score, @signals,
              @window_start, @window_end, @expires_at)
    `);
    return stmt.run({
      siren: match.siren,
      pattern_id: match.pattern_id,
      score: match.score,
      signals: JSON.stringify(match.signals || []),
      window_start: match.window_start,
      window_end: match.window_end,
      expires_at: match.expires_at || null
    });
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
      VALUES (@source, @last_run_at, @last_event_id,
              @events_last_run, @errors_last_run, @last_error, @enabled)
      ON CONFLICT(source) DO UPDATE SET
        last_run_at = excluded.last_run_at,
        last_event_id = COALESCE(excluded.last_event_id, last_event_id),
        events_last_run = excluded.events_last_run,
        errors_last_run = excluded.errors_last_run,
        last_error = excluded.last_error,
        enabled = excluded.enabled
    `);
    return stmt.run({
      source,
      last_run_at: state.last_run_at || new Date().toISOString(),
      last_event_id: state.last_event_id || null,
      events_last_run: state.events_last_run ?? 0,
      errors_last_run: state.errors_last_run ?? 0,
      last_error: state.last_error || null,
      enabled: state.enabled === false ? 0 : 1
    });
  }

  // ─── METRICS ───

  incrementMetric(metric, value = 1) {
    const today = new Date().toISOString().slice(0, 10);
    this.db.prepare(`
      INSERT INTO metrics_daily (date, ${metric})
      VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET ${metric} = ${metric} + excluded.${metric}
    `).run(today, value);
  }

  // ─── STATS (for dashboard) ───

  getStats() {
    return {
      companies: this.db.prepare('SELECT COUNT(*) as n FROM companies').get().n,
      events_total: this.db.prepare('SELECT COUNT(*) as n FROM events').get().n,
      events_unprocessed: this.db.prepare('SELECT COUNT(*) as n FROM events WHERE processed_at IS NULL').get().n,
      events_attributed: this.db.prepare('SELECT COUNT(*) as n FROM events WHERE siren IS NOT NULL').get().n,
      patterns_matched_active: this.db.prepare(`
        SELECT COUNT(*) as n FROM patterns_matched
        WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
      `).get().n,
      clients_active: this.db.prepare("SELECT COUNT(*) as n FROM clients WHERE status = 'active'").get().n,
      leads_new: this.db.prepare("SELECT COUNT(*) as n FROM client_leads WHERE status = 'new'").get().n,
      leads_sent_today: this.db.prepare(`
        SELECT COUNT(*) as n FROM client_leads
        WHERE sent_at >= datetime('now', '-1 day')
      `).get().n
    };
  }

  close() {
    this.db.close();
  }
}

// CLI mode: node storage.js --init
if (require.main === module && process.argv.includes('--init')) {
  const storage = new TriggerEngineStorage();
  console.log('Schema initialized at:', storage.dbPath);
  console.log('Stats:', storage.getStats());
  storage.close();
}

module.exports = { TriggerEngineStorage, DEFAULT_DB_PATH };
