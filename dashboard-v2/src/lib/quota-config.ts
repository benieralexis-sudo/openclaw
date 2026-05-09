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
  LEADS_DATA: {
    anthropic: { monthlyBudgetUsd: 25, hardCapUsd: 50 },
    apify: { monthlyBudgetUsd: 30, hardCapUsd: 60 },
    theirstack: { monthlyBudgetUsd: 30, hardCapUsd: 50 },
  },
  FULL_SERVICE: {
    anthropic: { monthlyBudgetUsd: 80, hardCapUsd: 150 },
    apify: { monthlyBudgetUsd: 100, hardCapUsd: 200 },
    theirstack: { monthlyBudgetUsd: 90, hardCapUsd: 150 },
  },
  CUSTOM: {
    anthropic: { monthlyBudgetUsd: 50, hardCapUsd: 100 },
    apify: { monthlyBudgetUsd: 50, hardCapUsd: 100 },
    theirstack: { monthlyBudgetUsd: 50, hardCapUsd: 100 },
  },
};
