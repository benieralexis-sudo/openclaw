import { describe, it, expect } from "vitest";
import {
  QuotaConfigSchema,
  parseQuotaConfig,
  ProviderQuotaSchema,
  DEFAULT_QUOTAS_BY_PLAN,
} from "./quota-config";

describe("QuotaConfig — parsing", () => {
  it("retourne defaults safe si JSON null", () => {
    const cfg = parseQuotaConfig(null);
    expect(cfg.anthropic.enabled).toBe(true);
    expect(cfg.anthropic.currentSpendUsd).toBe(0);
    expect(cfg.anthropic.hardCapUsd).toBe(0);
  });

  it("parse une config valide", () => {
    const raw = {
      anthropic: { enabled: true, monthlyBudgetUsd: 30, hardCapUsd: 60, currentSpendUsd: 12.5 },
      apify: { enabled: true, monthlyBudgetUsd: 40, hardCapUsd: 80, currentSpendUsd: 20 },
      theirstack: { enabled: false, monthlyBudgetUsd: 0, hardCapUsd: 0, currentSpendUsd: 0 },
    };
    const cfg = parseQuotaConfig(raw);
    expect(cfg.anthropic.hardCapUsd).toBe(60);
    expect(cfg.apify.currentSpendUsd).toBe(20);
    expect(cfg.theirstack.enabled).toBe(false);
  });

  it("rejette un montant negatif", () => {
    const result = ProviderQuotaSchema.safeParse({
      enabled: true,
      monthlyBudgetUsd: -10,
      hardCapUsd: 50,
      currentSpendUsd: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejette un schema invalide (champ inexistant)", () => {
    const result = QuotaConfigSchema.safeParse({
      anthropic: { enabled: "yes" }, // type wrong
    });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_QUOTAS_BY_PLAN", () => {
  it("LEADS_DATA defaults < FULL_SERVICE defaults", () => {
    const leads = DEFAULT_QUOTAS_BY_PLAN.LEADS_DATA;
    const full = DEFAULT_QUOTAS_BY_PLAN.FULL_SERVICE;
    expect(leads?.anthropic?.hardCapUsd).toBeLessThan(full?.anthropic?.hardCapUsd ?? Infinity);
    expect(leads?.apify?.hardCapUsd).toBeLessThan(full?.apify?.hardCapUsd ?? Infinity);
  });
  it("CUSTOM defaults entre LEADS_DATA et FULL_SERVICE", () => {
    const custom = DEFAULT_QUOTAS_BY_PLAN.CUSTOM;
    expect(custom?.anthropic?.hardCapUsd).toBe(100);
  });
});
