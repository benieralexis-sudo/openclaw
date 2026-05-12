/**
 * Freshness min gate — helper pur testable (12/05/2026)
 * ──────────────────────────────────────────────────────
 *
 * Détermine le minDays applicable à un trigger en fonction de son type
 * + titre (pour distinguer HIRING_KEY QA vs HIRING_KEY autre) et de l'ICP
 * du client (icp.freshnessByTrigger).
 *
 * Utilisé par qualify-trigger.ts (étape 3-bis) pour downgrade verdict OUI
 * → ENRICH si le signal est "trop frais" selon la fenêtre ICP du client.
 * Cas typique DTL : levée < 15j post-annonce = Fred ne veut PAS approcher
 * (sollicitations en masse pré-J15).
 *
 * Mapping :
 *   FUNDRAISING                              → icp.freshnessByTrigger.levee.minDays
 *   CAPITAL_INCREASE (BODACC proxy levée)    → icp.freshnessByTrigger.levee.minDays
 *   HIRING_KEY + titre QA/test/quality/SDET  → icp.freshnessByTrigger.hireQA.minDays
 *   LEADERSHIP_CHANGE                        → icp.freshnessByTrigger.changementCLevel.minDays
 *   autre                                    → null (pas de gate applicable)
 *
 * Retourne null si pas de gate applicable (ICP absent, type non mappé,
 * ou clé minDays absente). Module 100% PUR, zéro I/O, testable unitairement.
 */

export type IcpFreshnessByTrigger = Record<
  string,
  { minDays?: number; maxDays?: number; staleAfterDays?: number }
>;

export function getMinFreshnessDays(
  triggerType: string | null | undefined,
  title: string | null | undefined,
  icpFreshness: IcpFreshnessByTrigger | null | undefined,
): number | null {
  if (!triggerType || !icpFreshness) return null;
  const t = triggerType;
  if (t === "FUNDRAISING" || t === "CAPITAL_INCREASE") {
    return icpFreshness.levee?.minDays ?? null;
  }
  if (t === "LEADERSHIP_CHANGE") {
    return icpFreshness.changementCLevel?.minDays ?? null;
  }
  if (t === "HIRING_KEY") {
    // Distingue hire QA (clé hireQA) du hire générique (pas de gate ICP DTL).
    const titleLower = (title ?? "").toLowerCase();
    const isQaHire = /\b(qa|test|quality|sdet|qualiticien|automaticien)\b/i.test(
      titleLower,
    );
    if (isQaHire) return icpFreshness.hireQA?.minDays ?? null;
  }
  return null;
}
