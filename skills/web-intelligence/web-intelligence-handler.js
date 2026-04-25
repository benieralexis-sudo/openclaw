'use strict';

/**
 * STUB v2.0-cleanup — Web Intelligence legacy désactivé.
 * La veille est intégrée via les sources Trigger Engine
 * (RSS levées, news-buzz, Google Trends, Meta Ad Library).
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class WebIntelligenceHandler {
  constructor() {
    this.skipped = true;
    this.pendingConversations = {};
  }
  start() { return; }
  stop() { return; }
  async handle() { return SKIPPED; }
  async runScans() { return SKIPPED; }
  async runDigest() { return SKIPPED; }
}

module.exports = WebIntelligenceHandler;
