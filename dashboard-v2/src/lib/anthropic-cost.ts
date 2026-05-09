// Sprint 8 (10/05/2026) — Calcul du cout USD d'un appel Anthropic.
//
// Utilise par qualify-trigger.ts (V1+V2) pour record la depense apres chaque
// appel via lib/quota-checker.ts recordSpend.
//
// Tarifs Anthropic janvier 2026 (USD par 1M tokens). Source :
// https://www.anthropic.com/api#pricing

const PRICING_PER_1M: Record<string, { in: number; out: number; cache_create: number; cache_read: number }> = {
  "claude-opus-4-7":            { in: 15, out: 75, cache_create: 18.75, cache_read: 1.5 },
  "claude-opus-4-6":            { in: 15, out: 75, cache_create: 18.75, cache_read: 1.5 },
  "claude-sonnet-4-6":          { in: 3,  out: 15, cache_create: 3.75,  cache_read: 0.3 },
  "claude-sonnet-4-5":          { in: 3,  out: 15, cache_create: 3.75,  cache_read: 0.3 },
  "claude-haiku-4-5":           { in: 1,  out: 5,  cache_create: 1.25,  cache_read: 0.1 },
  "claude-haiku-4-5-20251001":  { in: 1,  out: 5,  cache_create: 1.25,  cache_read: 0.1 },
};

const DEFAULT_PRICING = PRICING_PER_1M["claude-opus-4-7"]!;

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Calcule le cout USD d'un appel Anthropic a partir de l'objet usage retourne
 * par anthropic.messages.create().
 *
 * Si modele inconnu : fallback sur Opus 4.7 (tarif le plus cher = conservateur).
 */
export function computeAnthropicCost(
  model: string,
  usage: AnthropicUsage,
): number {
  const p = PRICING_PER_1M[model] ?? DEFAULT_PRICING;
  const inTk = usage.input_tokens ?? 0;
  const outTk = usage.output_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  const cost =
    (inTk * p.in +
      outTk * p.out +
      cacheCreate * p.cache_create +
      cacheRead * p.cache_read) /
    1_000_000;

  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimales
}
