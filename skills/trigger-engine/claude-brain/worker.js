'use strict';

/**
 * Claude Brain Worker — boucle claim/execute/complete.
 *
 * - Claim job depuis la queue toutes les pollIntervalMs (5s par défaut)
 * - Vérifie circuit breaker + rate limiter + kill switch avant execution
 * - Delegue au PipelineExecutor
 * - En cas d'erreur : queue.fail() avec backoff, circuit breaker record failure
 * - Graceful shutdown sur stop() : finit le job en cours, puis sort
 */

const { PipelineExecutor } = require('./pipelines');
const { CircuitBreaker, RateLimiter } = require('./circuit-breaker');

class ClaudeBrainWorker {
  constructor({ storage, queue, context, budget, log, pollIntervalMs = 5000, executor, circuitBreaker, rateLimiter, killSwitch }) {
    this.storage = storage;
    this.queue = queue;
    this.context = context;
    this.budget = budget;
    this.log = log || console;
    this.pollIntervalMs = pollIntervalMs;
    this.executor = executor || new PipelineExecutor({ storage, context, budget, log });
    this.circuit = circuitBreaker || new CircuitBreaker({ log });
    this.rate = rateLimiter || new RateLimiter();
    this.killSwitch = killSwitch || (() => process.env.CLAUDE_BRAIN_ENABLED === 'true');
    this.running = false;
    this._busy = false;
    this._timer = null;
    this.workerId = 'w-' + Math.random().toString(36).slice(2, 10);
    this.stats = { processed: 0, failed: 0, skipped_rate_limit: 0, skipped_breaker: 0 };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.log.info?.(`[claude-brain-worker] ${this.workerId} started (pollInterval=${this.pollIntervalMs}ms)`);
    this._schedule();
  }

  async stop() {
    this.running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    // Attendre la fin du job en cours (max 30s)
    const deadline = Date.now() + 30_000;
    while (this._busy && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.log.info?.(`[claude-brain-worker] ${this.workerId} stopped (graceful)`);
  }

  _schedule() {
    if (!this.running) return;
    this._timer = setTimeout(() => {
      this._tick().catch(e => {
        this.log.error?.(`[claude-brain-worker] tick error: ${e.message}`);
      }).finally(() => this._schedule());
    }, this.pollIntervalMs);
  }

  async _tick() {
    if (!this.running) return;
    if (this._busy) return;

    // Kill switch runtime
    if (!this.killSwitch()) return;

    // Circuit breaker ouvert → skip ce tick
    if (!this.circuit.allowRequest()) {
      this.stats.skipped_breaker += 1;
      return;
    }

    // Claim un job
    const job = this.queue.claim(this.workerId);
    if (!job) return;

    // Rate limit check
    const rate = this.rate.allow(job.tenant_id);
    if (!rate.ok) {
      this.stats.skipped_rate_limit += 1;
      // Requeue sans pénaliser retry_count (rollback status pending sans incrémenter)
      this.storage.db.prepare(`
        UPDATE claude_brain_queue
        SET status = 'pending', worker_id = NULL, claimed_at = NULL,
            scheduled_at = datetime('now', '+30 seconds')
        WHERE id = ?
      `).run(job.id);
      this.log.info?.(`[worker] rate limit ${rate.reason}, job ${job.id} requeued +30s`);
      return;
    }

    this._busy = true;
    const startedAt = Date.now();
    try {
      const out = await this.executor.execute(job);
      this.queue.complete(job.id);
      this.circuit.recordResult(true);
      this.stats.processed += 1;
      this.log.info?.(`[worker] ok ${job.pipeline}/${job.siren || '-'} tenant=${job.tenant_id} cost=${out.cost_eur.toFixed(4)}€ latency=${out.latency_ms}ms cache=${out.usage.cachedTokens}/${out.usage.inputTokens}`);
    } catch (err) {
      this.queue.fail(job.id, err);
      this.circuit.recordResult(false);
      this.stats.failed += 1;
      this.log.warn?.(`[worker] fail ${job.pipeline}/${job.siren || '-'} (job ${job.id}): ${err.message}`);
    } finally {
      this._busy = false;
    }
  }

  getStats() {
    return {
      worker_id: this.workerId,
      running: this.running,
      busy: this._busy,
      ...this.stats,
      circuit: this.circuit.getState(),
      rate: this.rate.getStats()
    };
  }
}

module.exports = { ClaudeBrainWorker };
