// Sprint Persona Excellence (17/05/2026) — Phase 3
//
// Pure functions qui re-scorent un candidat persona sur 5 critères pour
// trouver LA bonne personne à contacter parmi N candidats du même
// HarvestAPI search (pas juste la première qui matche le titre).
//
// Sans dépendance DB/IO — testable directement via Vitest.
//
// Formule (total 0-100) :
//   titleMatch(0-40) + tenure(0-15) + multiSource(0-15) + signalContext(0-20) + buyer(0-10)

// ─────────────────────────────────────────────────────────────────────
// Types (locaux pour ne pas dépendre de harvestapi-decision-makers
// qui a `import "server-only"`)
// ─────────────────────────────────────────────────────────────────────

export interface ScoringCandidate {
  /** Tier brut HarvestAPI (1 = parfait match titre, 4 = fallback) */
  tier: 1 | 2 | 3 | 4;
  /** Confidence brute HarvestAPI 0-100 */
  confidence: number;
  /** Headline LinkedIn brut (peut servir au buyer profile check) */
  headline?: string;
  /** Nom complet (pour multi-source check vs Pappers dirigeants) */
  firstName: string;
  lastName: string;
  /** Positions courantes pour le tenure (champ startedAt en mois) */
  currentPositionStartedMonthsAgo?: number;
}

export type SignalType =
  | "qa-hire"
  | "tech-hire"
  | "sales-hire"
  | "fundraising"
  | "expansion"
  | "default";

export interface ScoringContext {
  signalType: SignalType;
  /** Liste des dirigeants connus via Pappers (cross-source check) */
  pappersDirigeants?: Array<{ firstName?: string; lastName?: string }>;
  /** Nombre de posts récents du décideur (90j). Phase 5 fournira. */
  recentPostsCount?: number;
  /** Nombre de posts récents matching le signal (mots-clés pertinents). Phase 5. */
  recentPostsMatching?: number;
}

export interface ScoreBreakdown {
  titleMatch: number;
  tenure: number;
  multiSource: number;
  signalContext: number;
  buyer: number;
}

