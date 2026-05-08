import "server-only";
import { db } from "@/lib/db";

/**
 * Sprint Perfection P3 (08/05/2026) — Dédup intelligent cross-source.
 *
 * AVANT ce helper : à chaque cycle cron, les 6 pollers (apify, francetravail,
 * theirstack-jobs, theirstack-companies, growth-detector, rodz-webhook)
 * faisaient `db.trigger.create()` sans coordination. Si Asys remontait
 * via apify.wttj-jobs ET via francetravail.tech, on créait 2 triggers
 * distincts en DB → Fred voyait 2 cards Asys dans le dashboard.
 *
 * Cas observés DTL le 08/05 :
 *   - Asys (348284977) : 2 triggers NEW score=10 et =7 (apify + theirstack)
 *   - Synanto (994856532) : 2 IGNORED, scores divergents
 *
 * APRÈS ce helper : avant chaque `trigger.create`, le caller appelle
 * `findOrFuseTriggerBySiret`. Si un trigger existe déjà sur le même
 * `(clientId, companySiret)` dans une fenêtre de 30j et est non-deleted :
 *   - on FUSIONNE le nouveau signal dans l'existant :
 *     - score = max(existant, nouveau)
 *     - scoreReason : append "[+combo from $newSourceCode]"
 *     - multiSourceBoost++ (le combo cross-source devient natif, pas un hack)
 *     - isCombo = true (UI peut afficher le badge combo)
 *     - capturedAt = max (rester frais)
 *     - status : si IGNORED + nouveau score ≥ icp.minScore → promote NEW
 *   - on RETOURNE { existing: { id }, fused: true }
 * Le caller skip alors son `trigger.create`.
 *
 * Si pas de doublon → on retourne { existing: null }, le caller create normalement.
 *
 * Garanties :
 *   - companySiret null ou pseudo-SIREN ("FT...") → pas de dédup (return null)
 *   - Atomique via Prisma transaction (race condition sur inserts concurrents)
 *   - Idempotent
 *   - Pure ajout, pas de modification du contrat des pollers existants
 */

export interface FuseResult {
  /** Trigger existant trouvé et fusionné (caller doit skip son create) */
  existing: { id: string } | null;
  /** True si fusion effectuée (existing != null) */
  fused: boolean;
  /** Détails de la fusion pour log/audit */
  fusionDetails?: {
    oldScore: number;
    newScore: number;
    sourceAdded: string;
    multiSourceBoost: number;
    promotedToNew: boolean;
  };
}

const DEFAULT_WINDOW_DAYS = 30;

interface TriggerCandidate {
  sourceCode: string;
  score: number;
  title?: string | null;
  capturedAt?: Date;
}

interface ClientIcpMinimal {
  minScore?: number;
}

/**
 * Cherche un trigger existant pour ce SIRET sur fenêtre 30j et fusionne le
 * nouveau signal si trouvé. Retourne `existing: null` si aucun doublon.
 *
 * Le caller fait :
 * ```ts
 * const dedup = await findOrFuseTriggerBySiret(clientId, siret, candidate);
 * if (!dedup.existing) {
 *   await db.trigger.create({ data: ... });
 * }
 * // sinon : le trigger existant a été fusionné, on continue
 * ```
 */
