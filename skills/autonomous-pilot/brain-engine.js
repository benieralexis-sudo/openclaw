'use strict';

/**
 * STUB v2.0-cleanup — brain engine legacy désactivé.
 * Voir skills/trigger-engine/claude-brain/ pour l'architecture actuelle.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class BrainEngine {
  start() { return; }
  stop() { return; }
  constructor() { this.skipped = true; }
  async runCycle() { return SKIPPED; }
  async runMiniCycle() { return SKIPPED; }
  async decide() { return SKIPPED; }
}

module.exports = BrainEngine;