export interface PersonaScore {
  total: number;
  breakdown: ScoreBreakdown;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-scorer 1 — titleMatch (0-40)
// ─────────────────────────────────────────────────────────────────────
// Tier 1 (parfait : CTO sur tech-hire, Head of QA sur qa-hire, CRO sur
// sales-hire) = 40 points. Tier 2 (Founder, VP) = 25. Tier 3 (CEO sur
// signal tech, fallback) = 10. Tier 4 = 5. On boost +0-5 points selon
// la confidence brute HarvestAPI.

export function computeTitleMatchScore(candidate: ScoringCandidate): number {
  const tierScore =
    candidate.tier === 1 ? 35 :
    candidate.tier === 2 ? 22 :
    candidate.tier === 3 ? 10 :
    5;
  const confidenceBoost = Math.round((candidate.confidence / 100) * 5);
  return Math.min(40, tierScore + confidenceBoost);
}

// ─────────────────────────────────────────────────────────────────────
// Sub-scorer 2 — tenure (0-15)
// ─────────────────────────────────────────────────────────────────────
// Sweet spot 6-36 mois (installé mais ouvert au changement) = 15.
// <6 mois (encore en construction, signal d'achat fort sur hire) = 12.
// 36-60 mois (installé) = 8. >60 mois (ancré) = 4. Inconnu = 5.

export function computeTenureScore(months: number | null | undefined): number {
  if (months === null || months === undefined) return 5;
  if (months < 6) return 12;
  if (months <= 36) return 15;
  if (months <= 60) return 8;
  return 4;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-scorer 3 — multiSource (0-15)
// ─────────────────────────────────────────────────────────────────────
// Si le candidat HarvestAPI est aussi présent dans la liste Pappers RCS
// → forte confiance que c'est bien LA personne (pas un homonyme). +15.
// Sinon 0. (HarvestAPI seul reste valable mais sans validation croisée.)

function normalizeName(s: string | undefined | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

export function computeMultiSourceScore(
  candidate: ScoringCandidate,
  pappersDirigeants: Array<{ firstName?: string; lastName?: string }> | undefined,
): number {
  if (!pappersDirigeants || pappersDirigeants.length === 0) return 0;
  const candFirst = normalizeName(candidate.firstName);
  const candLast = normalizeName(candidate.lastName);
  if (!candFirst || !candLast) return 0;
  const matched = pappersDirigeants.some((d) => {
    const pFirst = normalizeName(d.firstName);
    const pLast = normalizeName(d.lastName);
    // Match strict sur lastName + match léger sur firstName (1er prénom suffit)
    if (!pLast || pLast !== candLast) return false;
    if (!pFirst) return true;
    return pFirst === candFirst || pFirst.startsWith(candFirst) || candFirst.startsWith(pFirst);
  });
  return matched ? 15 : 0;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-scorer 4 — signalContext (0-20)
// ─────────────────────────────────────────────────────────────────────
// Récente activité LinkedIn pertinente au signal d'achat = signal d'intent.
// Phase 5 fournira recentPostsCount + recentPostsMatching. Pour Phase 3 :
//   0 posts récents → 0
//   ≥1 post matching → 20
//   ≥1 post mais 0 matching → 8 (lead actif, mais pas sur le sujet)
//   N/A → 0

export function computeSignalContextScore(
  recentPostsCount: number | undefined,
  recentPostsMatching: number | undefined,
): number {
  const count = recentPostsCount ?? 0;
  const matching = recentPostsMatching ?? 0;
  if (matching >= 1) return 20;
  if (count >= 1) return 8;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-scorer 5 — buyer (0-10)
// ─────────────────────────────────────────────────────────────────────
// Pénalise les profils Angel investor / Advisor / Investor SEUL (sans
// titre opérationnel CEO/CTO/Founder/etc.). Ces gens conseillent mais
// ne pilotent pas l'achat. +0 si pur non-buyer, +10 sinon (par défaut).

const NON_BUYER_RE =
  /\b(angel investor|business angel|investor at|advisor at|board member|conseiller(?:e)? d['']entreprise|investisseur)\b/i;
const OPERATIONAL_RE =
  /\b(ceo|cto|cmo|cfo|coo|cro|chief|director|directeur|head of|vp |founder|fondateur|co.?founder|cofondateur|gérant|président|manager|lead|engineer|développe|développeuse)\b/i;

export function computeBuyerScore(headline: string | undefined | null): number {
  if (!headline) return 10; // pas de headline → on suppose buyer par défaut
  const isNonBuyer = NON_BUYER_RE.test(headline);
  if (!isNonBuyer) return 10;
  const isAlsoOperational = OPERATIONAL_RE.test(headline);
  return isAlsoOperational ? 10 : 0;
}

// ─────────────────────────────────────────────────────────────────────
// Scorer principal — agrège les 5 sub-scorers
// ─────────────────────────────────────────────────────────────────────

export function scoreCandidate(
  candidate: ScoringCandidate,
  context: ScoringContext,
): PersonaScore {
  const titleMatch = computeTitleMatchScore(candidate);
  const tenure = computeTenureScore(candidate.currentPositionStartedMonthsAgo);
  const multiSource = computeMultiSourceScore(candidate, context.pappersDirigeants);
  const signalContext = computeSignalContextScore(
    context.recentPostsCount,
    context.recentPostsMatching,
  );
  const buyer = computeBuyerScore(candidate.headline);
  const total = Math.min(100, titleMatch + tenure + multiSource + signalContext + buyer);
  return {
    total,
    breakdown: { titleMatch, tenure, multiSource, signalContext, buyer },
  };
}

/**
 * Re-score + trie une liste de candidats par score décroissant.
 * Le top peut différer du candidat tier-1 brut si un tier-2 a un bonus
 * multi-source ou postsContext qui le porte au-dessus.
 */
export function rankCandidates(
  candidates: ScoringCandidate[],
  context: ScoringContext,
): Array<ScoringCandidate & { score: PersonaScore }> {
  return candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, context) }))
    .sort((a, b) => b.score.total - a.score.total);
}
