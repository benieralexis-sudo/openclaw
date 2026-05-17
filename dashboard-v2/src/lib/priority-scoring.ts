/**
 * Priority Scoring Engine — chantier #1 (01/05/2026)
 * ──────────────────────────────────────────────────
 * Pose 3 scores composites sur chaque Trigger pour réordonner le backlog
 * commercial.
 *
 * 1. freshnessScore (0-100) — décroissance exponentielle avec l'âge.
 *    Demi-vie 14 jours (cycle de réactivité B2B FR, Belkins benchmark).
 * 2. multiSourceBoost (0-30) — bonus si la même société est captée par
 *    plusieurs sources distinctes dans une fenêtre 7j (vrai signal :
 *    2 capteurs indépendants confirment le même intent).
 * 3. priorityScore = score × (freshnessScore/100) + multiSourceBoost.
 *
 * Investigation préalable (DTL 90j) : 94% des sociétés ont 1 trigger,
 * 93% mono-type → la spec initiale "combo velocity multi-fenêtre" était
 * inadaptée. Pivot motivé documenté dans
 * `methode-construction-trigger-engine.md` + `chantier1-priority-scoring-spec.md`.
 *
 * Module 100% PUR : zéro dépendance DB/IO. Testable unitairement.
 */

/**
 * Demi-vie en jours pour la décroissance exponentielle de freshness.
 * Choisi à 14 jours pour matcher le cycle commercial B2B FR : un signal
 * d'achat perd ~50% de sa pertinence en 10 jours, devient quasi-mort à
 * 60 jours. Exposé pour tooling/documentation.
 */
export const FRESHNESS_HALF_LIFE_DAYS = 14;

/** Plafond : on coupe à 0 au-delà de 90j (signal mort, n'apparait plus en priorité). */
export const FRESHNESS_DEAD_AGE_DAYS = 90;

/**
 * Score de fraîcheur d'un trigger basé sur son âge en jours.
 * Décroissance exponentielle : `100 * exp(-ageDays / 14)`.
 *
 * @param capturedAt — Date de capture du trigger
 * @param now — Date de référence (défaut : now). Utile pour les tests.
 * @returns score entier 0-100
 */
export function computeFreshnessScore(
  capturedAt: Date,
  now: Date = new Date(),
): number {
  const ageMs = now.getTime() - capturedAt.getTime();
  // Trigger dans le futur (clock skew) : on traite comme "très frais"
  if (ageMs <= 0) return 100;
  const ageDays = ageMs / 86400_000;
  if (ageDays >= FRESHNESS_DEAD_AGE_DAYS) return 0;
  const raw = 100 * Math.exp(-ageDays / FRESHNESS_HALF_LIFE_DAYS);
  return Math.round(raw);
}

/**
 * Bonus de score quand plusieurs sources distinctes captent la même société.
 * - 0 ou 1 source distincte → 0
 * - 2 sources distinctes → +15
 * - 3+ sources distinctes → +30 (cap)
 *
 * Dédup case-insensitive sur sourceCode.
 *
 * @param sourceCodes — liste des sourceCode des triggers de la société (fenêtre 7j typiquement)
 */
export function computeMultiSourceBoost(sourceCodes: string[]): number {
  const distinct = new Set(sourceCodes.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (distinct.size <= 1) return 0;
  if (distinct.size === 2) return 15;
  return 30;
}

/**
 * Score de priorité composite — c'est CE chiffre qui sert à trier le backlog
 * commercial.
 *
 * Formule : `score × (freshnessScore / 100) + multiSourceBoost`
 *
 * Range typique :
 *  - Trigger score 10, J-1, 1 source → ~9
 *  - Trigger score 10, J-30, 1 source → ~1 (déprioritisé)
 *  - Trigger score 8, J-1, 2 sources → ~22 (priorité haute)
 *  - Trigger score 6, J-0, 3+ sources → ~36 (top priorité)
 *
 * Range max théorique : score 10 × freshness 100 + boost 30 = 130.
 */
export function computePriorityScore(args: {
  score: number;
  freshnessScore: number;
  multiSourceBoost: number;
  /** B1 (17/05/2026) — bonus si le signal source est un pilier du client.
   * Les piliers sont les 3 signaux jugés prioritaires lors de l'onboarding ;
   * un trigger issu d'un signal pilier mérite +5 points pour passer devant
   * un trigger booster équivalent. */
  pillarBoost?: number;
}): number {
  const { score, freshnessScore, multiSourceBoost, pillarBoost = 0 } = args;
  const decayed = score * (freshnessScore / 100);
  return Math.round(decayed + multiSourceBoost + pillarBoost);
}

/**
 * B1 (17/05/2026) — Détermine le bonus pilier d'un trigger en fonction de son
 * sourceCode et des piliers actifs du client.
 *
 * Mapping sourceCode → signal catalogue (extrait SignalCatalog.sourceCodes) :
 *   - apify.linkedin-jobs / apify.wttj-jobs / francetravail.tech → P1
 *   - harvestapi.team-gap → P2
 *   - theirstack.buying-intent → P3
 *   - apify.ai-adoption → P4
 *   - pappers.headcount-growth → P5
 *
 * Retourne 5 si le trigger provient d'un pilier actif, 0 sinon.
 */
const SOURCE_TO_SIGNAL: Record<string, string> = {
  "apify.linkedin-jobs": "P1",
  "apify.wttj-jobs": "P1",
  "apify.indeed-jobs": "P1",
  "apify.france-jobs": "P1",
  "francetravail.tech": "P1",
  "harvestapi.team-gap": "P2",
  "theirstack.buying-intent": "P3",
  "apify.ai-adoption": "P4",
  "pappers.headcount-growth": "P5",
};

export function computePillarBoost(
  sourceCode: string | null | undefined,
  activePillars: string[],
): number {
  if (!sourceCode) return 0;
  const signalCode = SOURCE_TO_SIGNAL[sourceCode];
  if (!signalCode) return 0;
  return activePillars.includes(signalCode) ? 5 : 0;
}
