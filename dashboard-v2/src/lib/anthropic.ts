import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY non défini dans .env");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Modèle pour la génération des briefs commerciaux (qualité copywriting). */
export const BRIEF_MODEL = "claude-opus-4-7";

/** Modèle pour le scoring qualify 1-10.
 *
 * DÉCISION 28/04 (post test profond sur 26 leads) : Opus 4.7 retenu.
 *
 * Comparatif Opus vs Sonnet 4.6 :
 * - 14/26 scores identiques (54%)
 * - 6/26 écarts légers ±1 (23%)
 * - 2/26 écarts ±2 (8%)
 * - 4/26 écarts ≥3 (15%) — TOUS Sonnet trop généreux
 * - 2 erreurs critiques Sonnet : LYNX RH (cabinet de recrutement = ANTI-ICP) noté 8 par Sonnet vs 2 Opus ; PRECIA (balances industrielles) noté 8 vs 3.
 *
 * Le scoring qualify exige une compréhension contextuelle du secteur basée
 * sur le NOM de l'entreprise (recherche Google implicite). Sonnet rate ces
 * inférences. Opus 4.7 reste indispensable malgré coût +111€/mois — le risque
 * d'envoyer des cold emails à des concurrents/anti-ICP coûte plus cher en
 * temps commercial perdu et en deliverability dégradée.
 */
export const QUALIFY_MODEL = "claude-opus-4-7";
