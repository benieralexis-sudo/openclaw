/**
 * V1 17/05/2026 — Suggestion auto des 3 piliers selon l'ICP du client.
 *
 * Heuristique simple basée sur :
 *   - Le rôle décideur visé (Sales / Tech / CXO / autre)
 *   - Les industries cibles (SaaS B2B / ESN / AI / autres)
 *
 * Retourne 3 codes piliers (P1-B7) recommandés. L'utilisateur garde la
 * main pour modifier, c'est juste un point de départ intelligent.
 *
 * Module 100% PUR : zéro dépendance DB/IO.
 */

export interface IcpForSuggestion {
  personaTitles?: string[];
  industries?: string[];
}

/**
 * Mots-clés indicatifs par profil produit.
 * Si le décideur visé matche → on adapte les 3 piliers.
 */
const SALES_KEYWORDS = ["sales", "sdr", "bdr", "account", "growth", "marketing", "cmo", "cro", "vp sales", "revenue"];
const TECH_KEYWORDS = ["cto", "engineering", "developer", "qa", "test", "devops", "data", "tech", "ingénieur"];
const AI_KEYWORDS = ["ai", "ml", "intelligence artificielle", "data scientist", "machine learning", "llm"];

function matchesAny(haystack: string[], needles: string[]): boolean {
  const h = haystack.map((s) => s.toLowerCase());
  return needles.some((n) => h.some((s) => s.includes(n)));
}

/**
 * Retourne 3 codes piliers recommandés.
 *
 * Logique :
 *   - Si décideur = Sales/Growth → P1 + B1 + P5 (recrutement + levée + croissance)
 *     = profil iFIND classique pour vendre du sales intelligence
 *   - Si décideur = Tech avec contexte AI → P1 + P4 + B1 (hire + AI + levée)
 *     = profil DTL pour vendre du QA-as-a-Service IA
 *   - Si décideur = Tech sans AI → P1 + B1 + P5
 *   - Default → P1 + B1 + P5 (les 3 plus universellement utiles)
 *
 * Tous les sets contiennent P1 (Recrutement) qui est universel et le signal
 * #1 marché 2026.
 */
export function suggestPillars(icp: IcpForSuggestion): string[] {
  const personas = icp.personaTitles ?? [];
  const industries = icp.industries ?? [];
  const allKeywords = [...personas, ...industries];

  const isSales = matchesAny(allKeywords, SALES_KEYWORDS);
  const isTech = matchesAny(allKeywords, TECH_KEYWORDS);
  const isAi = matchesAny(allKeywords, AI_KEYWORDS);

  if (isTech && isAi) {
    // Profil tech + IA : QA-as-a-Service pour apps IA (cas DTL)
    return ["P1", "P4", "B1"];
  }
  if (isSales) {
    // Profil sales : sales intelligence pour scale-ups (cas iFIND)
    return ["P1", "B1", "P5"];
  }
  if (isTech) {
    // Profil tech générique : recrutement tech + croissance + levée
    return ["P1", "P5", "B1"];
  }
  // Default : les 3 signaux les plus universellement prédictifs (marché 2026)
  return ["P1", "B1", "P5"];
}
