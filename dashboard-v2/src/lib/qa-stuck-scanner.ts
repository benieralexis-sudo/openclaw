import "server-only";

/**
 * Bougie 3 (04/05) — Détection des offres QA "stuck" : annonces de
 * recrutement Quality Assurance toujours ouvertes 30+ jours après
 * leur publication.
 *
 * Thèse : une offre QA qui reste ouverte >30j sans être pourvue =
 * frustration recrutement. Les éditeurs SaaS qui n'arrivent pas à
 * recruter en interne basculent vers l'externalisation. C'est le
 * meilleur moment pour les approcher avec une offre Digi Test Lab.
 *
 * Implémentation : boost en place du trigger existant (pas de nouveau
 * trigger pour éviter les doublons). Le scoreReason est préfixé d'un
 * marqueur [QA-STUCK Xj] pour idempotence + traçabilité.
 *
 * Cron : recommandé 1×/jour (source=cron run-pollers).
 */

import { db } from "@/lib/db";

const QA_STUCK_MARKER = "[QA-STUCK";

export interface QaStuckScanResult {
  clientId: string;
  scanned: number;
  boosted: number;
  alreadyBoosted: number;
  errors: number;
}

/**
 * Détecte si un titre de trigger correspond bien à une offre QA/test.
 * Conservateur — on évite de boost les "ingénieur méthodes test" qui
 * sont du test électronique/industriel, hors cible DTL.
 */
function isQaJobTitle(title: string): boolean {
  const lower = title.toLowerCase();
  // Patterns QA software clairs
  if (/\b(qa|sdet|test\s*lead|qa\s*lead|quality\s*assurance|assurance\s*qualit[eé])\b/i.test(title)) return true;
  if (/\btesteur\b/i.test(title)) return true;
  if (/\b(software\s+engineer\s+in\s+test|test\s+automation|automation\s+test)\b/i.test(title)) return true;
  if (/\b(qa\s+(engineer|automation|automaticien|automation engineer))\b/i.test(title)) return true;
  // Garde-fous : exclure ingé méthodes/électronique/etc
  if (/\b(m[eé]thode|[eé]lectroni|m[eé]canique|chimi|cvc|automaticien)\b/i.test(lower) && !lower.includes("qa")) return false;
  return false;
}

/**
 * Boost les triggers QA hiring dont publishedAt est dans [30j, 90j].
 * Skip ceux déjà boostés (marker dans scoreReason). Skip aussi ceux
 * dont le lead est archivé/contacted (déjà traité commercialement).
 */
export async function scanQaStuckForClient(
  clientId: string,
  options: { dryRun?: boolean; minDaysOld?: number; maxDaysOld?: number } = {},
): Promise<QaStuckScanResult> {
  const minDays = options.minDaysOld ?? 30;
  const maxDays = options.maxDaysOld ?? 90;

  const result: QaStuckScanResult = {
    clientId,
    scanned: 0,
    boosted: 0,
    alreadyBoosted: 0,
    errors: 0,
  };

  const now = new Date();
  const minPublishedAt = new Date(now.getTime() - maxDays * 24 * 3600 * 1000);
  const maxPublishedAt = new Date(now.getTime() - minDays * 24 * 3600 * 1000);

  const candidates = await db.trigger.findMany({
    where: {
      clientId,
      type: "HIRING_KEY",
      publishedAt: { gte: minPublishedAt, lte: maxPublishedAt },
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      score: true,
      scoreReason: true,
      publishedAt: true,
      companyName: true,
      sourceCode: true,
    },
  });

  for (const t of candidates) {
    if (!isQaJobTitle(t.title)) continue;
    result.scanned += 1;

    // Idempotence : skip si déjà boosté
    if (t.scoreReason?.includes(QA_STUCK_MARKER)) {
      result.alreadyBoosted += 1;
      continue;
    }

    // Skip si lead associé est déjà contacté/archivé
    const linkedLead = await db.lead.findFirst({
      where: { triggerId: t.id, deletedAt: null },
      select: { status: true },
    });
    if (linkedLead?.status === "CONTACTED" || linkedLead?.status === "NOT_INTERESTED" || linkedLead?.status === "ARCHIVED") {
      continue;
    }

    const daysOld = Math.floor((now.getTime() - (t.publishedAt?.getTime() ?? now.getTime())) / (24 * 3600 * 1000));
    const newReason = `${QA_STUCK_MARKER} ${daysOld}j] Offre QA toujours ouverte ${daysOld} jours après publication — frustration recrutement = bascule externalisation imminente. ${t.scoreReason ?? ""}`.slice(0, 500);

    if (options.dryRun) {
      result.boosted += 1;
      continue;
    }

    try {
      await db.trigger.update({
        where: { id: t.id },
        data: {
          score: Math.max(t.score, 9),
          isHot: true,
          scoreReason: newReason,
        },
      });
      result.boosted += 1;
    } catch {
      result.errors += 1;
    }
  }

  return result;
}
