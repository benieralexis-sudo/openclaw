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
const { sendDailyDigests, parisHour, sendWeeklyDigests, parisDayOfWeek } = require('./claude-brain/digest-email');
const { sendRealtimeAlerts } = require('./claude-brain/realtime-alert');

class TriggerEngineCron {
  constructor(handler, processor, options = {}) {
    this.handler = handler;
    this.processor = processor;
    this.clientRouter = options.clientRouter || null;
    this.claudeBrain = options.claudeBrain || null;
    this.log = options.log || console;
    this.intervals = [];
    this._registerSources();
  }

  /**
   * Enqueue pitch auto pour les leads Opus ≥ seuil tenant (défaut 8.0).
   * Déclenché après qualify : les leads "red" ont un pitch prêt sans clic.
   * Idempotent : skip si un pitch existe déjà dans les 7 derniers jours.
   */
  _enqueueAutoPitchesForRedLeads() {
    if (!this.claudeBrain || !this.claudeBrain.enabled) return { enqueued: 0 };
    const db = this.handler.storage.db;
    const tenants = db.prepare(`
      SELECT id, claude_brain_config FROM clients WHERE status = 'active'
    `).all();
    let totalEnqueued = 0;
    const stats = { pitch: 0, linkedin: 0, call: 0 };

    for (const t of tenants) {
      let cfg = {};
      try { cfg = t.claude_brain_config ? JSON.parse(t.claude_brain_config) : {}; } catch {}
      if (cfg.enabled === false) continue;
      const threshold = Number(cfg.auto_pitch_threshold ?? 8.0);
      const pipelines = cfg.pipelines || ['pitch', 'linkedin-dm', 'call-brief'];

      // Canaux à auto-générer selon config tenant
      const channels = [];
      if (cfg.auto_pitch_enabled !== false && pipelines.includes('pitch')) {
        channels.push({ name: 'pitch', enqueueFn: 'enqueuePitch' });
      }
      if (cfg.auto_linkedin_enabled !== false && pipelines.includes('linkedin-dm')) {
        channels.push({ name: 'linkedin-dm', enqueueFn: 'enqueueLinkedinDm' });
      }
      if (cfg.auto_call_brief_enabled !== false && pipelines.includes('call-brief')) {
        channels.push({ name: 'call-brief', enqueueFn: 'enqueueCallBrief' });
      }
      if (channels.length === 0) continue;

      for (const channel of channels) {
        // Leads red sans contenu récent sur ce canal (<7j)
        const leads = db.prepare(`
          SELECT cl.siren
          FROM client_leads cl
          LEFT JOIN (
            SELECT tenant_id, siren, MAX(created_at) as last_gen
            FROM claude_brain_results WHERE pipeline = ?
            GROUP BY tenant_id, siren
          ) pp ON pp.tenant_id = cl.client_id AND pp.siren = cl.siren
          WHERE cl.client_id = ?
            AND cl.opus_score >= ?
            AND cl.status IN ('new', 'qualifying')
            AND (pp.last_gen IS NULL OR (julianday('now') - julianday(pp.last_gen)) > 7)
          LIMIT 10
        `).all(channel.name, t.id, threshold);

        for (const lead of leads) {
          const r = this.claudeBrain[channel.enqueueFn](t.id, lead.siren);
          if (r.enqueued) {
            totalEnqueued += 1;
            stats[channel.name === 'linkedin-dm' ? 'linkedin' : channel.name === 'call-brief' ? 'call' : 'pitch'] += 1;
          }
        }
      }
    }
    if (totalEnqueued > 0) {
      this.log.info?.(`[cron] Claude Brain auto-3-canaux : ${totalEnqueued} jobs (pitch=${stats.pitch}, linkedin=${stats.linkedin}, call=${stats.call})`);
    }
    return { enqueued: totalEnqueued, stats };
  }

