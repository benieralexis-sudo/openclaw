/**
 * Persona Fit Scoring — chantier #2b (01/05/2026)
 * ────────────────────────────────────────────────
 * Score composite 0-100 indiquant la pertinence d'un lead pour l'ICP du
 * client. Consomme les données enrichies par chantier #2a (profil LinkedIn
 * complet) + le personaTier existant.
 *
 * Formule :
 *   fitScore = base(personaTier) + tenureBoost + backgroundFit + sizeFit
 *
 *   base : Tier 1 = 60, Tier 2 = 50, Tier 3 = 35, null = 30
 *   tenureBoost : sweet spot 6-36m = +15, <6m = +5, 36-60m = +10, >60m = +5
 *   backgroundFit : selon ICP du client (ESN/SaaS/Startup), cap 25
 *   sizeFit : entreprise dans la tranche ICP = +15
 *
 *   Total cappé à 100.
 *
 * Module 100% PUR : zéro dépendance DB/IO. Testable unitairement.
 */

export interface BackgroundFlags {
  hasESNBackground: boolean;
  hasSaaSBackground: boolean;
  hasStartupBackground: boolean;
}

export interface ICPProfile {
  wantsESN?: boolean;
  wantsSaaS?: boolean;
  wantsStartup?: boolean;
  sizeMin?: number;
  sizeMax?: number;
}

export interface FitInputs {
  personaTier: number | null | undefined;
  currentTenureMonths: number | null;
  backgrounds: BackgroundFlags | null;
  companyEtabsCount: number | null;
  icp: ICPProfile;
}

export interface FitBreakdown {
  base: number;
  tenureBoost: number;
  backgroundFit: number;
  sizeFit: number;
}

export interface FitResult {
  score: number;
  breakdown: FitBreakdown;
}

// ──────────────────────────────────────────────────────────────────────
// Sub-scorer 1 : base par personaTier
// ──────────────────────────────────────────────────────────────────────

export function computeBaseScore(tier: number | null | undefined): number {
  if (tier === 1) return 60;
  if (tier === 2) return 50;
  if (tier === 3) return 35;
  return 30; // null, undefined, ou tier inconnu (4, 0, etc.)
}

// ──────────────────────────────────────────────────────────────────────
// Sub-scorer 2 : tenure boost (sweet spot 6-36 mois)
// ──────────────────────────────────────────────────────────────────────

export function computeTenureBoost(months: number | null): number {
  if (months === null || months === undefined) return 0;
  if (months < 6) return 5;          // en construction
  if (months <= 36) return 15;       // sweet spot : installé mais ouvert
  if (months <= 60) return 10;       // installé
  return 5;                           // > 60 mois : ancré
}

// ──────────────────────────────────────────────────────────────────────
// Sub-scorer 3 : background fit (selon ICP du client)
// ──────────────────────────────────────────────────────────────────────

export function computeBackgroundFit(
  backgrounds: BackgroundFlags | null,
  icp: ICPProfile,
): number {
  if (!backgrounds) return 0;
  let score = 0;
  if (icp.wantsESN && backgrounds.hasESNBackground) score += 20;
  if (icp.wantsSaaS && backgrounds.hasSaaSBackground) score += 15;
  if (icp.wantsStartup && backgrounds.hasStartupBackground) score += 10;
  return Math.min(score, 25); // cap à 25 (sinon over-représenté vs base)
}

// ──────────────────────────────────────────────────────────────────────
// Sub-scorer 4 : size fit (companyEtabsCount dans tranche ICP)
// ──────────────────────────────────────────────────────────────────────

export function computeSizeFit(
  etabsCount: number | null,
  icp: ICPProfile,
): number {
  if (etabsCount === null || etabsCount === undefined) return 0;
  if (icp.sizeMin === undefined || icp.sizeMax === undefined) return 0;
  if (etabsCount >= icp.sizeMin && etabsCount <= icp.sizeMax) return 15;
  return 0;
}

// ──────────────────────────────────────────────────────────────────────
// Score composite final (cappé 0-100)
// ──────────────────────────────────────────────────────────────────────

export function computeFitScore(inputs: FitInputs): FitResult {
  const base = computeBaseScore(inputs.personaTier);
  const tenureBoost = computeTenureBoost(inputs.currentTenureMonths);
  const backgroundFit = computeBackgroundFit(inputs.backgrounds, inputs.icp);
  const sizeFit = computeSizeFit(inputs.companyEtabsCount, inputs.icp);

  const raw = base + tenureBoost + backgroundFit + sizeFit;
  const capped = Math.min(100, Math.max(0, raw));

  return {
    score: capped,
    breakdown: { base, tenureBoost, backgroundFit, sizeFit },
  };
}
