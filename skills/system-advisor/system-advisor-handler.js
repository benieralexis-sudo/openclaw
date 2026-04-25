'use strict';

/**
 * STUB v2.0-cleanup — System Advisor legacy désactivé.
 * Le monitoring est intégré via gateway/instrument.js (Sentry) +
 * source-health (skills/trigger-engine/lib/).
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class SystemAdvisorHandler {
  constructor() {
    this.skipped = true;
    this.pendingConversations = {};
  }
  start() { return; }
  stop() { return; }
  async handle() { return SKIPPED; }
  async runHealthCheck() { return SKIPPED; }
  async runDailyReport() { return SKIPPED; }
  async runWeeklyReport() { return SKIPPED; }
  async snapshotSystem() { return SKIPPED; }
}

module.exports = SystemAdvisorHandler;
