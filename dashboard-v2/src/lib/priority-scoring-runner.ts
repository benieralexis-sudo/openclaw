import "server-only";

/**
 * Orchestrateur DB pour le Priority Scoring Engine.
 * Recalcule freshnessScore + multiSourceBoost + priorityScore sur tous les
 * triggers actifs d'un client.
 *
 * Appelé à chaque run-pollers (cron horaire) — l'âge des triggers évolue
 * en continu, donc le score doit être recalculé fréquemment.
 *
 * Coût : 1 batch SELECT + N UPDATEs (un par trigger). Sur 121 triggers DTL
 * = ~150ms total. Aucun appel externe.
 */

import { db } from "@/lib/db";
import {
  computeFreshnessScore,
  computeMultiSourceBoost,
  computePriorityScore,
} from "@/lib/priority-scoring";

export interface PriorityScoringRunResult {
  scanned: number;
  updated: number;
  skipped: number;
  topPriorityScore: number | null;
  multiSourceCompanies: number;
}

// Fenêtre multi-source : élargie 7→14 jours le 04/05/2026 après audit
// distribution (avg multiSourceBoost = 1.64/30 max théorique). 14j matche
// la demi-vie freshnessScore et permet de capter plus de Combos cross-source
// sans dénaturer le signal "vraiment multi-source en parallèle".
const MULTI_SOURCE_WINDOW_DAYS = 14;

/**
 * Recalcule les 3 champs sur tous les triggers actifs du client.
 * Group by société (siret > companyName fallback) sur fenêtre 7j pour le boost.
 */
export async function recomputePriorityScoresForClient(
  clientId: string,
): Promise<PriorityScoringRunResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - MULTI_SOURCE_WINDOW_DAYS * 86400_000);

  const triggers = await db.trigger.findMany({
    where: { clientId, deletedAt: null },
    select: {
      id: true,
      score: true,
      sourceCode: true,
      capturedAt: true,
      companySiret: true,
      companyName: true,
    },
  });

  if (triggers.length === 0) {
    return { scanned: 0, updated: 0, skipped: 0, topPriorityScore: null, multiSourceCompanies: 0 };
  }

  // Construit l'index sources distinctes par société (fenêtre 7j seulement)
  const sourcesByCompany = new Map<string, Set<string>>();
  for (const t of triggers) {
    if (t.capturedAt < windowStart) continue;
    const key = (t.companySiret || t.companyName).trim().toLowerCase();
    if (!key) continue;
    let set = sourcesByCompany.get(key);
    if (!set) {
      set = new Set<string>();
      sourcesByCompany.set(key, set);
    }
    set.add(t.sourceCode.trim().toLowerCase());
  }

  let updated = 0;
  let skipped = 0;
  let topPriorityScore: number | null = null;
  let multiSourceCompanies = 0;
  for (const set of sourcesByCompany.values()) {
    if (set.size >= 2) multiSourceCompanies++;
  }

  // Recompute + persist par batch
  for (const t of triggers) {
    const freshnessScore = computeFreshnessScore(t.capturedAt, now);
    const key = (t.companySiret || t.companyName).trim().toLowerCase();
    const sources = sourcesByCompany.get(key);
    const sourceList = sources ? Array.from(sources) : [t.sourceCode];
    const multiSourceBoost = computeMultiSourceBoost(sourceList);
    const priorityScore = computePriorityScore({
      score: t.score,
      freshnessScore,
      multiSourceBoost,
    });

    if (topPriorityScore === null || priorityScore > topPriorityScore) {
      topPriorityScore = priorityScore;
    }

    try {
      await db.trigger.update({
        where: { id: t.id },
        data: { freshnessScore, multiSourceBoost, priorityScore },
      });
      updated += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    scanned: triggers.length,
    updated,
    skipped,
    topPriorityScore,
    multiSourceCompanies,
  };
}