  /**
   * Enqueue qualify jobs for newly routed client_leads.
   * Only if Claude Brain enabled and lead score >= tenant threshold.
   */
  _enqueueQualifyForNewLeads() {
    if (!this.claudeBrain || !this.claudeBrain.enabled) return { enqueued: 0 };
    const db = this.handler.storage.db;
    // Leads créés dans les 2 dernières heures sans qualification Opus
    const rows = db.prepare(`
      SELECT DISTINCT cl.client_id, cl.siren, cl.score
      FROM client_leads cl
      LEFT JOIN claude_brain_results cbr
        ON cbr.tenant_id = cl.client_id AND cbr.siren = cl.siren AND cbr.pipeline = 'qualify'
      WHERE cl.created_at >= datetime('now', '-2 hours')
        AND cl.status IN ('new', 'qualifying')
        AND cbr.id IS NULL
      LIMIT 50
    `).all();

    let enqueued = 0;
    for (const lead of rows) {
      const r = this.claudeBrain.enqueueQualify(lead.client_id, lead.siren);
      if (r.enqueued) enqueued += 1;
    }
    if (enqueued > 0) this.log.info?.(`[cron] Claude Brain: ${enqueued} qualify jobs enqueued`);
    return { enqueued };
  }

  /**
   * Re-qualify auto sur STALENESS :
   *   - Dernière qualif > 14 jours (seuil fraîcheur par défaut)
   *   OU
   *   - Nouveaux events arrivés sur ce SIREN depuis la dernière qualif
   *   OU
   *   - Nouveaux contacts enrichis depuis la dernière qualif
   *
   * Limite : 30 re-qualif par cycle pour éviter de noyer le worker.
   * Skip : leads discarded/booked (plus de valeur à requalifier).
   */
  _enqueueStaleRequalify() {
    if (!this.claudeBrain || !this.claudeBrain.enabled) return { enqueued: 0 };
    const db = this.handler.storage.db;
    // Seuil staleness configurable par tenant (défaut 14 jours)
    const rows = db.prepare(`
      SELECT DISTINCT cl.client_id, cl.siren, cbr.last_qualif, cbr.last_qualif_id
      FROM client_leads cl
      INNER JOIN (
        SELECT tenant_id, siren, MAX(created_at) as last_qualif, MAX(id) as last_qualif_id
        FROM claude_brain_results
        WHERE pipeline = 'qualify'
        GROUP BY tenant_id, siren
      ) cbr ON cbr.tenant_id = cl.client_id AND cbr.siren = cl.siren
      WHERE cl.status IN ('new', 'qualifying', 'sent')
        AND (
          -- Fraîcheur : dernière qualif > 14 jours
          (julianday('now') - julianday(cbr.last_qualif)) > 14
          -- OU nouveaux events ingérés depuis la dernière qualif
          OR EXISTS (
            SELECT 1 FROM events e
            WHERE e.siren = cl.siren AND e.captured_at > cbr.last_qualif
          )
          -- OU nouveaux contacts enrichis depuis la dernière qualif
          OR EXISTS (
            SELECT 1 FROM leads_contacts lc
            WHERE lc.siren = cl.siren AND lc.discovered_at > cbr.last_qualif
          )
        )
      ORDER BY cbr.last_qualif ASC
      LIMIT 30
    `).all();

    let enqueued = 0;
    for (const lead of rows) {
      const r = this.claudeBrain.enqueueQualify(lead.client_id, lead.siren);
      if (r.enqueued) enqueued += 1;
    }
    if (enqueued > 0) this.log.info?.(`[cron] Claude Brain stale requalify : ${enqueued} jobs enqueued`);
    return { enqueued };
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
          // Enqueue Claude Brain qualify pour les nouveaux leads (si activé)
          this._enqueueQualifyForNewLeads();
        }
        if (result.matches > 0) {
          try {
            const alert = await telegramAlert.checkAndAlert(this.handler.storage.db, { log: this.log });
            if (alert.sent > 0) this.log.info?.(`[cron] Telegram alerts sent: ${alert.sent}/${alert.candidates}`);
          } catch (e) {
            this.log.warn?.(`[cron] alert error: ${e.message}`);
          }
        }
        // Auto-pitch pour les leads red (opus_score ≥ seuil tenant)
        this._enqueueAutoPitchesForRedLeads();

