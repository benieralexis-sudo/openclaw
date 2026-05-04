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

// ──────────────────────────────────────────────────────────────────────
// Score Unifié (refonte UI 04/05/2026, validée mockup)
// ─────────────────────────────────────────────────────────────────────
// L'utilisateur trouvait peu lisibles les 2 chiffres bruts (Priorité 1-37
// et Fit 30-100, échelles différentes affichées identiquement). Refonte
// vers 1 score combiné 0-100 + label texte + couleur tier.
//
// Formule (calibrée sur top 10 leads DTL réels 03/05) :
//   score = (priorityScore × 100/35) × 0.6 + fitScore × 0.4
//
// Le facteur 100/35 normalise priorityScore (max observé ~37 actuellement)
// vers une échelle 0-100, puis on pondère 60/40 priorité/fit (la priorité
// = signal fraîcheur+multi-source = plus actionnable que le fit qui mesure
// le potentiel statique du décideur).
// ──────────────────────────────────────────────────────────────────────

export type CombinedTier = "fire" | "hot" | "warm" | "tepid" | "cold";

export interface CombinedScoreInputs {
  priorityScore: number | null | undefined;
  fitScore: number | null | undefined;
}

/**
 * Combine priority+fit en score 0-100. Retourne null si les deux sont absents.
 * Si l'un des deux manque, on prend l'autre seul (sans pondération croisée).
 */
export function getCombinedScore(inputs: CombinedScoreInputs): number | null {
  const p = inputs.priorityScore;
  const f = inputs.fitScore;
  if ((p === null || p === undefined) && (f === null || f === undefined)) return null;
  // Normalise priority : max observé ~37, on prend 35 comme "top atteignable"
  // → priority 35+ saturera à 100. Cohérent avec mockup validé.
  const pNorm = p !== null && p !== undefined ? Math.min(100, (p * 100) / 35) : null;
  if (pNorm === null) return Math.round(f as number);
  if (f === null || f === undefined) return Math.round(pNorm);
  return Math.round(pNorm * 0.6 + f * 0.4);
}

/**
 * score 0-100 → tier (5 niveaux). Seuils alignés avec mockup validé 04/05.
 *  - 75-100 : fire   — appeler maintenant
 *  - 65-74  : hot    — email perso + suivi semaine
 *  - 55-64  : warm   — séquence cold standard
 *  - 35-54  : tepid  — surveiller (déclenche si nouveau signal)
 *  - 0-34   : cold   — hors-priorité
 */
export function getCombinedTier(score: number | null | undefined): CombinedTier | null {
  if (score === null || score === undefined) return null;
  if (score >= 75) return "fire";
  if (score >= 65) return "hot";
  if (score >= 55) return "warm";
  if (score >= 35) return "tepid";
  return "cold";
}

/**
 * Tier → label français court. Affiché à côté du chiffre dans la table.
 */
export function getCombinedLabel(tier: CombinedTier | null): string {
  switch (tier) {
    case "fire": return "Brûlant";
    case "hot": return "Très chaud";
    case "warm": return "Chaud";
    case "tepid": return "Tiède";
    case "cold": return "Faible";
    default: return "—";
  }
}

/**
 * Tier → classes Tailwind pour la barre + texte.
 * Couleurs alignées avec mockup : rouge / orange / ambre / bleu / gris.
 */
export function getCombinedColors(tier: CombinedTier | null): {
  bar: string;
  text: string;
} {
  switch (tier) {
    case "fire":  return { bar: "bg-red-600",     text: "text-red-700" };
    case "hot":   return { bar: "bg-orange-600",  text: "text-orange-700" };
    case "warm":  return { bar: "bg-amber-600",   text: "text-amber-700" };
    case "tepid": return { bar: "bg-sky-600",     text: "text-sky-700" };
    case "cold":  return { bar: "bg-ink-400",     text: "text-ink-500" };
    default:      return { bar: "bg-ink-200",     text: "text-ink-400" };
  }
}
