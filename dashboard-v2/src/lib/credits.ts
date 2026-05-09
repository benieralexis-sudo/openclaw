import "server-only";
import { db } from "@/lib/db";
import { computeMonthlyResetParams, ROLLOVER_CAP_MULTIPLIER } from "@/lib/credits-math";

// Re-export pour compat
export { computeMonthlyResetParams, ROLLOVER_CAP_MULTIPLIER };

// =====================================================================
// Sprint Saint Graal (10/05/2026) — Mécanique crédits + garantie Pépite
//
// Modèle :
//   - 1 lead qualifié (score >= 6) = 1 crédit débité
//   - Pépite (score >= 8) = 1 crédit débité + increment pepitesThisMonth
//   - Reset mensuel le 1er : creditsBalance = creditsMonthlyQuota + rollovers
//     non-expirés, pepitesThisMonth = 0
//   - Si pepitesThisMonth < pepitesGuaranteed mois précédent → quota courant
//     doublé (guaranteeBonusActive = true)
//   - Crédits non-utilisés rollent 3 mois (puis expirent)
//
// Reasons LeadCredit :
//   credit_monthly, credit_rollover, credit_overage_purchased,
//   credit_guarantee_double, debit_qualif, debit_pepite, expiry_rollover
// =====================================================================

export interface CreditCheckResult {
  ok: boolean;
  reason?: string;
  balance: number;
  monthlyQuota: number;
  pepitesThisMonth: number;
  pepitesGuaranteed: number;
}

/**
 * Vérifie si le client a des crédits disponibles avant de débiter.
 * Si solde <= 0 → bloque le débit (mais on continue à qualifier en interne,
 * juste on ne lui livre pas le lead — il devra acheter de l'overage).
 */
export async function checkCreditsAvailable(
  clientId: string,
): Promise<CreditCheckResult> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      creditsBalance: true,
      creditsMonthlyQuota: true,
      pepitesThisMonth: true,
      pepitesGuaranteed: true,
    },
  });
  if (!client) {
    return {
      ok: false,
      reason: "client_not_found",
      balance: 0,
      monthlyQuota: 0,
      pepitesThisMonth: 0,
      pepitesGuaranteed: 0,
    };
  }
  return {
    ok: client.creditsBalance > 0,
    reason: client.creditsBalance > 0 ? "ok" : "no_credits",
    balance: client.creditsBalance,
    monthlyQuota: client.creditsMonthlyQuota,
    pepitesThisMonth: client.pepitesThisMonth,
    pepitesGuaranteed: client.pepitesGuaranteed,
  };
}

/**
 * Débite 1 crédit pour un lead qualifié (score >= 6).
 * Si Pépite (score >= 8), incrémente aussi pepitesThisMonth.
 * Crée une entrée LeadCredit pour audit.
 *
 * Idempotent : si déjà débité pour ce trigger, no-op.
 */
export async function debitCreditForQualifiedLead(args: {
  clientId: string;
  triggerId: string;
  leadId?: string | null;
  score: number;
}): Promise<{ debited: boolean; isPepite: boolean; balanceAfter: number }> {
  if (args.score < 6) {
    return { debited: false, isPepite: false, balanceAfter: -1 };
  }

  // Idempotence : check si déjà débité pour ce trigger
  const existing = await db.leadCredit.findFirst({
    where: {
      clientId: args.clientId,
      triggerId: args.triggerId,
      reason: { in: ["debit_qualif", "debit_pepite"] },
    },
    select: { id: true, balanceAfter: true, isPepite: true },
  });
  if (existing) {
    return {
      debited: false,
      isPepite: existing.isPepite,
      balanceAfter: existing.balanceAfter,
    };
  }

  const isPepite = args.score >= 8;
  const reason = isPepite ? "debit_pepite" : "debit_qualif";

  // Transaction atomique : update Client + insert LeadCredit
  return db.$transaction(async (tx) => {
    const client = await tx.client.update({
      where: { id: args.clientId },
      data: {
        creditsBalance: { decrement: 1 },
        ...(isPepite && { pepitesThisMonth: { increment: 1 } }),
      },
      select: { creditsBalance: true },
    });
    await tx.leadCredit.create({
      data: {
        clientId: args.clientId,
        amount: -1,
        reason,
        triggerId: args.triggerId,
        leadId: args.leadId ?? null,
        score: args.score,
        isPepite,
        balanceAfter: client.creditsBalance,
      },
    });
    return {
      debited: true,
      isPepite,
      balanceAfter: client.creditsBalance,
    };
  });
}


/**
 * Reset mensuel : crédite le quota mensuel + bonus garantie si applicable.
 * À appeler le 1er du mois via cron.
 *
 * Logique :
 *   1. Check pepitesThisMonth (mois sortant) vs pepitesGuaranteed
 *   2. Si garantie ratée → quota courant doublé (guaranteeBonusActive=true)
 *   3. Reset pepitesThisMonth = 0
 *   4. Crédite le nouveau quota au balance courant (= rollover automatique
 *      des credits non-utilises du mois precedent)
 *   5. Cap le balance final a ROLLOVER_CAP_MULTIPLIER * quota (anti-accumulation)
 *   6. Update creditsLastResetAt
 */
