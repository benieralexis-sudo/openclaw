'use strict';

/**
 * STUB v2.0-cleanup — Proactive Engine legacy désactivé.
 * Les rapports et alertes sont gérés via skills/trigger-engine/claude-brain/
 * (digest hebdomadaire + realtime alerts pépites).
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class ProactiveEngine {
  start() { return; }
  stop() { return; }
  constructor() { this.skipped = true; }
  async run() { return SKIPPED; }
  async generateDailyReport() { return SKIPPED; }
  async generateWeeklyReport() { return SKIPPED; }
  async generateMonthlyReport() { return SKIPPED; }
  async checkSmartAlerts() { return SKIPPED; }
  async checkPipelineAlerts() { return SKIPPED; }
}

module.exports = ProactiveEngine;
