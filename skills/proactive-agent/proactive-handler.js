'use strict';

/**
 * STUB v2.0-cleanup — Proactive Handler legacy désactivé.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class ProactiveHandler {
  constructor() {
    this.skipped = true;
    this.pendingConversations = {};
  }
  start() { return; }
  stop() { return; }
  async handle() { return SKIPPED; }
  async handleMessage() { return SKIPPED; }
}

module.exports = ProactiveHandler;
