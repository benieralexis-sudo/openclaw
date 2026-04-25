'use strict';

/**
 * STUB v2.0-cleanup — Campaign Engine legacy désactivé.
 * Remplacé par Smartlead (claude-brain/smartlead-client.js).
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

module.exports = {
  enqueueFollowUp: async () => SKIPPED,
  scheduleSequence: async () => SKIPPED,
  cancelSequence: async () => SKIPPED,
  pauseSequence: async () => SKIPPED,
  triggerNextStep: async () => SKIPPED
};
