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

/** Modèle utilisé pour la génération des briefs commerciaux. */
export const BRIEF_MODEL = "claude-opus-4-7";
