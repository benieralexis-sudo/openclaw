'use strict';

/**
 * STUB v2.0-cleanup — A/B testing legacy désactivé.
 * Variants gérés directement par Smartlead.
 */

const SKIPPED = { skipped: true, reason: 'legacy-deprecated-v2-cleanup' };

module.exports = {
  recordVariantResult: async () => SKIPPED,
  pickVariant: () => null,
  getVariantStats: async () => SKIPPED
};
