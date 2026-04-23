'use strict';

/**
 * Claude Brain — module principal
 * Orchestration des 4 pipelines : qualify / pitch / brief / discover
 * Wiring : instancié depuis gateway/telegram-router.js si CLAUDE_BRAIN_ENABLED=true
 *
 * Responsabilités :
 *   - exposer enqueue / getResult / ensureTenantConfig / kill switch
 *   - démarrer worker(s) en background
 *   - exposer des hooks pour cron.js (qualify auto après match)
 *
 * Isolation : chaque tenant a son budget, ses prompts, ses pipelines opt-in.
 * Safety : si désactivé par kill switch, toutes les fonctions no-op.
 */

const { ClaudeBrainQueue } = require('./queue');
const { ClaudeBrainWorker } = require('./worker');
const { ContextBuilder } = require('./context-builder');
const { BudgetTracker } = require('./budget');
const telegramAlert = require('../lib/telegram-alert');

const DEFAULT_TENANT_CONFIG = {
  enabled: true,
  pipelines: ['qualify', 'pitch', 'brief', 'discover'],
  monthly_budget_eur: 300,
  hard_cap_eur: 500,
  voice_template: '',
  icp_nuance: '',
  pitch_language: 'vous',
  model_preference: 'claude-opus-4-7',
  auto_send_threshold_opus: 8.5,
  auto_send_threshold_email_confidence: 0.85,
  auto_send_enabled: false,
  auto_pitch_enabled: true,
  auto_pitch_threshold: 8.0
};

class ClaudeBrain {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.db = storage.db;
    this.log = options.log || console;
    this.enabled = options.enabled === true;
    this.budget = new BudgetTracker(this.db, { log: this.log });
    // Dispatch Telegram admin pour alertes budget (skip si --test)
    if (options.telegramModule !== null) {
      this.budget.setTelegramModule(options.telegramModule || telegramAlert);
    }
    this.queue = new ClaudeBrainQueue(this.db, { log: this.log });
    this.context = new ContextBuilder(this.db, { log: this.log });
    this.worker = null;
  }

  /**
   * Start background worker (idempotent).
   * No-op if CLAUDE_BRAIN_ENABLED=false.
   */
  start() {
    if (!this.enabled) {
      this.log.info?.('[claude-brain] disabled via CLAUDE_BRAIN_ENABLED, not starting worker');
      return;
    }
    if (this.worker) return;
    this.worker = new ClaudeBrainWorker({
      storage: this.storage,
      queue: this.queue,
      context: this.context,
      budget: this.budget,
      log: this.log,
      killSwitch: () => process.env.CLAUDE_BRAIN_ENABLED === 'true'
    });
    this.worker.start();
    this.log.info?.('[claude-brain] worker started');
  }

  async stop() {
    if (this.worker) {
      await this.worker.stop();
      this.worker = null;
    }
  }

  /**
   * Get tenant config merged with defaults.
   */
  getTenantConfig(tenantId) {
    const row = this.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
    if (!row || !row.claude_brain_config) return { ...DEFAULT_TENANT_CONFIG };
    try {
      return { ...DEFAULT_TENANT_CONFIG, ...JSON.parse(row.claude_brain_config) };
    } catch (e) {
      this.log.warn?.(`[claude-brain] config parse error for tenant ${tenantId}: ${e.message}`);
      return { ...DEFAULT_TENANT_CONFIG };
    }
  }

  /**
   * Ensure a tenant has a default claude_brain_config set.
   * Idempotent.
   */
  ensureTenantConfig(tenantId, overrides = {}) {
    const existing = this.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
    if (existing?.claude_brain_config) return;
    const cfg = { ...DEFAULT_TENANT_CONFIG, ...overrides };
    this.db.prepare('UPDATE clients SET claude_brain_config = ? WHERE id = ?')
      .run(JSON.stringify(cfg), tenantId);
    this.log.info?.(`[claude-brain] seeded config for tenant ${tenantId}`);
  }

  /**
   * Enqueue a qualify job.
   */
  enqueueQualify(tenantId, siren) {
    return this._enqueuePipeline(tenantId, siren, 'qualify', { priority: 5 });
  }

  /**
   * Enqueue a pitch job (priorité haute — user attend).
   */
  enqueuePitch(tenantId, siren, { userTriggered = null } = {}) {
    return this._enqueuePipeline(tenantId, siren, 'pitch', {
      priority: 2,
      payload: userTriggered ? JSON.stringify({ user: userTriggered, ts: Date.now() }) : null
    });
  }

  /**
   * Enqueue a brief job (priorité haute).
   */
  enqueueBrief(tenantId, siren, { userTriggered = null } = {}) {
    return this._enqueuePipeline(tenantId, siren, 'brief', {
      priority: 2,
      payload: userTriggered ? JSON.stringify({ user: userTriggered, ts: Date.now() }) : null
    });
  }

  _enqueuePipeline(tenantId, siren, pipeline, { priority = 5, payload = null } = {}) {
    if (!this.enabled) return { skipped: true, reason: 'disabled' };
    const cfg = this.getTenantConfig(tenantId);
    if (!cfg.enabled || !cfg.pipelines.includes(pipeline)) {
      return { skipped: true, reason: 'pipeline-not-enabled' };
    }
    return this.queue.enqueue({
      tenant_id: tenantId,
      pipeline,
      siren,
      priority,
      payload
    });
  }

  /**
   * Attend la complétion d'un job (polling DB). Retourne le result ou null si timeout.
   * Utilisé pour les endpoints on-demand (pitch/brief) où l'user attend le résultat.
   */
  async waitForResult(jobId, { timeoutMs = 30_000, pollMs = 500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = this.db.prepare('SELECT status, error FROM claude_brain_queue WHERE id = ?').get(jobId);
      if (!job) return { status: 'not-found' };
      if (job.status === 'completed') {
        const jobRow = this.db.prepare('SELECT tenant_id, siren, pipeline FROM claude_brain_queue WHERE id = ?').get(jobId);
        const result = this.db.prepare(`
          SELECT id, version, result_json, model, tokens_input, tokens_output, tokens_cached,
                 cost_eur, latency_ms, created_at
          FROM claude_brain_results
          WHERE job_id = ? ORDER BY version DESC LIMIT 1
        `).get(jobId);
        if (result) {
          let parsed = null;
          try { parsed = JSON.parse(result.result_json); } catch { parsed = result.result_json; }
          return { status: 'completed', result: parsed, meta: result, siren: jobRow?.siren };
        }
        return { status: 'completed-no-result' };
      }
      if (job.status === 'dead') {
        return { status: 'dead', error: job.error };
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    return { status: 'timeout' };
  }

  /**
   * Get latest result for a given (tenant, siren, pipeline).
   */
  getLatestResult(tenantId, siren, pipeline) {
    return this.db.prepare(`
      SELECT * FROM claude_brain_results
      WHERE tenant_id = ? AND siren = ? AND pipeline = ?
      ORDER BY version DESC, created_at DESC
      LIMIT 1
    `).get(tenantId, siren, pipeline);
  }

  getStats() {
    const queue = this.db.prepare(`
      SELECT status, COUNT(*) as n FROM claude_brain_queue GROUP BY status
    `).all();
    const usage = this.db.prepare(`
      SELECT tenant_id, SUM(cost_eur) as cost, COUNT(*) as n
      FROM claude_brain_usage
      WHERE month_key = strftime('%Y-%m', 'now')
      GROUP BY tenant_id
    `).all();
    return { enabled: this.enabled, queue, usage };
  }
}

module.exports = { ClaudeBrain, DEFAULT_TENANT_CONFIG };
