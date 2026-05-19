/**
 * Mapping sourceCode (technique) → signalCode (catalogue).
 *
 * Stratégie V1 (17/05/2026) — Permet de classer chaque Trigger sous l'un des
 * 11 signaux du catalogue, peu importe la source technique qui l'a détecté.
 * Plusieurs sources peuvent mapper au même signal (multi-source par signal).
 *
 * Module 100% PUR : zéro dépendance DB/IO. Testable unitairement.
 */

// 11 signaux actifs du catalogue (codes internes conservés depuis la V0).
// B6 (Augmentation capital) fusionné dans B1 (Levée) — toutes les sources
// BODACC capital_increase mappent maintenant à B1.
const SOURCE_TO_SIGNAL: Record<string, string> = {
  // Signal 1 — Recrutement rôle clé (P1)
  "apify.linkedin-jobs": "P1",
  "apify.wttj-jobs": "P1",
  "apify.indeed-jobs": "P1",
  "apify.france-jobs": "P1",
  "francetravail.tech": "P1",
  "rodz.job-offers": "P1",
  "rodz.recruitment-campaign": "P1",
  "trigger-engine.tech-hiring": "P1",

  // Signal 2 — Équipe sans rôle X (P2)
  "harvestapi.team-gap": "P2",

  // Signal 3 — Intent d'achat (P3)
  "theirstack.buying-intent": "P3",
  "theirstack.job-offer": "P3", // legacy job-offer désactivé mais legacy data
  "boamp.tender": "P3",
  "github.commit": "P3",
  "apify.linkedin-jobs-signature": "P3", // Jour 9 Bombora FR — desc match signature keywords

  // Signal 4 — Adoption d'outil IA (P4)
  "apify.ai-adoption": "P4",

  // Signal 5 — Croissance effectif (P5)
  "pappers.headcount-growth": "P5",

  // Signal 6 — Levée de fonds (B1, fusion B6 Capital)
  "rodz.fundraising": "B1",
  "rss-levees": "B1",
  "bodacc.capital_increase": "B1",
  "trigger-engine.funding-recent": "B1",

  // Signal 7 — Nouveau C-Level (B2)
  "pappers.leadership-change": "B2",
  "rodz.job-changes": "B2",

  // Signal 8 — Fusion / Acquisition (B3)
  "bodacc.company_merger": "B3",
  "rodz.mergers-acquisitions": "B3",

  // Signal 9 — Création récente (B4)
  "rodz.company-registration": "B4",
  "bodacc.immatriculation": "B4",

  // Signal 10 — Dépôt INPI marque (B5)
  "inpi.marque": "B5",

  // Signal 11 — Expansion géographique (B7)
  "bodacc.expansion": "B7",
  "rodz.expansion": "B7",
};

/**
 * Retourne le code signal (P1-P5, B1-B7) correspondant à un sourceCode,
 * ou null si le sourceCode n'est pas reconnu (signal hors catalogue ou legacy).
 */
export function getSignalCodeFromSourceCode(sourceCode: string | null | undefined): string | null {
  if (!sourceCode) return null;
  return SOURCE_TO_SIGNAL[sourceCode] ?? null;
}

/**
 * Liste tous les sourceCodes qui mappent à un signal donné.
 * Utilisé pour le multi-source confidence boost : compter combien de sources
 * distinctes du même signal ont détecté la même boîte.
 */
export function getSourceCodesForSignal(signalCode: string): string[] {
  return Object.entries(SOURCE_TO_SIGNAL)
    .filter(([, signal]) => signal === signalCode)
    .map(([source]) => source);
}

/**
 * Liste des 11 codes signaux actifs du catalogue (ordre stable pour UI).
 */
export const CATALOG_SIGNAL_CODES = [
  "P1", "P2", "P3", "P4", "P5", // ex-piliers
  "B1", "B2", "B3", "B4", "B5", "B7", // ex-boosters (B6 fusionné dans B1)
] as const;

export type SignalCode = typeof CATALOG_SIGNAL_CODES[number];

/**
 * Noms français des signaux pour affichage UI (synchro avec DB).
 */
export const SIGNAL_NAMES: Record<string, string> = {
  P1: "Recrutement rôle clé",
  P2: "Équipe sans rôle X",
  P3: "Intent d'achat",
  P4: "Adoption d'outil IA",
  P5: "Croissance effectif",
  B1: "Levée de fonds",
  B2: "Nouveau C-Level",
  B3: "Fusion / Acquisition",
  B4: "Création récente",
  B5: "Dépôt INPI marque",
  B7: "Expansion géographique",
};
