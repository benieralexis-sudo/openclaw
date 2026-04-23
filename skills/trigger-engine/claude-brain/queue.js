'use strict';

const crypto = require('node:crypto');

/**
 * Queue persistante SQLite pour les jobs Claude Brain.
 * - enqueue avec dedup via idempotency_key (7j sliding window)
 * - claim atomique via UPDATE ... RETURNING (simulé avec transactions)
 * - retry avec backoff exponentiel (1 min, 5 min, 15 min)
 * - dead letter queue après max_retries
 */

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const DEDUP_WINDOW_DAYS = 7;

function makeIdempotencyKey({ tenant_id, pipeline, siren, payload }) {
  const h = crypto.createHash('sha256');
  h.update(`${tenant_id}|${pipeline}|${siren || ''}|${payload || ''}`);
  return h.digest('hex').slice(0, 32);
}

class ClaudeBrainQueue {
  constructor(db, options = {}) {
    this.db = db;
    this.log = options.log || console;
  }

  /**
   * Enqueue a job. Idempotent via idempotency_key.
   * Returns { enqueued: true, id } or { enqueued: false, reason: 'duplicate' }.
   */
  enqueue({ tenant_id, pipeline, siren = null, payload = null, priority = 5, max_retries = 3 }) {
    if (!tenant_id || !pipeline) throw new Error('enqueue: tenant_id and pipeline required');
    const key = makeIdempotencyKey({ tenant_id, pipeline, siren, payload });

    // Check dedup : un job avec cette clé existe-t-il dans les 7 derniers jours ?
    const existing = this.db.prepare(`
      SELECT id, status FROM claude_brain_queue
      WHERE idempotency_key = ?
        AND (julianday('now') - julianday(created_at)) < ?
      ORDER BY created_at DESC LIMIT 1
    `).get(key, DEDUP_WINDOW_DAYS);

    if (existing) {
      return { enqueued: false, reason: 'duplicate', id: existing.id, status: existing.status };
    }

    const result = this.db.prepare(`
      INSERT INTO claude_brain_queue (tenant_id, pipeline, siren, payload, idempotency_key, priority, max_retries)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenant_id, pipeline, siren, payload, key, priority, max_retries);

    return { enqueued: true, id: result.lastInsertRowid, idempotency_key: key };
  }

  /**
   * Claim a pending job for processing.
   * Atomic via transaction + status check.
   * Returns null if no job available.
   */
  claim(workerId) {
    if (!workerId) throw new Error('claim: workerId required');
    const job = this.db.prepare(`
      SELECT * FROM claude_brain_queue
      WHERE status = 'pending'
        AND (scheduled_at IS NULL OR scheduled_at <= CURRENT_TIMESTAMP)
      ORDER BY priority ASC, scheduled_at ASC
      LIMIT 1
    `).get();
    if (!job) return null;

    const result = this.db.prepare(`
      UPDATE claude_brain_queue
      SET status = 'claimed', worker_id = ?, claimed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(workerId, job.id);

    if (result.changes === 0) return null; // racé par un autre worker
    return { ...job, status: 'claimed', worker_id: workerId };
  }

  complete(jobId, resultMeta = {}) {
    this.db.prepare(`
      UPDATE claude_brain_queue
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);
  }

  /**
   * Mark job as failed. If retry_count < max_retries, requeue with backoff.
   * Otherwise, mark as 'dead'.
   */
  fail(jobId, error) {
    const job = this.db.prepare('SELECT * FROM claude_brain_queue WHERE id = ?').get(jobId);
    if (!job) return;
    const nextRetry = (job.retry_count || 0) + 1;
    const errMsg = String(error?.message || error).slice(0, 500);

    if (nextRetry >= job.max_retries) {
      this.db.prepare(`
        UPDATE claude_brain_queue
        SET status = 'dead', failed_at = CURRENT_TIMESTAMP, error = ?, retry_count = ?
        WHERE id = ?
      `).run(errMsg, nextRetry, jobId);
      this.log.warn?.(`[queue] job ${jobId} DEAD after ${nextRetry} retries: ${errMsg}`);
      return;
    }

    const delayMs = RETRY_DELAYS_MS[Math.min(nextRetry - 1, RETRY_DELAYS_MS.length - 1)];
    const scheduledAt = new Date(Date.now() + delayMs).toISOString();
    this.db.prepare(`
      UPDATE claude_brain_queue
      SET status = 'pending', worker_id = NULL, claimed_at = NULL,
          retry_count = ?, error = ?, scheduled_at = ?
      WHERE id = ?
    `).run(nextRetry, errMsg, scheduledAt, jobId);
    this.log.info?.(`[queue] job ${jobId} requeued (retry ${nextRetry}/${job.max_retries}) in ${Math.round(delayMs/1000)}s`);
  }

  stats() {
    return this.db.prepare(`
      SELECT status, COUNT(*) as n FROM claude_brain_queue GROUP BY status
    `).all();
  }
}

module.exports = { ClaudeBrainQueue, makeIdempotencyKey };
