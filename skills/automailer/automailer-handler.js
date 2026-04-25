'use strict';

/**
 * STUB v2.0-cleanup — AutoMailer legacy désactivé.
 * L'envoi cold email se fait via skills/trigger-engine/claude-brain/smartlead-client.js.
 * Le storage automailer/storage.js reste utilisé par reply-pipeline pour
 * historique des envois iFIND brand.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class AutoMailerHandler {
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
  async sendCampaign() { return SKIPPED; }
  async sendFollowUp() { return SKIPPED; }
}

module.exports = AutoMailerHandler;
