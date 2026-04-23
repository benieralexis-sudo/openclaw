'use strict';

/**
 * Circuit breaker + rate limiter pour les appels Anthropic.
 *
 * Circuit breaker :
 *   - Tracking fenêtre glissante 5 minutes des calls (success/fail)
 *   - Si taux erreur > ERROR_THRESHOLD (20%) avec au moins MIN_SAMPLES (5) appels → OUVERT
 *   - État OUVERT : bloque tous les appels pendant PAUSE_MS (15 min)
 *   - Après pause : HALF-OPEN → autorise 1 appel test. Si OK → FERMÉ, sinon → OUVERT encore
 *
 * Rate limiter token bucket :
 *   - Global : 50 requêtes/min (réglage conservateur)
 *   - Par tenant : 20 req/min (réglage conservateur)
 *   - Implémentation in-memory (suffisant pour 1 process worker)
 */

const WINDOW_MS = 5 * 60_000;
const ERROR_THRESHOLD = 0.20;
const MIN_SAMPLES = 5;
const PAUSE_MS = 15 * 60_000;
const HALF_OPEN_AFTER_MS = PAUSE_MS;

const STATES = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

class CircuitBreaker {
  constructor(options = {}) {
    this.windowMs = options.windowMs || WINDOW_MS;
    this.errorThreshold = options.errorThreshold ?? ERROR_THRESHOLD;
    this.minSamples = options.minSamples ?? MIN_SAMPLES;
    this.pauseMs = options.pauseMs ?? PAUSE_MS;
    this.log = options.log || console;
    this.samples = []; // [{ ts, success }]
    this.state = STATES.CLOSED;
    this.openedAt = 0;
    this._halfOpenTrialInFlight = false;
  }

  _pruneOldSamples() {
    const cutoff = Date.now() - this.windowMs;
    while (this.samples.length && this.samples[0].ts < cutoff) this.samples.shift();
  }

  _errorRate() {
    this._pruneOldSamples();
    if (this.samples.length < this.minSamples) return 0;
    const errors = this.samples.filter(s => !s.success).length;
    return errors / this.samples.length;
  }

  /**
   * Retourne true si un appel peut passer.
   */
  allowRequest() {
    const now = Date.now();
    if (this.state === STATES.OPEN) {
      if (now - this.openedAt >= this.pauseMs) {
        this.state = STATES.HALF_OPEN;
        this._halfOpenTrialInFlight = false;
        this.log.info?.(`[circuit-breaker] half-open, testing`);
      } else {
        return false;
      }
    }
    if (this.state === STATES.HALF_OPEN) {
      // Un seul appel test autorisé à la fois
      if (this._halfOpenTrialInFlight) return false;
      this._halfOpenTrialInFlight = true;
      return true;
    }
    return true;
  }

  /**
   * Enregistre le résultat d'un appel.
   */
  recordResult(success) {
    this.samples.push({ ts: Date.now(), success });
    if (this.state === STATES.HALF_OPEN) {
      this._halfOpenTrialInFlight = false;
      if (success) {
        this.state = STATES.CLOSED;
        this.samples = []; // reset après recovery
        this.log.info?.(`[circuit-breaker] closed (recovery ok)`);
      } else {
        this._open();
      }
      return;
    }
    // État CLOSED
    const rate = this._errorRate();
    if (rate > this.errorThreshold) this._open();
  }

  _open() {
    this.state = STATES.OPEN;
    this.openedAt = Date.now();
    this.log.warn?.(`[circuit-breaker] OPEN (pause ${Math.round(this.pauseMs / 60000)}min)`);
  }

  getState() {
    return {
      state: this.state,
      error_rate: this._errorRate(),
      samples: this.samples.length,
      opened_at: this.openedAt || null
    };
  }

  reset() {
    this.samples = [];
    this.state = STATES.CLOSED;
    this.openedAt = 0;
    this._halfOpenTrialInFlight = false;
  }
}

/**
 * Rate limiter token bucket (par clé).
 * - capacity : tokens max en bucket
 * - refillPerMs : tokens ajoutés par ms
 */
class TokenBucket {
  constructor({ capacity = 20, refillPerMin = 20 } = {}) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMin / 60_000;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  /**
   * Essaie de consommer 1 token. Retourne true si ok, false si rate limit atteint.
   */
  consume() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  getAvailable() {
    this._refill();
    return this.tokens;
  }
}

/**
 * Rate limiter multi-clés (un bucket par tenant).
 */
class RateLimiter {
  constructor(options = {}) {
    this.global = new TokenBucket({
      capacity: options.globalPerMin || 50,
      refillPerMin: options.globalPerMin || 50
    });
    this.perTenantCapacity = options.perTenantPerMin || 20;
    this.perTenantBuckets = new Map();
  }

  allow(tenantId) {
    if (!this.global.consume()) return { ok: false, reason: 'global-rate-limit' };
    let bucket = this.perTenantBuckets.get(tenantId);
    if (!bucket) {
      bucket = new TokenBucket({ capacity: this.perTenantCapacity, refillPerMin: this.perTenantCapacity });
      this.perTenantBuckets.set(tenantId, bucket);
    }
    if (!bucket.consume()) {
      // Rollback global token (on rend le token que le tenant ne peut consumer)
      this.global.tokens = Math.min(this.global.capacity, this.global.tokens + 1);
      return { ok: false, reason: 'tenant-rate-limit' };
    }
    return { ok: true };
  }

  getStats() {
    return {
      global_available: this.global.getAvailable(),
      tenant_buckets: Array.from(this.perTenantBuckets.entries()).map(([t, b]) => ({
        tenant: t,
        available: b.getAvailable()
      }))
    };
  }
}

module.exports = { CircuitBreaker, TokenBucket, RateLimiter, STATES };
