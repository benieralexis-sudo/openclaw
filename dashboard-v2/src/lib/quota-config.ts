// Sprint 7 (10/05/2026) — Schema Zod pour Client.quotaConfig (JSON).
//
// Permet d'isoler la facturation API par tenant et d'alerter quand un quota
// atteint 80% (warning) ou 100% (block — pollers skip ce client).
//
// Reset mensuel automatique via cron 1er du mois (currentSpendUsd → 0).

import { z } from "zod";

export const ProviderQuotaSchema = z.object({
  enabled: z.boolean().default(true),
  /** Limite douce — alerte Telegram a 80% */
  monthlyBudgetUsd: z.number().min(0).default(0),
  /** Limite dure — pollers skip ce client si depasse */
  hardCapUsd: z.number().min(0).default(0),
  /** Conso cumulee mois en cours (reset par cron au 1er du mois) */
  currentSpendUsd: z.number().min(0).default(0),
  /** Date de derniere remise a zero (ISO) */
  lastResetAt: z.string().datetime().nullable().optional(),
});
export type ProviderQuota = z.infer<typeof ProviderQuotaSchema>;

export const QuotaConfigSchema = z.object({
  anthropic: ProviderQuotaSchema.default({} as ProviderQuota),
  apify: ProviderQuotaSchema.default({} as ProviderQuota),
  theirstack: ProviderQuotaSchema.default({} as ProviderQuota),
  /** Date a laquelle le compteur sera prochainement reset (1er du mois suivant) */
  nextResetAt: z.string().datetime().nullable().optional(),
});
export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;

export const PROVIDERS = ["anthropic", "apify", "theirstack"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function parseQuotaConfig(raw: unknown): QuotaConfig {
  const parsed = QuotaConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  console.warn("[quota-config] parse failed, using defaults:", parsed.error.issues[0]);
  return QuotaConfigSchema.parse({});
}

/**
 * Cap defaults raisonnables par plan client (override possible via UI).
 */
export const DEFAULT_QUOTAS_BY_PLAN: Record<string, Partial<Record<Provider, { monthlyBudgetUsd: number; hardCapUsd: number }>>> = {
  // Offre publique unique depuis 09/05/2026 : iFIND Growth 390€/mo annuel
  // (60 leads qualifiés/mois + 6 Pépites garanties + rollover 4 mois).
  // Quotas calibrés pour viser marge brute >70% sur 390€.
  GROWTH: {
    anthropic: { monthlyBudgetUsd: 60, hardCapUsd: 110 },
    apify: { monthlyBudgetUsd: 60, hardCapUsd: 120 },
    theirstack: { monthlyBudgetUsd: 50, hardCapUsd: 90 },
  },
  // DEPRECATED depuis pivot Data-only 05/05/2026.
  // Garde pour clients grandfathered (DTL Fred 199€/mo jusqu'à fin contrat).
  LEADS_DATA: {
    anthropic: { monthlyBudgetUsd: 25, hardCapUsd: 50 },
    apify: { monthlyBudgetUsd: 30, hardCapUsd: 60 },
    theirstack: { monthlyBudgetUsd: 30, hardCapUsd: 50 },
  },
  // Deals enterprise négociés à la main — calé par défaut sur Growth,
  // override possible via UI client par client.
  CUSTOM: {
    anthropic: { monthlyBudgetUsd: 60, hardCapUsd: 110 },
    apify: { monthlyBudgetUsd: 60, hardCapUsd: 120 },
    theirstack: { monthlyBudgetUsd: 50, hardCapUsd: 90 },
  },
  // FULL_SERVICE supprimé du config 11/05/2026 (offre abandonnée 05/05).
  // Si un client legacy en a encore la valeur en DB, on retombe sur les
  // defaults vides du QuotaConfigSchema (non-bloquant).
};
