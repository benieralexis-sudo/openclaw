import "server-only";
import { db } from "@/lib/db";
import { getSignalCodeFromSourceCode } from "@/lib/signal-mapping";

/**
 * Stratégie V1 (17/05/2026) — Backfill du signalCode sur les Triggers qui
 * n'en ont pas encore. Calculé depuis sourceCode via signal-mapping.
 *
 * Idempotent : ne touche que les Triggers où signalCode IS NULL.
 * À appeler dans chaque cycle de cron (horaire) pour rattraper les nouveaux
 * Triggers créés depuis le dernier passage. Coût : 1 SELECT + N updates
 * groupés par signalCode (typiquement 0-50 Triggers/cycle).
 *
 * Note pour les sources legacy non-mappées : on les laisse à NULL.
 * Elles ne participeront pas aux mécaniques signal/combo/pillar.
 */
export async function backfillSignalCodes(options: {
  clientId?: string;
  limit?: number;
} = {}): Promise<{
  scanned: number;
  updated: number;
  unmapped: number;
}> {
  const limit = options.limit ?? 500;
  const triggers = await db.trigger.findMany({
    where: {
      ...(options.clientId ? { clientId: options.clientId } : {}),
      signalCode: null,
      deletedAt: null,
    },
    select: { id: true, sourceCode: true },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  const stats = { scanned: triggers.length, updated: 0, unmapped: 0 };

  // Groupe par signalCode pour batch update
  const idsBySignal = new Map<string, string[]>();
  for (const t of triggers) {
    const signalCode = getSignalCodeFromSourceCode(t.sourceCode);
    if (!signalCode) {
      stats.unmapped += 1;
      continue;
    }
    let list = idsBySignal.get(signalCode);
    if (!list) {
      list = [];
      idsBySignal.set(signalCode, list);
    }
    list.push(t.id);
  }

  for (const [signalCode, ids] of idsBySignal.entries()) {
    const result = await db.trigger.updateMany({
      where: { id: { in: ids } },
      data: { signalCode },
    });
    stats.updated += result.count;
  }

  return stats;
}