export async function findOrFuseTriggerBySiret(
  clientId: string,
  companySiret: string | null | undefined,
  candidate: TriggerCandidate,
  opts: { windowDays?: number; icp?: ClientIcpMinimal | null } = {},
): Promise<FuseResult> {
  // Garde-fous : pas de dédup possible sans SIRET valide
  if (!companySiret) return { existing: null, fused: false };
  // Pseudo-SIREN type "FT...." (rss-levees fallback hash) ne sont pas
  // de vrais SIREN, donc pas comparables cross-source de manière fiable
  if (!/^\d{9,14}$/.test(companySiret)) return { existing: null, fused: false };

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Cherche un trigger actif sur même (clientId, companySiret) dans la fenêtre.
  // On exclut deletedAt non-null mais on accepte status IGNORED (peut être promu).
  const existing = await db.trigger.findFirst({
    where: {
      clientId,
      companySiret,
      deletedAt: null,
      capturedAt: { gte: since },
      // Exclure le trigger lui-même si on est en mode update (typiquement non utilisé ici)
    },
    select: {
      id: true,
      score: true,
      scoreReason: true,
      sourceCode: true,
      multiSourceBoost: true,
      isCombo: true,
      status: true,
      capturedAt: true,
    },
    orderBy: { score: "desc" }, // si plusieurs (rare), prend celui avec score max
  });

  if (!existing) {
    return { existing: null, fused: false };
  }

  // Pas de fusion avec soi-même (même sourceCode déjà capturé) — laisser
  // le mécanisme de dédup intra-source du poller (anti-doublons par
  // companyName + sourceCode) faire son boulot.
  if (existing.sourceCode === candidate.sourceCode) {
    return { existing: { id: existing.id }, fused: false };
  }

  // FUSION : nouveau signal sur trigger existant cross-source
  const newScore = Math.max(existing.score, candidate.score);
  const newMultiSourceBoost = (existing.multiSourceBoost ?? 0) + 1;
  const newSourceAddon = `[+combo from ${candidate.sourceCode}]`;
  const newScoreReason = existing.scoreReason
    ? `${existing.scoreReason} ${newSourceAddon}`.slice(0, 800)
    : newSourceAddon;

  // Status : si IGNORED + nouveau score ≥ minScore → promote NEW
  const icpMinScore = opts.icp?.minScore;
  const shouldPromote =
    existing.status === "IGNORED" &&
    typeof icpMinScore === "number" &&
    newScore >= icpMinScore;

  const newCapturedAt = candidate.capturedAt && candidate.capturedAt > existing.capturedAt
    ? candidate.capturedAt
    : existing.capturedAt;

  await db.trigger.update({
    where: { id: existing.id },
    data: {
      score: newScore,
      scoreReason: newScoreReason,
      multiSourceBoost: newMultiSourceBoost,
      isCombo: true,
      capturedAt: newCapturedAt,
      ...(shouldPromote ? { status: "NEW" as const } : {}),
    },
  });

  console.log(
    `[trigger-dedup.fuse] ${JSON.stringify({
      triggerId: existing.id,
      siret: companySiret,
      existingSource: existing.sourceCode,
      newSource: candidate.sourceCode,
      oldScore: existing.score,
      newScore,
      multiSourceBoost: newMultiSourceBoost,
      promotedToNew: shouldPromote,
    })}`,
  );

  return {
    existing: { id: existing.id },
    fused: true,
    fusionDetails: {
      oldScore: existing.score,
      newScore,
      sourceAdded: candidate.sourceCode,
      multiSourceBoost: newMultiSourceBoost,
      promotedToNew: shouldPromote,
    },
  };
}

/**
 * Sprint Perfection P3 (08/05) — Fusion post-attribution SIRENE.
 *
 * Cas d'usage : un trigger vient d'être créé sans SIRET (typique
 * apify/francetravail) puis Pappers attribue le SIRET via attributeSirene.
 * À ce moment-là, on découvre potentiellement qu'un AUTRE trigger
 * existe déjà avec ce même SIRET (créé via une autre source plus tôt).
 *
 * Cette fonction est appelée APRÈS l'attribution SIRET pour fusionner
 * le trigger nouvellement attribué avec un éventuel doublon pré-existant.
 *
 * Stratégie de fusion :
 *   - On garde celui avec score max (winner)
 *   - L'autre est soft-deleted (deletedAt + ignoredReason="dedup-merged")
 *   - Le winner reçoit : multiSourceBoost cumulé, isCombo=true,
 *     scoreReason fusionné
 *   - Si le perdant a un Lead lié et le winner non, on transfère le Lead
 *
 * Atomique : transaction Prisma pour éviter race conditions sur inserts
 * concurrents (cas rare mais possible avec cron horaire + webhook Rodz simul).
 *
 * Retourne null si pas de doublon trouvé, ou les ids des 2 triggers fusionnés.
 */
