// ═══════════════════════════════════════════════════════════════════
// Trigger Engine FR — Main handler
// ═══════════════════════════════════════════════════════════════════
// Entry point for the Trigger Engine skill.
// Exposes initialization, ingestion orchestration, and public API.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { TriggerEngineStorage } = require('./storage');

class TriggerEngineHandler {
  constructor(options = {}) {
    this.storage = new TriggerEngineStorage(options.dbPath);
    this.sources = new Map();      // name -> source module
    this.patterns = [];            // loaded pattern definitions
    this.log = options.log || console;
  }

  /**
   * Register a source ingester (e.g. bodacc, inpi, francetravail)
   * @param {string} name - source identifier
   * @param {object} source - module with ingest() method returning {events, state}
   */
  registerSource(name, source) {
    this.sources.set(name, source);
    this.log.info?.(`[trigger-engine] source registered: ${name}`);
  }

  /**
   * Run ingestion for all enabled sources (or a specific one)
   * @param {string} [sourceName] - optional: ingest only this source
   */
  async runIngestion(sourceName = null) {
    const toRun = sourceName
      ? [[sourceName, this.sources.get(sourceName)]]
      : [...this.sources.entries()];

    const results = {};
    for (const [name, source] of toRun) {
      if (!source) {
        results[name] = { error: 'source not registered' };
        continue;
      }
      try {
        const state = this.storage.getIngestionState(name);
        if (state && state.enabled === 0) {
          results[name] = { skipped: 'disabled' };
          continue;
        }
        const { events = [], nextState = {} } = await source.ingest({
          lastEventId: state?.last_event_id,
          storage: this.storage,
          log: this.log
        });
        let inserted = 0;
        for (const event of events) {
          try {
            // Auto-create company stub if event has a SIREN (FK constraint)
            if (event.siren && !this.storage.getCompany(event.siren)) {
              const stub = event.normalized?.commercant
                || event.normalized?.nom_entreprise
                || event.raw_data?.commercant?.raisonSociale
                || event.raw_data?.entreprise?.nom
                || event.raw_data?.nom_raison_sociale
                || 'Unknown';
              this.storage.upsertCompany({
                siren: event.siren,
                raison_sociale: stub,
                enriched_source: name
              });
            }
            this.storage.insertEvent(event);
            inserted += 1;
          } catch (e) {
            this.log.error?.(`[trigger-engine] insert failed for ${name}:`, e.message);
          }
        }
        this.storage.updateIngestionState(name, {
          ...nextState,
          events_last_run: inserted,
          last_run_at: new Date().toISOString()
        });
        this.storage.incrementMetric('events_captured', inserted);
        results[name] = { inserted };
      } catch (err) {
        this.log.error?.(`[trigger-engine] ingestion error for ${name}:`, err);
        this.storage.updateIngestionState(name, {
          errors_last_run: 1,
          last_error: String(err.message || err),
          last_run_at: new Date().toISOString()
        });
        results[name] = { error: String(err.message || err) };
      }
    }
    return results;
  }

  /**
   * Get health/stats for monitoring
   */
  getStats() {
    return this.storage.getStats();
  }

  close() {
    this.storage.close();
  }
}

module.exports = { TriggerEngineHandler };
