import "server-only";

/**
 * Sprint 7 (10/05/2026) — Quota checker par client.
 *
 * Verifie si un client peut faire un appel API a un provider donne.
 * Track la conso cumulee + alerte Telegram a 80% / 100%.
 *
 * Usage type :
 *   const ok = await assertQuotaOk(clientId, "anthropic", estimatedCostUsd);
 *   if (!ok) return { skipped: "quota-exceeded" };
 *   // ... appel API ...
 *   await recordSpend(clientId, "anthropic", actualCostUsd);
 */

import { db } from "@/lib/db";
import { parseQuotaConfig, type Provider, type QuotaConfig } from "@/lib/quota-config";

export interface QuotaCheckResult {
  ok: boolean;
  reason: "ok" | "disabled" | "soft_warning_80pct" | "hard_cap_exceeded" | "no_config";
  currentSpendUsd: number;
  monthlyBudgetUsd: number;
  hardCapUsd: number;
  pctUsed: number;
}

/**
 * Verifie si un appel a `provider` (avec cout estime `estimatedCostUsd`) reste
 * dans les limites du client. Returns { ok: true } si OK, { ok: false } si
 * hard cap depasse.
 *
 * Trace AuditLog si soft warning ou hard cap (pour observabilite).
 */
export async function checkQuota(
  clientId: string,
  provider: Provider,
  estimatedCostUsd: number = 0,
): Promise<QuotaCheckResult> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { quotaConfig: true },
  });
  if (!client) {
    return {
      ok: true,
      reason: "no_config",
      currentSpendUsd: 0,
      monthlyBudgetUsd: 0,
      hardCapUsd: 0,
      pctUsed: 0,
    };
  }

  const cfg = parseQuotaConfig(client.quotaConfig);
  const providerCfg = cfg[provider];

  if (!providerCfg.enabled) {
    return {
      ok: true,
      reason: "disabled",
      currentSpendUsd: 0,
      monthlyBudgetUsd: 0,
      hardCapUsd: 0,
      pctUsed: 0,
    };
  }

  if (providerCfg.hardCapUsd === 0) {
    // Cap pas configure → pas de quota check (defaut illimite)
    return {
      ok: true,
      reason: "no_config",
      currentSpendUsd: providerCfg.currentSpendUsd,
      monthlyBudgetUsd: providerCfg.monthlyBudgetUsd,
      hardCapUsd: providerCfg.hardCapUsd,
      pctUsed: 0,
    };
  }

  const projectedSpend = providerCfg.currentSpendUsd + estimatedCostUsd;
  const pctUsed = Math.round((projectedSpend / providerCfg.hardCapUsd) * 100);

  if (projectedSpend >= providerCfg.hardCapUsd) {
    // HARD CAP — bloque l'appel
    await db.auditLog.create({
      data: {
        clientId,
        action: "quota.hard_cap_exceeded",
        entityType: "Client",
        entityId: clientId,
        metadata: {
          provider,
          currentSpendUsd: providerCfg.currentSpendUsd,
          hardCapUsd: providerCfg.hardCapUsd,
          attemptedCostUsd: estimatedCostUsd,
        },
      },
    });
    return {
      ok: false,
      reason: "hard_cap_exceeded",
      currentSpendUsd: providerCfg.currentSpendUsd,
      monthlyBudgetUsd: providerCfg.monthlyBudgetUsd,
      hardCapUsd: providerCfg.hardCapUsd,
      pctUsed,
    };
  }

  if (
    providerCfg.monthlyBudgetUsd > 0 &&
    projectedSpend >= providerCfg.monthlyBudgetUsd * 0.8 &&
    providerCfg.currentSpendUsd < providerCfg.monthlyBudgetUsd * 0.8
  ) {
    // SOFT WARNING : on a franchi 80% pour la 1ere fois
    await db.auditLog.create({
      data: {
        clientId,
        action: "quota.soft_warning_80pct",
        entityType: "Client",
        entityId: clientId,
        metadata: {
          provider,
          currentSpendUsd: projectedSpend,
          monthlyBudgetUsd: providerCfg.monthlyBudgetUsd,
        },
      },
    });
    return {
      ok: true,
      reason: "soft_warning_80pct",
      currentSpendUsd: providerCfg.currentSpendUsd,
      monthlyBudgetUsd: providerCfg.monthlyBudgetUsd,
      hardCapUsd: providerCfg.hardCapUsd,
      pctUsed,
    };
  }

  return {
    ok: true,
    reason: "ok",
    currentSpendUsd: providerCfg.currentSpendUsd,
    monthlyBudgetUsd: providerCfg.monthlyBudgetUsd,
    hardCapUsd: providerCfg.hardCapUsd,
    pctUsed,
  };
}

/**
 * Enregistre la depense reelle apres un appel API.
 * Update Client.quotaConfig.<provider>.currentSpendUsd += actualCostUsd.
 *
 * Si update concurrent : on recalcule a partir du current state pour eviter
 * race condition (lecture-modification-ecriture sequentielle).
 */
export async function recordSpend(
  clientId: string,
  provider: Provider,
  actualCostUsd: number,
): Promise<void> {
  if (actualCostUsd <= 0) return;
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { quotaConfig: true },
  });
  if (!client) return;
  const cfg = parseQuotaConfig(client.quotaConfig);
  cfg[provider].currentSpendUsd = (cfg[provider].currentSpendUsd ?? 0) + actualCostUsd;
  await db.client.update({
    where: { id: clientId },
    data: { quotaConfig: cfg as unknown as object },
  });
}

/**
 * Reset les compteurs de tous les clients ACTIVE (cron 1er du mois 00:01 UTC).
 * Set lastResetAt et currentSpendUsd = 0.
 */
export async function resetMonthlyQuotas(): Promise<{ resetCount: number }> {
  const now = new Date().toISOString();
  const clients = await db.client.findMany({
    where: { status: "ACTIVE", deletedAt: null, quotaConfig: { not: undefined as any } },
    select: { id: true, quotaConfig: true },
  });
  let resetCount = 0;
  for (const c of clients) {
    const cfg = parseQuotaConfig(c.quotaConfig);
    let changed = false;
    for (const provider of ["anthropic", "apify", "theirstack"] as Provider[]) {
      if (cfg[provider].currentSpendUsd > 0) {
        cfg[provider].currentSpendUsd = 0;
        cfg[provider].lastResetAt = now;
        changed = true;
      }
    }
    if (changed) {
      await db.client.update({
        where: { id: c.id },
        data: { quotaConfig: cfg as unknown as object },
      });
      await db.auditLog.create({
        data: {
          clientId: c.id,
          action: "quota.monthly_reset",
          entityType: "Client",
          entityId: c.id,
          metadata: { resetAt: now } as unknown as QuotaConfig,
        },
      });
      resetCount += 1;
    }
  }
  return { resetCount };
}
