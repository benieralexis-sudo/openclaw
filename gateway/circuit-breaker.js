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

  /**
   * Verifie si le circuit est ouvert (service indisponible).
   * Retourne true si OPEN et cooldown pas encore expire.
   * @returns {boolean}
   */
  isBroken() {
    if (this.state !== 'OPEN') return false;
    const elapsed = Date.now() - this.lastFailureAt;
    if (elapsed > this.cooldownMs) {
      // Cooldown expire, passer en HALF_OPEN
      this.state = 'HALF_OPEN';
      return false;
    }
    return true;
  }

  getStatus() {
    return { name: this.name, state: this.state, failures: this.failures };
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
  }
}

// Registre per-tenant des circuit breakers (Phase B1)
// Key = `${clientId}:${name}` quand clientId présent, sinon `name` (legacy global).
// clientId résolu en priorité : opts.clientId > process.env.CLIENT_NAME > null.
// Conséquence : chaque container client (avec CLIENT_NAME injecté par docker-compose)
// a SES PROPRES breakers isolés sans modifier les 20+ call sites existants.
const _breakers = {};

function _resolveKey(name, opts) {
  const clientId = (opts && opts.clientId) || process.env.CLIENT_NAME || null;
  return clientId ? `${clientId}:${name}` : name;
}

function getBreaker(name, opts) {
  const key = _resolveKey(name, opts);
  if (!_breakers[key]) {
    // Use the bare `name` for the breaker label so logs stay readable;
    // tenant scoping happens at the registry level via the key.
    _breakers[key] = new CircuitBreaker(name, opts);
  }
  return _breakers[key];
}

function getAllStatus() {
  const result = {};
  for (const key of Object.keys(_breakers)) {
    result[key] = _breakers[key].getStatus();
  }
  return result;
}

// Reset all breakers for a given tenant (or globally if clientId omitted).
// Useful for ops: a stuck breaker on one client should not require restart of all.
function resetForTenant(clientId) {
  const prefix = clientId ? `${clientId}:` : null;
  for (const key of Object.keys(_breakers)) {
    if (!prefix || key.startsWith(prefix)) {
      _breakers[key].reset();
    }
  }
}

module.exports = { CircuitBreaker, getBreaker, getAllStatus, resetForTenant };