        // Alertes temps réel sur pépites score ≥ 9 (dédup 24h)
        if (this.claudeBrain && this.claudeBrain.enabled) {
          try {
            const alertStats = await sendRealtimeAlerts(this.handler.storage.db, { log: this.log });
            if (alertStats.sent > 0) {
              this.log.info?.(`[cron] realtime alerts: ${alertStats.sent} envoyées, ${alertStats.skipped} skippées`);
            }
          } catch (e) {
            this.log.warn?.(`[cron] realtime-alert error: ${e.message}`);
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

    // Claude Brain Discover : weekly dimanche 23h
    const discoverCheckInterval = setInterval(() => {
      try {
        if (!this.claudeBrain || !this.claudeBrain.enabled) return;
        const now = new Date();
        // Dimanche (0) entre 23h et 23h59, et dernière exécution > 20h
        if (now.getDay() !== 0 || now.getHours() !== 23) return;
        const lastRun = this._lastDiscoverRun || 0;
        if (Date.now() - lastRun < 20 * 3600 * 1000) return;
        this._lastDiscoverRun = Date.now();
        // Un job discover par tenant actif
        const db = this.handler.storage.db;
        const tenants = db.prepare("SELECT id FROM clients WHERE status = 'active'").all();
        let enqueued = 0;
        for (const t of tenants) {
          const r = this.claudeBrain._enqueuePipeline(t.id, null, 'discover', { priority: 8 });
          if (r.enqueued) enqueued += 1;
        }
        if (enqueued > 0) this.log.info?.(`[cron] Claude Brain Discover weekly : ${enqueued} jobs enqueued`);
      } catch (e) {
        this.log.warn?.(`[cron] discover scheduler error: ${e.message}`);
      }
    }, 30 * 60 * 1000); // check toutes les 30 min
    this.intervals.push(discoverCheckInterval);

    // Digest email matin Paris 8h : check toutes les 30 min, envoie si 8h et pas déjà fait
    const digestInterval = setInterval(async () => {
      try {
        if (!this.claudeBrain || !this.claudeBrain.enabled) return;
        const hour = parisHour();
        if (hour !== 8) return; // On ne déclenche qu'à 8h Paris
        const stats = await sendDailyDigests(this.handler.storage.db, { log: this.log });
        if (stats.sent > 0 || stats.failed > 0) {
          this.log.info?.(`[cron] digest matin: ${stats.sent} envoyés, ${stats.skipped} skippés, ${stats.failed} échecs`);
        }
      } catch (e) {
        this.log.warn?.(`[cron] digest error: ${e.message}`);
      }
    }, 30 * 60 * 1000); // Toutes les 30 min
    this.intervals.push(digestInterval);

    // Résumé hebdomadaire (opt-in weekly_digest_enabled) : lundi 8h Paris
    // Check toutes les 30 min, envoie si lundi ET 8h et pas déjà fait cette semaine
    const weeklyDigestInterval = setInterval(async () => {
      try {
        if (!this.claudeBrain || !this.claudeBrain.enabled) return;
        if (parisDayOfWeek() !== 1) return; // 1 = lundi
        if (parisHour() !== 8) return;
        const stats = await sendWeeklyDigests(this.handler.storage.db, { log: this.log });
        if (stats.sent > 0 || stats.failed > 0) {
          this.log.info?.(`[cron] résumé hebdo lundi: ${stats.sent} envoyés, ${stats.skipped} skippés, ${stats.failed} échecs`);
        }
      } catch (e) {
        this.log.warn?.(`[cron] weekly digest error: ${e.message}`);
      }
    }, 30 * 60 * 1000);
    this.intervals.push(weeklyDigestInterval);

    // Claude Brain Stale Requalify : every 4h (détecte et re-qualifie les leads
    // dont la qualif est vieille OU qui ont de nouveaux events/contacts depuis)
    const staleRequalifyInterval = setInterval(() => {
      try {
        this._enqueueStaleRequalify();
      } catch (e) {
        this.log.warn?.(`[cron] stale requalify error: ${e.message}`);
      }
    }, 4 * 3600 * 1000);
    this.intervals.push(staleRequalifyInterval);

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
