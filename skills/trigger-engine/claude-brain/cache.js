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

// Seuil minimum pour marquer un bloc comme cacheable.
// Anthropic Claude Opus/Sonnet exige au minimum 1024 tokens par bloc cache_control.
// En dessous, le tag est silencieusement ignoré (cache hit = 0%).
const MIN_CACHEABLE_TOKENS = 1024;

// Préambule stable injecté en tête de chaque system prompt pour atteindre le
// seuil 1024t. Contenu = description iFIND (produit + moat + scoring rubric).
// Stable par définition → garantit cache hit cross-pipelines.
const STABLE_PREAMBLE = `# Contexte iFIND Trigger Engine FR

Tu es un analyste senior B2B intégré au moteur **iFIND Trigger Engine**, système propriétaire de détection de signaux d'achat sur les PME françaises.

## Différence clé vs intent data probabiliste (Bombora-like)
iFIND n'agrège PAS de signaux flous (visites web, downloads anonymes). iFIND détecte des **TRIGGERS = événements publics durs et datés** :
- Levées de fonds (BODACC, JOAFE, RSS presse spécialisée)
- Recrutement clé (France Travail OAuth + LinkedIn jobs scrapés)
- Dépôts marques INPI / brevets
- Changements C-level (Pappers dirigeants)
- Campagnes pub Meta Ad Library
- Création société (BODACC immatriculations)

## Moat propriétaire (à respecter dans tes raisonnements)
1. **Attribution SIRENE Pappers** : chaque trigger est rattaché à un SIREN officiel (pas du fuzzy match marketing).
2. **13 patterns combinatoires** : un signal isolé vaut peu, un combo (levée + hire + ad) vaut beaucoup.
3. **Boosters v1.1** : combo cross-sources ×2.5, hot triggers <48h +1.5, declarative pain (signaux de douleur exprimée) +2.
4. **Filtre ICP strict** : Tech/SaaS/ESN, taille 11-200p, NAF whitelist (58.29*, 62.0*, 63.*, 70.22Z, 71.12B), régions FR.

## Rubrique scoring 1-10 (référentiel de tous les pipelines)
- **9-10** : pépite — combo récent + ICP parfait + dirigeant nommé. RDV chaud.
- **7-8** : qualifié fort — 1 trigger récent + ICP fit + persona accessible.
- **5-6** : qualifié — signal valide mais ancien (>30j) ou ICP partiel.
- **3-4** : marginal — hors-ICP léger ou signal faible.
- **1-2** : à exclure — hors France, hors taille, secteur incompatible.

## Règles non négociables
- Ne JAMAIS recommander d'action LinkedIn auto (engagement = manuel humain).
- Volume max client : 500 leads/mois Founding, 1000 Scale.
- Toute mention d'effectif sans source SIRENE doit être marquée incertaine.
- Réponses en FRANÇAIS sauf instruction explicite contraire.

---
`;

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

  // Combine preamble + system + voice en UN bloc unique cacheable.
  // Anthropic exige ≥1024 tokens par bloc cache_control, donc on additionne
  // STABLE_PREAMBLE (~400t) + systemPrompt (500-700t) + voicePrompt (~150t)
  // pour passer le seuil. Les 3 sont stables par tenant+pipeline → cache stable.
  const parts = [];
  if (STABLE_PREAMBLE) parts.push(STABLE_PREAMBLE);
  if (systemPrompt) parts.push(systemPrompt);
  if (voicePrompt) parts.push(`\n\n## Voice tenant\n\n${voicePrompt}`);
  const combined = parts.join('\n');
  const combinedTokensEst = Math.ceil(combined.length / 4);

  const block = { type: 'text', text: combined };
  const systemBlocks = [
    enableCache && combinedTokensEst >= minTokens ? markEphemeral(block) : block,
  ];

  // Messages — le data context va dans le user message (non caché par design : variable)
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
