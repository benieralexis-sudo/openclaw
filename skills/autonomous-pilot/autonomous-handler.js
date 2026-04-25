'use strict';

/**
 * STUB v2.0-cleanup — handler legacy désactivé.
 *
 * Le bot iFIND v9.5 (autonomous brain cycles 2x/jour) a été retiré au profit
 * du Trigger Engine (skills/trigger-engine/) qui est le produit actuel.
 * Ce stub maintient la compatibilité avec gateway/telegram-router.js qui
 * importe encore ce module au top-level. Sera supprimé lors du refactor router.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class AutonomousHandler {
  constructor() {
    this.skipped = true;
    this.pendingConversations = {};
    this.pendingConfirmations = {};
    this.pendingImports = {};
    this.pendingEmails = {};
    this.pendingResults = {};
  }
  start() { return; }
  stop() { return; }
  async handle() { return SKIPPED; }
  async handleMessage() { return SKIPPED; }
  async runBrainCycle() { return SKIPPED; }
  async runMiniCycle() { return SKIPPED; }
  async weeklyReset() { return SKIPPED; }
}

module.exports = AutonomousHandler;
