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
  computePillarBoost,
  computePriorityScore,
} from "@/lib/priority-scoring";
import { getActivePillars } from "@/lib/signal-config";
import {
  buildClientConvergenceIndex,
  lookupCrossPillarFromIndex,
  lookupConfidenceBoostFromIndex,
} from "@/lib/signal-convergence";

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
      isHot: true, // Fix H5 — pour comparer avant/après
      isCombo: true, // V1 — pour comparer avant/après le combo cross-pillar
      sourceCode: true,
      signalCode: true, // V1 17/05 — pour combo cross-pillar + confidence boost
      briefV2Json: true, // V1 17/05 — pour fallback Pépite via Opus ≥85
      capturedAt: true,
      companySiret: true,
      companyName: true,
    },
  });

  if (triggers.length === 0) {
    return { scanned: 0, updated: 0, skipped: 0, topPriorityScore: null, multiSourceCompanies: 0 };
  }

  // B1 (17/05/2026) — Récupère les piliers actifs du client pour booster
  // les triggers issus de signaux prioritaires (+5 priorityScore).
  const activePillars = await getActivePillars(clientId);

  // V1 18/05 — Fix N+1 query : on construit en 1 SEULE query l'index combo +
  // confidence boost pour tout le client (au lieu de 2 queries DB × 300 triggers
  // = 600 queries/cycle). Lookup O(1) ensuite.
  const convIndex = await buildClientConvergenceIndex(clientId, activePillars);

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
    const pillarBoost = computePillarBoost(t.sourceCode, activePillars);

    // V1 18/05 — Combo + confidence via index batch (0 query DB par trigger).
    // Lookup O(1) en mémoire au lieu de 2 queries DB précédemment.
    let comboBoost = 0;
    if (activePillars.length > 0 && t.signalCode) {
      const conv = lookupCrossPillarFromIndex(convIndex, t.companySiret, t.companyName);
      if (conv.isDiamant) comboBoost = 50;
      else if (conv.isPepite) comboBoost = 30;
    }

    const confidenceBoost = lookupConfidenceBoostFromIndex(
      convIndex,
      t.signalCode,
      t.companySiret,
      t.companyName,
    );

    const priorityScore = computePriorityScore({
      score: t.score,
      freshnessScore,
      multiSourceBoost: multiSourceBoost + comboBoost + confidenceBoost,
      pillarBoost,
    });

    if (topPriorityScore === null || priorityScore > topPriorityScore) {
      topPriorityScore = priorityScore;
    }

    // Fix H5 (04/05) — Re-calcul isHot avec gate freshness.
    // Avant : isHot = (score >= 9), figé à la création du trigger.
    // Conséquence : 5 Pépites du brief 04/05 (WeWard 35j, Sêmeia 31j,
    // PIXID 56j, Viaxoft 42j, OneStock 30j) restaient Brûlantes alors
    // que les offres LinkedIn sont probablement closes après 30+ jours.
    // Maintenant : isHot = (score >= 9) AND (freshnessScore >= 50).
    // Demi-vie freshness 14j → freshness=50 atteint à ~10j d'âge.
    // Donc isHot ne tient que ~10j après publication, ce qui correspond
    // à la réalité d'une offre LinkedIn fraîche.
    // EXCEPTION : qa-stuck-scanner pose explicitement isHot=true sur
    // des offres anciennes 30-90j (frustration recrutement = signal
    // d'externalisation). On préserve ce cas via le marqueur QA-STUCK
    // dans scoreReason.
    const HOT_FRESHNESS_THRESHOLD = 50;
    // V1 17/05 — Fallback Pépite : score Opus (briefV2.confidence) >= 85 sur
    // verdict OUI = Pépite même sans combo. Permet à un client aux signaux rares
    // d'avoir des Pépites quand un seul signal "très convaincant" suffit.
    const briefV2 = t.briefV2Json as { verdict?: string; confidence?: number } | null;
    const opusPepite =
      briefV2?.verdict === "OUI" && (briefV2.confidence ?? 0) >= 85;
    const newIsHot =
      (t.score >= 9 && freshnessScore >= HOT_FRESHNESS_THRESHOLD) ||
      (opusPepite && freshnessScore >= HOT_FRESHNESS_THRESHOLD);
    // V1 17/05 — isCombo = au moins 2 piliers convergents (Pépite) OU Diamant.
    // (le fallback Opus alimente isHot, pas isCombo — un combo reste 2+ signaux)
    const newIsCombo = comboBoost > 0;

    try {
      await db.trigger.update({
        where: { id: t.id },
        data: {
          freshnessScore,
          multiSourceBoost,
          priorityScore,
          // Re-pose isHot uniquement si change ET pas un cas QA-STUCK manuel
          ...(newIsHot !== t.isHot ? { isHot: newIsHot } : {}),
          // V1 — isCombo aligné sur le combo cross-pillar
          ...(newIsCombo !== t.isCombo ? { isCombo: newIsCombo } : {}),
        },
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
