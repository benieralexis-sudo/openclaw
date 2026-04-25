'use strict';

/**
 * STUB v2.0-cleanup — precall-brief legacy désactivé.
 * Briefs RDV générés via le pipeline Claude Brain "brief"
 * (Opus 4.7, 1M context, 2000 mots niveau consultant senior).
 * Voir skills/trigger-engine/claude-brain/pipelines.js et prompts/brief.md.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

module.exports = {
  sendPrecallBrief: async () => SKIPPED,
  generatePrecallBrief: async () => SKIPPED
};
