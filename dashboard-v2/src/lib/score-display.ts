/**
 * Helpers d'affichage des scores intelligents (chantier D1, 01/05/2026)
 * ─────────────────────────────────────────────────────────────────────
 * Variants de Badge + formatters de breakdown pour l'UI /triggers et fiche lead.
 * Module 100% PUR : zéro dépendance React/UI. Testable unitairement.
 */

export type BadgeVariant =
  | "default"
  | "info"
  | "brand"
  | "warning"
  | "success"
  | "danger"
  | "fire";

/**
 * priorityScore (0-130) → variant Badge.
 * Seuils alignés avec la formule v3.9 : score×freshness/100 + multiSourceBoost.
 *  - <7 : signal froid ou marginal → gris discret
 *  - 7-14 : présence dans le radar mais peu actionnable → info
 *  - 15-29 : multi-source ou récent → brand (priorité visible)
 *  - ≥30 : Pépite récente multi-source → fire (à appeler MAINTENANT)
 */
export function getPriorityVariant(score: number | null | undefined): BadgeVariant {
  if (score === null || score === undefined) return "default";
  if (score >= 30) return "fire";
  if (score >= 15) return "brand";
  if (score >= 7) return "info";
  return "default";
}

/**
 * fitScore (0-100) → variant Badge / barre.
 * Seuils alignés avec la formule v4.2 (chantier #2b) :
 *  - <50 : fit faible (pas de tier ni de profil enrichi)
 *  - 50-69 : passable (Tier sans bonus)
 *  - 70-84 : bon fit (Tier 1-2 + tenure ou bg)
 *  - ≥85 : top fit (CTO/Founder + tenure parfaite + bg ICP + size match)
 */
export function getFitVariant(score: number | null | undefined): BadgeVariant {
  if (score === null || score === undefined) return "default";
  if (score >= 85) return "success";
  if (score >= 70) return "info";
  if (score >= 50) return "warning";
  return "default";
}

// ──────────────────────────────────────────────────────────────────────
// Formatters breakdown — chaîne lisible pour tooltip / sous-ligne
// ──────────────────────────────────────────────────────────────────────

export interface PriorityInputs {
  score: number;
  freshnessScore: number | null;
  multiSourceBoost: number | null;
}

/**
 * "score 10 · 84% · +30" — chips compactes pour sous-ligne table.
 * Retourne null si freshnessScore manquant (priorityScore pas encore calculé).
 */
export function formatPriorityBreakdown(inputs: PriorityInputs): string | null {
  if (inputs.freshnessScore === null || inputs.freshnessScore === undefined) {
    return null;
  }
  const parts: string[] = [`score ${inputs.score}`, `${inputs.freshnessScore}%`];
  if (inputs.multiSourceBoost && inputs.multiSourceBoost > 0) {
    parts.push(`multi +${inputs.multiSourceBoost}`);
  }
  return parts.join(" · ");
}

export interface FitBreakdown {
  base: number;
  tenureBoost: number;
  backgroundFit: number;
  sizeFit: number;
}

/**
 * "base 60 · tenure +15 · background +25 · size +15" — pour tooltip.
 * Omet les composantes à 0 pour rester lisible.
 */
export function formatFitBreakdown(
  breakdown: FitBreakdown | null | undefined,
): string | null {
  if (!breakdown) return null;
  const parts: string[] = [`base ${breakdown.base}`];
  if (breakdown.tenureBoost > 0) parts.push(`tenure +${breakdown.tenureBoost}`);
  if (breakdown.backgroundFit > 0) parts.push(`background +${breakdown.backgroundFit}`);
  if (breakdown.sizeFit > 0) parts.push(`size +${breakdown.sizeFit}`);
  return parts.join(" · ");
}
