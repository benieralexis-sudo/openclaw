'use strict';

/**
 * STUB v2.0-cleanup — Invoice Bot legacy désactivé.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class InvoiceBotHandler {
  constructor() {
    this.skipped = true;
    this.pendingConversations = {};
    this.pendingConfirmations = {};
  }
  start() { return; }
  stop() { return; }
  async handle() { return SKIPPED; }
  async handleMessage() { return SKIPPED; }
}

module.exports = InvoiceBotHandler;
