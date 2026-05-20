/**
 * Pilier 2 (20/05/2026) — force du signal d'achat (intentStrength 1-5).
 *
 * Promesse : "On trouve les boîtes FR qui vont **acheter** ton produit".
 * Le "vont acheter" est subjectif sans cette graduation. Aujourd'hui un commit
 * GitHub et un appel d'offres BOAMP sortent tous deux verdict OUI à confidence
 * 80%+ d'Opus. C'est faux : BOAMP = budget engagé, GitHub = signal faible.
 *
 * Calibrage initial basé sur l'analyse prod 30j (20/05/2026) :
 *   - boamp.tender = 100% leads NEW utiles → strength 5
 *   - rss-levees = 64% utiles → strength 5
 *   - apify.linkedin-jobs (général tech) = 79% utiles → strength 3
 *   - apify.linkedin-jobs-signature (ciblé décideur) = → strength 4
 *   - bodacc.capital_increase = 69% utiles → strength 3
 *   - github.commit = 0% utile → strength 1
 *
 * Module pur : pas d'I/O, testable vitest.
 */

export type IntentStrength = 1 | 2 | 3 | 4 | 5;

/**
 * Seuil minimum pour livrer un Lead. Sous 3, on downgrade verdict OUI →
 * ENRICH (signal trop faible, demande enrichissement humain).
 */
export const INTENT_STRENGTH_MIN_THRESHOLD = 3;

/**
 * Calcule la force du signal d'achat basée sur :
 *  - le type de source (sourceCode)
 *  - l'âge du signal (publishedAt)
 *
 * Règle générale : plus le signal est récent ET plus c'est un engagement
 * dur (appel d'offres, levée), plus la strength est haute.
 */
export function computeIntentStrength(
  sourceCode: string,
  publishedAt: Date | null,
): IntentStrength {
  const ageDays = publishedAt
    ? Math.max(0, (Date.now() - publishedAt.getTime()) / 86_400_000)
    : 999;

  // === Niveau 5 (très fort) : engagement budgétaire dur, événement majeur récent ===
  // Appels d'offres publics : la boîte EST en train d'acheter
  if (sourceCode.startsWith("boamp.")) return ageDays <= 30 ? 5 : 4;
  if (sourceCode.startsWith("ted-europa.")) return ageDays <= 30 ? 5 : 4;
  // Levées de fonds confirmées : signal très fort (timing achat post-levée)
  if (sourceCode === "rodz.fundraising") return ageDays <= 30 ? 5 : 4;
  if (sourceCode.startsWith("rss-levees")) return ageDays <= 30 ? 5 : 4;

  // === Niveau 4 (fort) : recrutements ciblés décideurs signature/projet ===
  if (sourceCode === "apify.linkedin-jobs-signature") return ageDays <= 60 ? 4 : 3;
  if (sourceCode === "francetravail.signature") return ageDays <= 60 ? 4 : 3;
  if (sourceCode === "apify.linkedin-signature") return ageDays <= 60 ? 4 : 3;
  // Trigger engine tech-hiring : recrutement profile-search ciblé
  if (sourceCode === "trigger-engine.tech-hiring") return ageDays <= 60 ? 4 : 3;
  if (sourceCode === "trigger-engine.funding-recent") return ageDays <= 60 ? 4 : 3;

  // === Niveau 3 (moyen) : recrutements tech larges, augmentation capital ===
  if (sourceCode === "apify.linkedin-jobs") return ageDays <= 60 ? 3 : 2;
  if (sourceCode === "apify.wttj-jobs") return ageDays <= 60 ? 3 : 2;
  if (sourceCode === "rodz.job-offers") return ageDays <= 60 ? 3 : 2;
  if (sourceCode === "rodz.recruitment-campaign") return ageDays <= 60 ? 3 : 2;
  if (sourceCode === "bodacc.capital_increase") return ageDays <= 60 ? 3 : 2;
  if (sourceCode.startsWith("theirstack.")) return ageDays <= 60 ? 3 : 2;

  // === Niveau 2 (faible) : mentions presse, signaux indirects ===
  if (sourceCode.startsWith("rss-medias")) return ageDays <= 30 ? 2 : 1;
  if (sourceCode.startsWith("francetravail.")) return ageDays <= 60 ? 2 : 1;
  if (sourceCode.startsWith("bodacc.")) return ageDays <= 60 ? 2 : 1;

  // === Niveau 1 (très faible) : signaux techniques indirects ===
  if (sourceCode.startsWith("github.")) return 1;
  if (sourceCode.startsWith("inpi.")) return 1;
  if (sourceCode.startsWith("joafe.")) return 1;

  // === Fallback : signal inconnu = 2 (prudent : pas livré sans confirmation)
  return 2;
}

/**
 * Décide si on peut livrer ce Trigger en l'état (verdict OUI d'Opus) ou
 * si on doit downgrade en ENRICH faute de signal assez fort.
 *
 * Politique stricte 20/05 : on ne livre que les signaux >= 3.
 */
export function shouldDeliverByIntentStrength(strength: IntentStrength): boolean {
  return strength >= INTENT_STRENGTH_MIN_THRESHOLD;
}

/**
 * Boost multi-source : si la même boîte a N Triggers de strength≥3 dans
 * les 30 derniers jours, on bump le strength du Trigger principal.
 *
 * Règle : +1 par signal additionnel, capped à 5.
 *   - 1 signal seul   → strength inchangée
 *   - 2 signaux (combo) → +1
 *   - 3+ signaux (cluster) → +2
 */
export function boostStrengthByMultiSource(
  baseStrength: IntentStrength,
  additionalSignalsCount: number,
): IntentStrength {
  if (additionalSignalsCount <= 0) return baseStrength;
  const boost = additionalSignalsCount === 1 ? 1 : 2;
  const boosted = Math.min(5, baseStrength + boost);
  return boosted as IntentStrength;
}

/**
 * Label humain pour le dashboard / brief commercial.
 */
export function describeIntentStrength(strength: IntentStrength): string {
  switch (strength) {
    case 5:
      return "Signal très fort — engagement budgétaire récent";
    case 4:
      return "Signal fort — recrutement décideur ou levée";
    case 3:
      return "Signal moyen — recrutement tech ou augmentation capital";
    case 2:
      return "Signal faible — mention presse ou indirect";
    case 1:
      return "Signal très faible — événement technique sans engagement";
  }
}
