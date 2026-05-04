/**
 * Compute personaTier from jobTitle Pappers (Phase 1, 04/05/2026)
 * ───────────────────────────────────────────────────────────────
 * Bug recovery 7 Pépites cachées : Pappers RCS écrit qualité claire
 * (ex: "Président / Fondateur", "CEO", "Gérant", "Co-Founder") dans
 * Lead.jobTitle, mais aucun module ne calcule personaTier depuis ça
 * quand HarvestAPI search-by-company n'a pas tourné et que linkedinProfileJson
 * n'existe pas.
 *
 * Ce module COMPLÈTE compute-tier-from-headline.ts (Sprint 1) :
 *  - headline LinkedIn présent → utilise compute-tier-from-headline
 *  - sinon, jobTitle présent → utilise CE module (fallback Pappers)
 *
 * Logique séquentielle (premier match wins) :
 *   1. CTO / Chief Tech / Head of Eng / Tech Lead / VP Eng → Tier 1
 *   2. Founder / Cofondateur / Fondateur / Co-Founder → Tier 2
 *   3. CEO / Directeur Général / Président / Gérant → Tier 2 (généreux exec)
 *   4. Sinon → null (ne touche pas)
 *
 * Différence vs headline :
 *  - Pappers `qualité` est un texte court (RCS) → pas de bruit "Forbes Top 20"
 *  - Patterns plus simples (pas besoin de regex complexe)
 *  - Tolère les variations FR : "Président", "PRÉSIDENT", "président du directoire"
 *
 * Module 100% PUR. Testable unitairement.
 */

export type JobTitleTierCategory =
  | "cto-or-tech-lead"   // Tier 1
  | "founder"             // Tier 2
  | "exec-other"          // Tier 2
  | null;

export interface JobTitleTierResult {
  tier: 1 | 2 | 3 | null;
  category: JobTitleTierCategory;
  matchedText: string | null;
}

// Tier 1 : décideur tech opérationnel
const TIER_1_RX =
  /\b(cto|chief\s+tech(?:nology)?\s+officer|directeur\s+technique|responsable\s+technique|head\s+of\s+(?:engineering|tech|qa|quality|product|development|dev|platform|architecture)|vp\s+(?:of\s+)?(?:engineering|tech|product|technology)|engineering\s+director|director\s+of\s+engineering|tech\s+lead|engineering\s+manager|chief\s+architect)\b/i;

// Tier 2 : Founder priorité
const FOUNDER_RX =
  /\b(co.?founder|cofondateur|fondateur|founder)\b/i;

// Tier 2 : Exec other (CEO/DG/Président/Gérant)
// Plus permissif que headline car jobTitle Pappers est court/structuré
const EXEC_OTHER_RX =
  /\b(ceo|chief\s+executive\s+officer|directeur\s+g[ée]n[ée]ral(?:\s+adjoint)?|d\.?g\.?(?:\s+adjoint)?\b|pr[ée]sident(?:e)?(?:\s+du\s+directoire)?|g[ée]rant(?:e)?|managing\s+director|general\s+manager|coo|chief\s+operating\s+officer|directeur\s+op[ée]rationnel)\b/i;

export function computeTierFromJobTitle(
  jobTitle: string | null | undefined,
): JobTitleTierResult {
  if (!jobTitle || typeof jobTitle !== "string") {
    return { tier: null, category: null, matchedText: null };
  }
  const text = jobTitle.trim();
  if (text.length === 0 || text === "?") {
    return { tier: null, category: null, matchedText: null };
  }

  // Priorité 1 : CTO/Tech Lead
  const tier1Match = text.match(TIER_1_RX);
  if (tier1Match) {
    return {
      tier: 1,
      category: "cto-or-tech-lead",
      matchedText: tier1Match[0],
    };
  }

  // Priorité 2 : Founder (avant CEO car "CEO & Co-founder" doit matcher Founder)
  const founderMatch = text.match(FOUNDER_RX);
  if (founderMatch) {
    return {
      tier: 2,
      category: "founder",
      matchedText: founderMatch[0],
    };
  }

  // Priorité 3 : exec other
  const execMatch = text.match(EXEC_OTHER_RX);
  if (execMatch) {
    return {
      tier: 2,
      category: "exec-other",
      matchedText: execMatch[0],
    };
  }

  return { tier: null, category: null, matchedText: null };
}
