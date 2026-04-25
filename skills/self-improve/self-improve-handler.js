'use strict';

/**
 * STUB v2.0-cleanup — Self-Improve legacy désactivé.
 * L'optimisation continue se fait via patterns/discover (skills/trigger-engine/).
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class SelfImproveHandler {
  constructor() { this.skipped = true; }
  start() { return; }
  stop() { return; }
  async handle() { return SKIPPED; }
  async runAnalysis() { return SKIPPED; }
}

module.exports = SelfImproveHandler;
