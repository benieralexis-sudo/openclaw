'use strict';

/**
 * STUB v2.0-cleanup — ProspectResearcher legacy désactivé.
 * La recherche pré-envoi est intégrée au pipeline Claude Brain "qualify"
 * (skills/trigger-engine/claude-brain/) qui exploite SIRENE/Pappers, BODACC,
 * INPI, France Travail, RSS levées, news-buzz, Google Trends, Meta Ads.
 *
 * Le router gère déjà le cas où ce module est absent (try/catch lazy require)
 * mais on garde le stub pour limiter les warnings au boot.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

class ProspectResearcher {
  constructor() { this.skipped = true; }
  async research() { return SKIPPED; }
  async fetchContext() { return SKIPPED; }
}

module.exports = ProspectResearcher;
