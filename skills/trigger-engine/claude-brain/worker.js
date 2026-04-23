'use strict';

/**
 * Claude Brain Worker — stub J1.
 * Implémentation complète au Jour 3 : boucle claim/execute/complete,
 * circuit breaker, rate limiting global + par tenant, idempotence cache.
 *
 * Au J1, le worker existe mais est no-op (n'exécute aucun job).
 * Ça permet au système complet d'être wired sans risque de consommer de l'Opus.
 */

class ClaudeBrainWorker {
  constructor({ storage, queue, context, budget, log, pollIntervalMs = 5000 }) {
    this.storage = storage;
    this.queue = queue;
    this.context = context;
    this.budget = budget;
    this.log = log || console;
    this.pollIntervalMs = pollIntervalMs;
    this.running = false;
    this._timer = null;
    this.workerId = 'w-' + Math.random().toString(36).slice(2, 10);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.log.info?.(`[claude-brain-worker] ${this.workerId} started (J1 stub — no job execution yet)`);
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.log.info?.(`[claude-brain-worker] ${this.workerId} stopped`);
  }

  _schedule() {
    if (!this.running) return;
    this._timer = setTimeout(() => this._tick().catch(e => {
      this.log.error?.(`[claude-brain-worker] tick error: ${e.message}`);
    }).finally(() => this._schedule()), this.pollIntervalMs);
  }

  async _tick() {
    // J1 : worker idle, ne claim pas de jobs.
    // J3 : claim, execute pipeline, complete/fail.
    return;
  }
}

module.exports = { ClaudeBrainWorker };
