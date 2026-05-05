import "server-only";

// ═══════════════════════════════════════════════════════════════════
// Helper Anthropic prompt caching — préambule iFIND stable
// ═══════════════════════════════════════════════════════════════════
// Anthropic Claude Opus exige ≥1024 tokens par bloc cache_control.
// On préfixe chaque system prompt avec ce préambule (~400 tokens) pour
// atteindre le seuil systématiquement et bénéficier du cache (-90%).
// ═══════════════════════════════════════════════════════════════════

const STABLE_PREAMBLE = `# Contexte iFIND Trigger Engine FR

Tu interviens dans le moteur **iFIND Trigger Engine**, système propriétaire de détection de signaux d'achat sur les PME françaises.

## Différence clé vs intent data probabiliste
iFIND n'agrège PAS de signaux flous (visites web, downloads anonymes). iFIND détecte des **TRIGGERS = événements publics durs et datés** :
- Levées de fonds (BODACC, JOAFE, RSS presse spécialisée, Rodz fundraising)
- Recrutement clé (France Travail OAuth + LinkedIn jobs scrapés via TheirStack/Apify)
- Dépôts marques INPI / brevets
- Changements C-level (Pappers dirigeants, Rodz job-changes)
- Campagnes pub Meta Ad Library
- Création société Tech (BODACC immatriculations, Rodz company-registration)

## Moat propriétaire
1. **Attribution SIRENE Pappers** : chaque trigger est rattaché à un SIREN officiel.
2. **13 patterns combinatoires** : un signal isolé vaut peu, un combo (levée + hire + ad) vaut beaucoup.
3. **Boosters réels** : combo cross-sources +2 cap 10 (combo-detector.ts), declarative pain +2 cap 10, freshness via priorityScore demi-vie 14j. isHot = score ≥9 (binaire, pas une fenêtre temporelle).
4. **Filtre ICP strict** : par défaut Tech/SaaS/ESN, taille 11-200p, NAF whitelist (58.29*, 62.0*, 63.*, 70.22Z), régions FR.

## Standard de qualité commercial
- Ton : direct, pro, francophone soutenu mais pas guindé. Pas d'emoji sauf demandé.
- Personnalisation : citer 1-2 éléments concrets du Trigger (montant levée, persona embauché, marque déposée) — JAMAIS de blabla générique.
- Longueur : pitch email 80-120 mots max, LinkedIn DM 50-80 mots, call brief 200-300 mots structuré.
- Pas de promesses de "doubler le CA" ou autres claims agressifs sans data.
- Toujours mentionner le signal d'achat détecté pour justifier la prise de contact.

## Règles non négociables
- LinkedIn actions = MANUEL HUMAIN uniquement (Trigify/Rodz pour détection, jamais auto-engage).
- Réponses TOUJOURS en français sauf indication explicite contraire.
- Si une donnée critique manque (NAF non résolu, persona inconnu), le mentionner explicitement plutôt qu'inventer.
- Format JSON strict si demandé : pas de markdown, pas de texte autour, JSON parsable directement.

---
`;

/**
 * Construit un bloc system cacheable Anthropic avec préambule iFIND + prompt spécifique.
 * Le bloc combiné dépasse 1024 tokens → cache_control: ephemeral activé.
 *
 * Bonus D (05/05/2026) — Support multi-bloc : si `dynamicTail` est fourni,
 * on retourne 2 blocs system :
 *   - bloc 1 : STABLE_PREAMBLE + specificPrompt (cached, change rarement)
 *   - bloc 2 : dynamicTail (NON cached, rotated weekly par cron Bonus D)
 *
 * Bénéfice : les rotations hebdomadaires des few-shots dynamiques
 * n'invalident QUE le bloc 2. Le bloc 1 reste chaud → ~70% des calls hit
 * le cache STABLE_PREAMBLE+QUALIFY_SPECIFIC sans penalty. Économie estimée
 * ~$0.30-0.40/semaine vs single-bloc rotation.
 *
 * Anthropic supporte jusqu'à 4 cache_control breakpoints en system message
 * multi-bloc (validation API officielle 2024+).
 */
export function buildCachedSystem(
  specificPrompt: string,
  dynamicTail?: string,
): Array<{
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}> {
  const stable = STABLE_PREAMBLE + specificPrompt;
  const blocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [
    {
      type: "text" as const,
      text: stable,
      cache_control: { type: "ephemeral" as const },
    },
  ];
  // Si dynamicTail non vide, ajout d'un 2e bloc NON cached.
  // Sécurité : on ne push pas un bloc vide (Anthropic peut rejeter).
  if (dynamicTail && dynamicTail.trim().length > 0) {
    blocks.push({
      type: "text" as const,
      text: dynamicTail,
      // PAS de cache_control → bloc fresh à chaque call (ce qu'on veut
      // pour les few-shots dynamiques rotated hebdo)
    });
  }
  return blocks;
}
