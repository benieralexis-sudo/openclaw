// iFIND - Circuit Breaker simple
// Evite les cascades d'erreurs quand une API externe tombe
'use strict';

const log = require('./logger.js');

class CircuitBreaker {
  /**
   * @param {string} name - Nom du service (ex: 'openai', 'hubspot', 'claude')
   * @param {Object} opts
   * @param {number} opts.failureThreshold - Nombre d'echecs avant ouverture (defaut: 3)
   * @param {number} opts.cooldownMs - Temps de cooldown avant demi-ouverture (defaut: 60000)
   */
  constructor(name, opts) {
    opts = opts || {};
    this.name = name;
    this.failureThreshold = opts.failureThreshold || 5;
    this.cooldownMs = opts.cooldownMs || 30000;
    this.failures = 0;
    this.lastFailureAt = 0;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  /**
   * Execute fn() a travers le circuit breaker.
   * Si le circuit est OPEN, rejette immediatement (fail-fast).
   * Si le circuit est HALF_OPEN, laisse passer un essai.
   */
  async call(fn) {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed > this.cooldownMs) {
        this.state = 'HALF_OPEN';
      } else {
        const remaining = Math.round((this.cooldownMs - elapsed) / 1000);
        throw new Error('[circuit-breaker] ' + this.name + ' indisponible — reessaie dans ' + remaining + 's');
      }
    }

    try {
      const result = await fn();
      // Succes : fermer le circuit
      if (this.state === 'HALF_OPEN') {
        log.info('circuit-breaker', this.name + ' retabli (CLOSED)');
      }
      this.state = 'CLOSED';
      this.failures = 0;
      return result;
    } catch (e) {
      this.failures++;
      this.lastFailureAt = Date.now();
      if (this.failures >= this.failureThreshold && this.state !== 'OPEN') {
        this.state = 'OPEN';
        log.warn('circuit-breaker', this.name + ' OPEN apres ' + this.failures + ' echecs consecutifs (cooldown ' + (this.cooldownMs / 1000) + 's)');
      }
      throw e;
    }
  }

  getStatus() {
    return { name: this.name, state: this.state, failures: this.failures };
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
  }
}

// Registre global des circuit breakers pour monitoring
const _breakers = {};

function getBreaker(name, opts) {
  if (!_breakers[name]) {
    _breakers[name] = new CircuitBreaker(name, opts);
  }
  return _breakers[name];
}

function getAllStatus() {
  const result = {};
  for (const name of Object.keys(_breakers)) {
    result[name] = _breakers[name].getStatus();
  }
  return result;
}

module.exports = { CircuitBreaker, getBreaker, getAllStatus };
