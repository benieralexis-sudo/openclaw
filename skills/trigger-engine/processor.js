// ═══════════════════════════════════════════════════════════════════
// Trigger Engine Processor — orchestrateur pattern matching
// ═══════════════════════════════════════════════════════════════════
// Prend les events non-traités, les groupe par SIREN, applique les patterns,
// et stocke les matches dans patterns_matched.
//
// Idempotent : peut être exécuté plusieurs fois sans doubler les matches
// (dedup via (siren, pattern_id, window_start, window_end))
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { matchAllPatterns, loadPatterns } = require('./patterns/matcher');

class TriggerEngineProcessor {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.log = options.log || console;
    this.patterns = loadPatterns();
    this.log.info?.(`[processor] loaded ${this.patterns.length} patterns`);
    // Sync patterns to DB so dashboard can display them
    for (const pattern of this.patterns) {
      try {
        this.storage.upsertPattern(pattern);
      } catch (e) {
        this.log.warn?.(`[processor] failed to upsert pattern ${pattern.id}: ${e.message}`);
      }
    }
  }

  /**
   * Reload patterns from disk (called on config change or periodically)
   */
  reloadPatterns() {
    this.patterns = loadPatterns();
    this.log.info?.(`[processor] reloaded ${this.patterns.length} patterns`);
    // Sync to DB table for UI/dashboard visibility
    for (const pattern of this.patterns) {
      this.storage.upsertPattern(pattern);
    }
  }

  /**
   * Process all unprocessed events
   * Groups by SIREN, then runs patterns on each company's event window
   * @param {number} batchSize - max events to process per run
   * @returns {object} stats
   */
  processUnprocessed(batchSize = 5000) {
    const events = this.storage.getUnprocessedEvents(batchSize);
    if (events.length === 0) {
      return { processed: 0, sirensEvaluated: 0, matches: 0 };
    }

    // Group events by SIREN (skip unattributed)
    const bySiren = new Map();
    for (const event of events) {
      if (!event.siren) {
        this.storage.markEventProcessed(event.id);
        continue;
      }
      if (!bySiren.has(event.siren)) bySiren.set(event.siren, []);
      bySiren.get(event.siren).push(event);
    }

    let matchesInserted = 0;
    const now = new Date();

    for (const [siren, sirenEvents] of bySiren) {
      // Fetch all events for this SIREN on 30-day window
      const contextEvents = this.storage.getEventsForSiren(siren, 30);

      const matches = matchAllPatterns(siren, contextEvents, this.patterns);

      for (const match of matches) {
        const windowStart = new Date(now.getTime() - (match.pattern.window_days || 30) * 24 * 3600 * 1000).toISOString();
        const windowEnd = now.toISOString();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();

        try {
          this.storage.insertPatternMatch({
            siren,
            pattern_id: match.pattern.id,
            score: match.score,
            signals: match.signals,
            window_start: windowStart,
            window_end: windowEnd,
            expires_at: expiresAt
          });
          matchesInserted += 1;
          this.log.info?.(`[processor] MATCH: ${siren} / ${match.pattern.id} score=${match.score.toFixed(1)} signals=${match.signals.length}`);
        } catch (err) {
          this.log.error?.(`[processor] insert match failed:`, err.message);
        }
      }

      // Mark this SIREN's events as processed
      for (const event of sirenEvents) {
        this.storage.markEventProcessed(event.id);
      }
    }

    this.storage.incrementMetric('patterns_matched', matchesInserted);
    this.storage.incrementMetric('events_attributed', events.filter(e => e.siren).length);

    return {
      processed: events.length,
      sirensEvaluated: bySiren.size,
      matches: matchesInserted
    };
  }

  /**
   * Garbage collect expired matches (window expired)
   */
  cleanupExpired() {
    const result = this.storage.cleanupExpiredMatches();
    if (result.changes > 0) {
      this.log.info?.(`[processor] cleaned up ${result.changes} expired matches`);
    }
    return result.changes;
  }
}

module.exports = { TriggerEngineProcessor };
