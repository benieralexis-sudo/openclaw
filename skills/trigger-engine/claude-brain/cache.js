'use strict';

/**
 * Cache Claude Brain — prompt caching Anthropic.
 *
 * Anthropic supporte cache_control: {type: 'ephemeral'} sur les blocs de message.
 * Coût réduit -90% sur les tokens cachés lors des 5 min de vie du cache.
 *
 * Stratégie :
 *   - Bloc 1 (system)        : instructions pipeline — stable par pipeline    → CACHÉ
 *   - Bloc 2 (voice)         : voice template tenant — stable par tenant      → CACHÉ
 *   - Bloc 3 (data)          : contexte du lead — variable par appel          → NON CACHÉ
 *
 * Les 2 premiers blocs sont marqués avec cache_control ephemeral.
 * Anthropic hash le contenu pour identifier le cache automatiquement.
 */

const MIN_CACHEABLE_TOKENS = 1024; // seuil Anthropic pour activer le cache sur Opus/Sonnet

/**
 * Ajoute cache_control: ephemeral à un bloc de message Anthropic.
 */
function markEphemeral(block) {
  if (!block) return block;
  return { ...block, cache_control: { type: 'ephemeral' } };
}

/**
 * Construit les messages pour l'API Anthropic avec prompt caching.
 *
 * @param {{systemPrompt: string, voicePrompt: string, dataContext: string}} parts
 * @param {{enableCache?: boolean, minCacheableTokens?: number}} [options]
 * @returns {{system: Array, messages: Array}} Format API Anthropic
 */
function buildCachedMessages({ systemPrompt, voicePrompt, dataContext }, options = {}) {
  const enableCache = options.enableCache !== false;
  const minTokens = options.minCacheableTokens || MIN_CACHEABLE_TOKENS;

  // Estimation rapide tokens ≈ caractères/4 (heuristique standard)
  const systemTokensEst = Math.ceil((systemPrompt || '').length / 4);
  const voiceTokensEst = Math.ceil((voicePrompt || '').length / 4);

  // System blocks (instructions pipeline — toujours en tête)
  const systemBlocks = [];
  if (systemPrompt) {
    const block = { type: 'text', text: systemPrompt };
    // Ne cache que si assez de tokens pour que ça vaille le coup
    systemBlocks.push(enableCache && systemTokensEst >= minTokens ? markEphemeral(block) : block);
  }
  if (voicePrompt) {
    const block = { type: 'text', text: voicePrompt };
    systemBlocks.push(enableCache && voiceTokensEst >= minTokens ? markEphemeral(block) : block);
  }

  // Messages — le data context va dans le user message (non caché)
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: dataContext || '(contexte vide)' }
      ]
    }
  ];

  return { system: systemBlocks, messages };
}

/**
 * Extrait les usages tokens depuis la réponse Anthropic.
 * Anthropic renvoie : usage.input_tokens, usage.output_tokens,
 * usage.cache_creation_input_tokens, usage.cache_read_input_tokens
 */
function extractUsage(anthropicResponse) {
  const u = anthropicResponse?.usage || {};
  const cachedRead = u.cache_read_input_tokens || 0;
  const cachedCreated = u.cache_creation_input_tokens || 0;
  return {
    inputTokens: (u.input_tokens || 0) + cachedCreated + cachedRead,
    outputTokens: u.output_tokens || 0,
    cachedTokens: cachedRead,          // seuls les reads sont facturés -90%
    cacheCreationTokens: cachedCreated // créations facturées à +25% normal
  };
}

/**
 * Calcule le taux de hit cache pour une sortie API.
 */
function cacheHitRate(usage) {
  if (!usage || !usage.inputTokens) return 0;
  return (usage.cachedTokens || 0) / usage.inputTokens;
}

module.exports = {
  markEphemeral,
  buildCachedMessages,
  extractUsage,
  cacheHitRate,
  MIN_CACHEABLE_TOKENS
};
