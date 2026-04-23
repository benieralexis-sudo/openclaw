// ═══════════════════════════════════════════════════════════════════
// Trigger Engine Cron — schedule des ingestions + processing
// ═══════════════════════════════════════════════════════════════════
// Orchestrateur de cron jobs pour le Trigger Engine.
// Appelé depuis gateway/cron-manager.js.
//
// Schedule:
//   - BODACC ingestion       : toutes les 6h (daily publications)
//   - JOAFE ingestion        : toutes les 12h
//   - France Travail         : toutes les 2h (quotas 3k req/jour)
//   - Pattern processing     : toutes les 15 min (traite events unprocessed)
//   - Cleanup expired        : 1x/jour (03h00)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const bodacc = require('./sources/bodacc');
const joafe = require('./sources/joafe');
const francetravail = require('./sources/francetravail');
const inpi = require('./sources/inpi');
const rssLevees = require('./sources/rss-levees');
const newsBuzz = require('./sources/news-buzz');
const googleTrends = require('./sources/google-trends');
const metaAdLibrary = require('./sources/meta-ad-library');
const telegramAlert = require('./lib/telegram-alert');
const sourceHealth = require('./lib/source-health');
const { enrichMatches } = require('./contact-enricher');

class TriggerEngineCron {
  constructor(handler, processor, options = {}) {
    this.handler = handler;
    this.processor = processor;
    this.clientRouter = options.clientRouter || null;
    this.log = options.log || console;
    this.intervals = [];
    this._registerSources();
  }

  _registerSources() {
    this.handler.registerSource('bodacc', bodacc);
    this.handler.registerSource('joafe', joafe);
    this.handler.registerSource('francetravail', francetravail);
    this.handler.registerSource('inpi', inpi);
    this.handler.registerSource('rss-levees', rssLevees);
    this.handler.registerSource('news-buzz', newsBuzz);
    this.handler.registerSource('google-trends', googleTrends);
    this.handler.registerSource('meta-ad-library', metaAdLibrary);
  }