export async function resetMonthlyCreditsForClient(
  clientId: string,
): Promise<{
  newBalance: number;
  guaranteeTriggered: boolean;
  quotaCredited: number;
  pepitesPreviousMonth: number;
  cappedAmount: number;
}> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      creditsBalance: true,
      creditsMonthlyQuota: true,
      pepitesThisMonth: true,
      pepitesGuaranteed: true,
    },
  });
  if (!client) throw new Error(`Client ${clientId} not found`);

  const guaranteeTriggered =
    client.pepitesThisMonth < client.pepitesGuaranteed;
  const quotaCredited = guaranteeTriggered
    ? client.creditsMonthlyQuota * 2
    : client.creditsMonthlyQuota;

  // Calcul rollover cap
  const rolloverCap = client.creditsMonthlyQuota * ROLLOVER_CAP_MULTIPLIER;
  const naiveNewBalance = client.creditsBalance + quotaCredited;
  const cappedBalance = Math.min(naiveNewBalance, rolloverCap);
  const cappedAmount = naiveNewBalance - cappedBalance; // > 0 si on a coupe du rollover

  return db.$transaction(async (tx) => {
    const updated = await tx.client.update({
      where: { id: clientId },
      data: {
        creditsBalance: cappedBalance,
        pepitesThisMonth: 0,
        guaranteeBonusActive: guaranteeTriggered,
        creditsLastResetAt: new Date(),
      },
      select: { creditsBalance: true },
    });
    await tx.leadCredit.create({
      data: {
        clientId,
        amount: quotaCredited - cappedAmount, // amount net credite (apres cap)
        reason: guaranteeTriggered ? "credit_guarantee_double" : "credit_monthly",
        balanceAfter: updated.creditsBalance,
        metadata: {
          pepitesPreviousMonth: client.pepitesThisMonth,
          pepitesGuaranteed: client.pepitesGuaranteed,
          guaranteeTriggered,
          quotaRequested: quotaCredited,
          cappedAmount,
          balanceBefore: client.creditsBalance,
        },
      },
    });
    if (cappedAmount > 0) {
      await tx.leadCredit.create({
        data: {
          clientId,
          amount: -cappedAmount,
          reason: "expiry_rollover",
          balanceAfter: updated.creditsBalance,
          metadata: { reason: "rollover_cap_exceeded", capMultiplier: ROLLOVER_CAP_MULTIPLIER },
        },
      });
    }
    return {
      newBalance: updated.creditsBalance,
      guaranteeTriggered,
      quotaCredited,
      pepitesPreviousMonth: client.pepitesThisMonth,
      cappedAmount,
    };
  });
}

/**
 * Reset mensuel pour TOUS les clients ACTIVE.
 * Appelé par /api/internal/reset-monthly-credits via cron 1er du mois.
 */
export async function resetMonthlyCreditsAllClients(): Promise<{
  processedCount: number;
  guaranteeTriggeredCount: number;
  details: Array<{ clientId: string; clientName: string; result: Awaited<ReturnType<typeof resetMonthlyCreditsForClient>> }>;
}> {
  const clients = await db.client.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
  });
  const details: Array<{ clientId: string; clientName: string; result: Awaited<ReturnType<typeof resetMonthlyCreditsForClient>> }> = [];
  let guaranteeTriggeredCount = 0;
  for (const c of clients) {
    try {
      const result = await resetMonthlyCreditsForClient(c.id);
      if (result.guaranteeTriggered) guaranteeTriggeredCount += 1;
      details.push({ clientId: c.id, clientName: c.name, result });
    } catch (e) {
      console.error(`[credits.reset] client=${c.id} failed:`, e);
    }
  }
  return {
    processedCount: details.length,
    guaranteeTriggeredCount,
    details,
  };
}

/**
 * Crédite des crédits achetés en overage Stripe (8eur/lead).
 * Appelé par webhook Stripe sur achat metered.
 */
export async function creditOveragePurchase(args: {
  clientId: string;
  amount: number;
  stripeInvoiceId: string;
}): Promise<{ newBalance: number }> {
  return db.$transaction(async (tx) => {
    const updated = await tx.client.update({
      where: { id: args.clientId },
      data: { creditsBalance: { increment: args.amount } },
      select: { creditsBalance: true },
    });
    await tx.leadCredit.create({
      data: {
        clientId: args.clientId,
        amount: args.amount,
        reason: "credit_overage_purchased",
        balanceAfter: updated.creditsBalance,
        metadata: { stripeInvoiceId: args.stripeInvoiceId },
      },
    });
    return { newBalance: updated.creditsBalance };
  });
}
