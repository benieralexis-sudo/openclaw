/**
 * Keyword rotation — helper pur testable (12/05/2026)
 * ──────────────────────────────────────────────────────
 *
 * Problème : l'ICP DTL liste 24 keywordsHiring, mais Apify LinkedIn-jobs
 * et WTTJ ne cherchent que les 3 premiers à chaque run (apify-poller.ts:666
 * et 704). Conséquence : 87% des keywords ICP ne sont jamais cherchés
 * (audit 12/05) → on rate "Test Manager", "Performance Engineer", "QA Lead",
 * "SDET", "QA Analyst", etc.
 *
 * Fix : étendre à 8 keywords par run avec rotation cyclique entre runs.
 * 24 keywords / 8 par run = 3 buckets → couverture totale en ~1.5 jour
 * (LinkedIn run 2×/j à 8h05+18h05 UTC) ou ~3 jours (WTTJ run 1×/j à 6h UTC).
 *
 * Implémentation : index basé sur halfDaysSinceEpoch déterministe
 * (= floor(Date.now() / 12h)) modulo nbBuckets. Garantit que :
 *  - Les runs successifs ~12h apart tombent sur des buckets différents
 *  - L'ordre est cyclique et prédictible (debug + tests reproductibles
 *    via injection nowMs)
 *  - Aucune logique liée au timezone serveur (UTC strict)
 *
 * Module 100% PUR, zéro I/O, testable unitairement.
 */

export interface RotationOptions {
  /** Taille du bucket retourné (défaut: 8). Limite : `keywords.length`. */
  batchSize?: number;
  /** Now en ms (défaut: Date.now()). Injectable pour tests. */
  nowMs?: number;
}

/**
 * Retourne le bucket courant de `batchSize` keywords, parmi `keywords`,
 * basé sur l'horloge UTC. Cyclique sur ~12h.
 *
 * - Si `keywords.length <= batchSize` → retourne tout (rien à faire tourner).
 * - Sinon → retourne le bucket d'index `floor(nowMs/12h) % nbBuckets`.
 *
 * Garantie : pour `batchSize=8` et 24 keywords, après 3 runs ~12h apart,
 * tous les 24 keywords ont été couverts.
 */
export function getRotatedKeywords(
  keywords: string[],
  options: RotationOptions = {},
): string[] {
  const batchSize = options.batchSize ?? 8;
  if (keywords.length === 0) return [];
  if (keywords.length <= batchSize) return [...keywords];

  const numBuckets = Math.ceil(keywords.length / batchSize);
  const nowMs = options.nowMs ?? Date.now();
  const halfDaysSinceEpoch = Math.floor(nowMs / (12 * 60 * 60 * 1000));
  const bucketIdx = ((halfDaysSinceEpoch % numBuckets) + numBuckets) % numBuckets;
  const start = bucketIdx * batchSize;
  // slice() est safe au-delà de length → renvoie ce qui reste
  return keywords.slice(start, start + batchSize);
}
