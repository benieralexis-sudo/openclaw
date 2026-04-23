'use strict';

/**
 * Cache Claude Brain — J2 stub.
 * Au J2 : wrapping Anthropic SDK avec cache_control: ephemeral sur les blocs stables.
 * Au J1 : module vide, exporté pour éviter les erreurs de require.
 */

function markEphemeral(block) {
  return { ...block, cache_control: { type: 'ephemeral' } };
}

module.exports = { markEphemeral };
