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

/** Modèle pour le scoring qualify 1-10. Sonnet 4.6 retenu après test A/B :
 * Haiku 4.5 trop défensif sur edge cases (-2 points sur 1/5 leads test 28/04),
 * Sonnet 4.6 garde la qualité Opus pour 80% d'économie (vs 93% Haiku, écart 18€/mois). */
export const QUALIFY_MODEL = "claude-sonnet-4-6";