  /**
   * Start all intervals. Returns a cleanup function.
   */
  start() {
    this.log.info?.('[trigger-engine-cron] starting schedules');

    // BODACC: every 6h
    const bodaccInterval = setInterval(() => {
      this.handler.runIngestion('bodacc').catch(err => {
        this.log.error?.('[cron] bodacc:', err.message);
      });
    }, 6 * 3600 * 1000);
    this.intervals.push(bodaccInterval);

    // JOAFE: every 12h
    const joafeInterval = setInterval(() => {
      this.handler.runIngestion('joafe').catch(err => {
        this.log.error?.('[cron] joafe:', err.message);
      });
    }, 12 * 3600 * 1000);
    this.intervals.push(joafeInterval);

    // France Travail: every 2h
    const ftInterval = setInterval(() => {
      this.handler.runIngestion('francetravail').catch(err => {
        this.log.error?.('[cron] francetravail:', err.message);
      });
    }, 2 * 3600 * 1000);
    this.intervals.push(ftInterval);

    // INPI: every 24h (stub for now)
    const inpiInterval = setInterval(() => {
      this.handler.runIngestion('inpi').catch(err => {
        this.log.error?.('[cron] inpi:', err.message);
      });
    }, 24 * 3600 * 1000);
    this.intervals.push(inpiInterval);

    // RSS Levées FR: every 6h (volume faible, pas besoin de plus fréquent)
    const rssInterval = setInterval(() => {
      this.handler.runIngestion('rss-levees').catch(err => {
        this.log.error?.('[cron] rss-levees:', err.message);
      });
    }, 6 * 3600 * 1000);
    this.intervals.push(rssInterval);

    // News Buzz : every 12h (check les matches actifs via Google News RSS)
    const buzzInterval = setInterval(() => {
      this.handler.runIngestion('news-buzz').catch(err => {
        this.log.error?.('[cron] news-buzz:', err.message);
      });
    }, 12 * 3600 * 1000);
    this.intervals.push(buzzInterval);

    // Google Trends : every 24h (faible volume, cache 24h)
    const trendsInterval = setInterval(() => {
      this.handler.runIngestion('google-trends').catch(err => {
        this.log.error?.('[cron] google-trends:', err.message);
      });
    }, 24 * 3600 * 1000);
    this.intervals.push(trendsInterval);

    // Meta Ad Library : every 24h (cache 24h, dépend vérif identité Meta)
    const metaInterval = setInterval(() => {
      this.handler.runIngestion('meta-ad-library').catch(err => {
        this.log.error?.('[cron] meta-ad-library:', err.message);
      });
    }, 24 * 3600 * 1000);
    this.intervals.push(metaInterval);

    // Pattern processing: every 15 min
    const processInterval = setInterval(async () => {
      try {
        const result = this.processor.processUnprocessed();
        if (result.processed > 0) {
          this.log.info?.(`[cron] processed ${result.processed} events, ${result.matches} new matches`);
        }
        if (this.clientRouter && result.matches > 0) {
          const r = this.clientRouter.routeAllActiveMatches();
          this.log.info?.(`[cron] routed matches → clients: total=${r.total} created=${r.created} updated=${r.updated} ${JSON.stringify(r.clients)}`);
        }
        if (result.matches > 0) {
          try {
            const alert = await telegramAlert.checkAndAlert(this.handler.storage.db, { log: this.log });
            if (alert.sent > 0) this.log.info?.(`[cron] Telegram alerts sent: ${alert.sent}/${alert.candidates}`);
          } catch (e) {
            this.log.warn?.(`[cron] alert error: ${e.message}`);
          }
        }
      } catch (err) {
        this.log.error?.('[cron] processor:', err.message);
      }
    }, 15 * 60 * 1000);
    this.intervals.push(processInterval);

    // Contact enrichment + MX verify : every 2h (traite les nouveaux matches)
    const enrichInterval = setInterval(async () => {
      try {
        const r = await enrichMatches(this.handler.storage.db, { log: this.log, limit: 20 });
        if (r.dirigeants_inserted > 0) {
          this.log.info?.(`[cron] contact enrichment: ${r.sirens_processed} SIRENs, ${r.dirigeants_inserted} dirigeants, ${r.emails_found} emails`);
        }
      } catch (e) {
        this.log.warn?.(`[cron] enrich error: ${e.message}`);
      }
    }, 2 * 3600 * 1000);
    this.intervals.push(enrichInterval);

    // Monitoring santé sources : every 1h
    const healthInterval = setInterval(async () => {
      try {
        const h = await sourceHealth.checkHealth(this.handler.storage.db, { log: this.log });
        if (h.alerted > 0) {
          this.log.warn?.(`[cron] source health alerts: ${h.alerted} envoyées (stale=${h.stale.length}, error=${h.error.length})`);
        }
      } catch (e) {
        this.log.warn?.(`[cron] health check error: ${e.message}`);
      }
    }, 3600 * 1000);
    this.intervals.push(healthInterval);

    // Cleanup expired: every 24h
    const cleanupInterval = setInterval(() => {
      try {
        const n = this.processor.cleanupExpired();
        if (n > 0) this.log.info?.(`[cron] cleaned up ${n} expired matches`);
      } catch (err) {
        this.log.error?.('[cron] cleanup:', err.message);
      }
    }, 24 * 3600 * 1000);
    this.intervals.push(cleanupInterval);

    // Run once at startup (after 30s warmup)
    setTimeout(() => {
      this.log.info?.('[trigger-engine-cron] running initial ingestion cycle');
      this.handler.runIngestion().then(results => {
        this.log.info?.('[cron] initial ingestion:', JSON.stringify(results));
        try {
          const r = this.processor.processUnprocessed();
          this.log.info?.(`[cron] initial processing: ${r.matches} matches`);
          if (this.clientRouter) {
            const routed = this.clientRouter.routeAllActiveMatches();
            this.log.info?.(`[cron] initial routing → ${JSON.stringify(routed)}`);
          }
        } catch (err) {
          this.log.error?.('[cron] initial processing error:', err.message);
        }
      }).catch(err => this.log.error?.('[cron] initial ingestion error:', err.message));
    }, 30 * 1000);

    return () => this.stop();
  }

  stop() {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    this.log.info?.('[trigger-engine-cron] stopped');
  }
}

module.exports = { TriggerEngineCron };
