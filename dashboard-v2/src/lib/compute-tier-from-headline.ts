/**
 * Compute personaTier from LinkedIn headline (Sprint 1, 04/05/2026)
 * ─────────────────────────────────────────────────────────────────
 * Bug Paul Vidal résolu : Pappers RCS écrit `qualite = "Angel Investor"`
 * pour des CTO Co-founders qui ont déclaré leur statut LRC d'investisseur.
 * Conséquence : personaTier reste null/Tier 3 alors que le headline LinkedIn
 * dit clairement "Co-founder & CTO @Collective".
 *
 * Cette fonction extrait le tier depuis le headline LinkedIn quand Pappers/
 * HarvestAPI ont raté la donnée. Universel (pas DTL-specific) — marche pour
 * tous les futurs clients B2B.
 *
 * Logique séquentielle (premier match wins, priorité Tier 1 > Tier 2) :
 *   1. CTO / Chief Tech / Head of (Eng|QA|Tech|Product|Dev) / Tech Lead
 *      / VP Engineering / Directeur Technique → Tier 1
 *   2. Founder / Co-founder / Cofondateur / Fondateur → Tier 2
 *   3. CEO / Chief Executive / Directeur Général / Président / Gérant
 *      / Managing Director / General Manager → Tier 2 (généreux exec)
 *   4. Sinon → null (ne touche pas)
 *
 * Module 100% PUR : zéro dépendance DB/IO. Testable unitairement.
 */

export type HeadlineTierCategory =
  | "cto-or-tech-lead"   // Tier 1
  | "founder"             // Tier 2
  | "exec-other"          // Tier 2 (CEO/DG/Président)
  | null;

export interface HeadlineTierResult {
  tier: 1 | 2 | 3 | null;
  category: HeadlineTierCategory;
  matchedText: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// Regex patterns — stricts pour éviter faux positifs
// ──────────────────────────────────────────────────────────────────────

// Tier 1 : décideur tech opérationnel (ICP B2B QA/dev/tech)
// Volontairement strict : "Director" seul est trop générique → on exige
// "Director of Engineering" ou "Engineering Director". "VP" idem.
const TIER_1_RX =
  /\b(cto|chief\s+tech(?:nology)?\s+officer|directeur\s+technique|responsable\s+technique|head\s+of\s+(?:engineering|tech|qa|quality|product|development|dev|platform|architecture)|vp\s+(?:of\s+)?(?:engineering|tech|product|technology)|vice.?president\s+(?:of\s+)?(?:engineering|tech)|engineering\s+director|director\s+of\s+engineering|tech\s+lead|engineering\s+manager|chief\s+architect)\b/i;

// Tier 2 — Founder pattern (priorité absolue sur CEO si les deux apparaissent)
const FOUNDER_RX =
  /\b(co.?founder|cofondateur|fondateur|founder)\b/i;

// Tier 2 — Exec other (CEO / DG / Président / Gérant)
// Volontairement strict : "Directeur" seul → besoin de "Directeur Général"
// (pas "Directeur commercial" qui n'est pas exec). "Manager" exclu.
const EXEC_OTHER_RX =
  /\b(ceo|chief\s+executive\s+officer|directeur\s+g[ée]n[ée]ral(?:\s+adjoint)?|d\.?g\.?(?:\s+adjoint)?\b|pr[ée]sident(?:e|\s+du\s+directoire)?|g[ée]rant(?:e)?|managing\s+director|general\s+manager|coo|chief\s+operating\s+officer|directeur\s+op[ée]rationnel)\b/i;

// ──────────────────────────────────────────────────────────────────────
// Main function
// ──────────────────────────────────────────────────────────────────────

export function computeTierFromHeadline(
  headline: string | null | undefined,
): HeadlineTierResult {
  if (!headline || typeof headline !== "string") {
    return { tier: null, category: null, matchedText: null };
  }
  const text = headline.trim();
  if (text.length === 0) {
    return { tier: null, category: null, matchedText: null };
  }

  // Priorité 1 : CTO / Tech Lead (le plus précieux pour B2B QA/Tech)
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

  // Priorité 3 : exec other (CEO/DG/Président)
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