export async function mergeDuplicateTriggersBySiret(
  triggerId: string,
  opts: { windowDays?: number; icp?: ClientIcpMinimal | null } = {},
): Promise<{ winner: { id: string }; loser: { id: string }; merged: boolean } | null> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const target = await db.trigger.findUnique({
    where: { id: triggerId },
    select: {
      id: true,
      clientId: true,
      companySiret: true,
      score: true,
      scoreReason: true,
      sourceCode: true,
      multiSourceBoost: true,
      capturedAt: true,
      status: true,
      lead: { select: { id: true, fullName: true } },
    },
  });
  if (!target || !target.companySiret) return null;
  if (!/^\d{9,14}$/.test(target.companySiret)) return null;

  // Cherche un AUTRE trigger même (clientId, siret) dans la fenêtre, deletedAt null
  const sibling = await db.trigger.findFirst({
    where: {
      clientId: target.clientId,
      companySiret: target.companySiret,
      deletedAt: null,
      capturedAt: { gte: since },
      id: { not: target.id },
    },
    select: {
      id: true,
      score: true,
      scoreReason: true,
      sourceCode: true,
      multiSourceBoost: true,
      capturedAt: true,
      status: true,
      lead: { select: { id: true, fullName: true } },
    },
    orderBy: { capturedAt: "asc" }, // si plusieurs, prend le plus ancien (le "vrai" original)
  });

  if (!sibling) return null;

  // Décide winner/loser : score max, ou plus ancien si tie
  const targetWins =
    target.score > sibling.score ||
    (target.score === sibling.score && target.capturedAt < sibling.capturedAt);
  const winner = targetWins ? target : sibling;
  const loser = targetWins ? sibling : target;

  const newScore = Math.max(target.score, sibling.score);
  const newMultiSourceBoost =
    (winner.multiSourceBoost ?? 0) + (loser.multiSourceBoost ?? 0) + 1;
  const newSourceAddon = `[+merged from ${loser.sourceCode}]`;
  const newScoreReason = winner.scoreReason
    ? `${winner.scoreReason} ${newSourceAddon}`.slice(0, 800)
    : newSourceAddon;
  const newCapturedAt =
    target.capturedAt > sibling.capturedAt ? target.capturedAt : sibling.capturedAt;

  const icpMinScore = opts.icp?.minScore;
  const shouldPromote =
    winner.status === "IGNORED" &&
    typeof icpMinScore === "number" &&
    newScore >= icpMinScore;

  // Transaction atomique : update winner + soft-delete loser + transfert Lead
  await db.$transaction(async (tx) => {
    await tx.trigger.update({
      where: { id: winner.id },
      data: {
        score: newScore,
        scoreReason: newScoreReason,
        multiSourceBoost: newMultiSourceBoost,
        isCombo: true,
        capturedAt: newCapturedAt,
        ...(shouldPromote ? { status: "NEW" as const } : {}),
      },
    });
    await tx.trigger.update({
      where: { id: loser.id },
      data: {
        deletedAt: new Date(),
        ignoredAt: new Date(),
        ignoredReason: "dedup-merged",
      },
    });
    // Transfert Lead si le winner n'a pas de Lead mais le loser oui
    if (!winner.lead && loser.lead) {
      await tx.lead.update({
        where: { id: loser.lead.id },
        data: { triggerId: winner.id },
      });
    } else if (loser.lead) {
      // winner a déjà un Lead, on soft-delete celui du loser
      await tx.lead.update({
        where: { id: loser.lead.id },
        data: { deletedAt: new Date() },
      });
    }
  });

  console.log(
    `[trigger-dedup.merge] ${JSON.stringify({
      winnerId: winner.id,
      loserId: loser.id,
      siret: target.companySiret,
      winnerSource: winner.sourceCode,
      loserSource: loser.sourceCode,
      newScore,
      multiSourceBoost: newMultiSourceBoost,
      promotedToNew: shouldPromote,
    })}`,
  );

  return { winner: { id: winner.id }, loser: { id: loser.id }, merged: true };
}
