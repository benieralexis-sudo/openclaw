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
 *
 * V1 18/05 — CAP DUR : si balance ≤ 0, refuse atomiquement le débit (au lieu
 * de descendre en négatif comme avant). Garantit qu'un client ne reçoit
 * JAMAIS plus de leads que son quota. Le système se débloque uniquement via :
 *   - achat d'overage (creditOveragePurchase)
 *   - reset 30j anniversaire (resetClientIfDueForReset)
 */
export type DebitResult =
  | { debited: true; isPepite: boolean; balanceAfter: number; reason?: never }
  | { debited: false; isPepite: boolean; balanceAfter: number; reason: "score_too_low" | "client_not_found" | "plan_not_growth" | "already_debited" | "cap_reached" };

export async function debitCreditForQualifiedLead(args: {
  clientId: string;
  triggerId: string;
  leadId?: string | null;
  score: number;
}): Promise<DebitResult> {
  if (args.score < 6) {
    return { debited: false, isPepite: false, balanceAfter: -1, reason: "score_too_low" };
  }

  // Bug B11 fix (Session 3, 10/05/2026) — Skip débit si plan != GROWTH.
  // Avant : Tous les clients étaient débités, y compris DTL grandfathered
  // (LEADS_DATA 199€/mo) → balance descendait en négatif. Maintenant :
  // seuls les clients GROWTH (390€/mo offre publique 09/05) sont débités.
  // Les LEADS_DATA (legacy DTL) et CUSTOM (deals enterprise) ne consomment
  // pas de crédits (modèles sans quota/Pépite garantie). L'enum
  // FULL_SERVICE existe encore en DB pour rétro-compat mais l'offre est
  // abandonnée depuis le pivot Data-only du 05/05/2026.
  const client = await db.client.findUnique({
    where: { id: args.clientId },
    select: { plan: true, creditsBalance: true },
  });
  if (!client) {
    return { debited: false, isPepite: false, balanceAfter: -1, reason: "client_not_found" };
  }
  if (client.plan !== "GROWTH") {
    // Pas de débit pour grandfathered. Retourne balance actuelle pour info.
    return { debited: false, isPepite: false, balanceAfter: client.creditsBalance, reason: "plan_not_growth" };
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
      reason: "already_debited",
    };
  }

  const isPepite = args.score >= 8;
  const reason = isPepite ? "debit_pepite" : "debit_qualif";

  // V1 18/05 — Transaction atomique avec CAP DUR.
  // updateMany filtre par creditsBalance > 0 → si 0 ou moins, 0 ligne mise à
  // jour, on détecte le cap atteint et on refuse le débit sans modifier le
  // balance. Évite la race condition entre check et write.
  return db.$transaction(async (tx) => {
    const updateResult = await tx.client.updateMany({
      where: { id: args.clientId, creditsBalance: { gt: 0 } },
      data: {
        creditsBalance: { decrement: 1 },
        ...(isPepite && { pepitesThisMonth: { increment: 1 } }),
      },
    });

    if (updateResult.count === 0) {
      // Balance était à 0 — cap atteint. On log un audit row pour traçabilité.
      const current = await tx.client.findUnique({
        where: { id: args.clientId },
        select: { creditsBalance: true },
      });
      await tx.leadCredit.create({
        data: {
          clientId: args.clientId,
          amount: 0,
          reason: "cap_reached_blocked",
          triggerId: args.triggerId,
          leadId: args.leadId ?? null,
          score: args.score,
          isPepite,
          balanceAfter: current?.creditsBalance ?? 0,
          metadata: { wouldHaveBeenPepite: isPepite },
        },
      });
      return {
        debited: false,
        isPepite,
        balanceAfter: current?.creditsBalance ?? 0,
        reason: "cap_reached" as const,
      };
    }

    const after = await tx.client.findUnique({
      where: { id: args.clientId },
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
        balanceAfter: after?.creditsBalance ?? 0,
      },
    });
    return {
      debited: true,
      isPepite,
      balanceAfter: after?.creditsBalance ?? 0,
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
 *
 * V1 18/05/2026 — DEPRECATED en faveur de resetClientsDueForAnniversary
 * qui reset par client à son anniversaire (30j depuis dernière dose), pas
 * tout le monde le 1er. Garde la fonction pour rétro-compat des scripts qui
 * l'appellent encore.
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
 * V1 18/05/2026 — Reset 30j anniversaire par client.
 *
 * À appeler tous les jours via cron. Pour chaque client ACTIVE :
 *   - Calcule l'anniversaire = creditsLastResetAt + 30j (ou activatedAt + 30j
 *     si pas encore reset)
 *   - Si maintenant >= anniversaire, déclenche le reset (crédit le quota
 *     mensuel, reset pepitesThisMonth, update creditsLastResetAt)
 *
 * Pourquoi 30j et pas calendaire ? Pour qu'un client souscrit le 15 du mois
 * ait son cycle qui reprend le 15 de chaque mois, pas le 1er. Plus juste pour
 * les souscriptions fin-de-mois (un client qui souscrit le 28 n'aura pas son
 * quota grillé en 3 jours).
 */
export async function resetClientsDueForAnniversary(): Promise<{
  scanned: number;
  resetCount: number;
  guaranteeTriggeredCount: number;
  details: Array<{
    clientId: string;
    clientName: string;
    daysSinceLastReset: number;
    triggered: boolean;
    result?: Awaited<ReturnType<typeof resetMonthlyCreditsForClient>>;
  }>;
}> {
  const clients = await db.client.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      name: true,
      activatedAt: true,
      creditsLastResetAt: true,
    },
  });

  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 86_400_000;
  const details: Array<{
    clientId: string;
    clientName: string;
    daysSinceLastReset: number;
    triggered: boolean;
    result?: Awaited<ReturnType<typeof resetMonthlyCreditsForClient>>;
  }> = [];
  let resetCount = 0;
  let guaranteeTriggeredCount = 0;

  for (const c of clients) {
    // Référence = dernier reset, fallback sur activatedAt (premier cycle).
    // Si ni l'un ni l'autre n'est posé, on skip (client mal configuré).
    const ref = c.creditsLastResetAt ?? c.activatedAt;
    if (!ref) {
      details.push({
        clientId: c.id,
        clientName: c.name,
        daysSinceLastReset: -1,
        triggered: false,
      });
      continue;
    }

    const elapsed = now - ref.getTime();
    const daysSinceLastReset = Math.floor(elapsed / 86_400_000);

    if (elapsed < THIRTY_DAYS_MS) {
      details.push({
        clientId: c.id,
        clientName: c.name,
        daysSinceLastReset,
        triggered: false,
      });
      continue;
    }

    try {
      const result = await resetMonthlyCreditsForClient(c.id);
      resetCount += 1;
      if (result.guaranteeTriggered) guaranteeTriggeredCount += 1;
      details.push({
        clientId: c.id,
        clientName: c.name,
        daysSinceLastReset,
        triggered: true,
        result,
      });
      console.log(
        `[credits.anniversary] client=${c.name} reset triggered after ${daysSinceLastReset}j, newBalance=${result.newBalance}`,
      );
    } catch (e) {
      console.error(`[credits.anniversary] client=${c.id} failed:`, e);
      details.push({
        clientId: c.id,
        clientName: c.name,
        daysSinceLastReset,
        triggered: false,
      });
    }
  }

  return {
    scanned: clients.length,
    resetCount,
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
