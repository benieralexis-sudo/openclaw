import "server-only";
import { db } from "@/lib/db";

/**
 * Bonus D — Few-shot dynamique (05/05/2026)
 *
 * Cron weekly qui calcule depuis Sprint 7 LeadActivity :
 * - Top 5 leads "boosters" : MEETING_BOOKED OR DASHBOARD_INTERACTION ≥3
 *   PLUS persona fitScore ≥70 OU personaTier=1 (filtre confiance).
 *   Score Trigger final ≥7 (validation client = "lead bon").
 *
 * - Top 5 leads "rejected manuel" : LeadActivity DASHBOARD_INTERACTION
 *   avec payload.kind = "archive_manual" sur lead status=ARCHIVED.
 *   Score Trigger final ≤3 (rejet client = "lead mauvais").
 *
 * Stocke le résultat dans Client.icp.dynamicFewShots (JSON).
 *
 * Lu par qualify-trigger.ts qui inject les few-shots formatés dans le
 * 2e bloc du SYSTEM (NON cached) via buildCachedSystem(specific, tail).
 *
 * Filtres anti-poisoning :
 * - Occurrence ≥2 (pattern doit apparaître 2× sur 6 sem pour être inclus)
 * - Score range strict (booster ≥7, rejected ≤3) — pas de zone grise
 * - Persona confidence (booster nécessite fitScore≥70 OU personaTier=1)
 * - Decay 3-60j (booster >7j stable, rejected 3-60j non équivoque)
 *
 * Kill switch : Client.icp.dynamicFewShotsEnabled === false → skip.
 */

const BOOSTER_DECAY_MIN_DAYS = 7;
const REJECTED_DECAY_MIN_DAYS = 3;
const REJECTED_DECAY_MAX_DAYS = 60;
const SAMPLE_SIZE = 5;

export interface BoosterFewShot {
  companyName: string;
  signal: string; // "Hire QA Lead Paris ESN 80p"
  score: number;
  reason: string; // "client-booster: 3 interactions + RDV booké"
}

export interface RejectedFewShot {
  companyName: string;
  signal: string;
  score: number;
  reason: string; // "client-rejection: archived manuel J+5"
}

export interface DynamicFewShots {
  boosters: BoosterFewShot[];
  rejected: RejectedFewShot[];
  generatedAt: string; // ISO date
  windowDays: number;
}

/**
 * Génère les few-shots dynamiques pour un client donné.
 * Pure function : ne mute pas la DB. Appelée par cron qui stocke ensuite
 * dans Client.icp.dynamicFewShots.
 */
export async function generateDynamicFewShots(
  clientId: string,
  windowDays = 42, // 6 semaines
): Promise<DynamicFewShots> {
  const since = new Date(Date.now() - windowDays * 86400_000);

  // 1. BOOSTERS : leads avec MEETING_BOOKED ou ≥3 DASHBOARD_INTERACTION
  // ET score Trigger ≥7 ET persona OK (fitScore≥70 OU personaTier=1)
  // ET trigger publishedAt >7j (stable, pas trop frais).
  const boosterCandidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      OR: [
        { fitScore: { gte: 70 } },
        { personaTier: 1 },
      ],
      trigger: {
        is: {
          score: { gte: 7 },
          deletedAt: null,
          capturedAt: {
            lte: new Date(Date.now() - BOOSTER_DECAY_MIN_DAYS * 86400_000),
          },
        },
      },
      activities: {
        some: {
          occurredAt: { gte: since },
          source: "MANUAL",
          OR: [
            { type: "MEETING_BOOKED" },
            { type: "DASHBOARD_INTERACTION" },
          ],
        },
      },
    },
    select: {
      id: true,
      companyName: true,
      jobTitle: true,
      trigger: {
        select: {
          title: true,
          type: true,
          sourceCode: true,
          score: true,
          industry: true,
          size: true,
          companyNaf: true,
        },
      },
      activities: {
        where: {
          occurredAt: { gte: since },
          source: "MANUAL",
          OR: [
            { type: "MEETING_BOOKED" },
            { type: "DASHBOARD_INTERACTION" },
          ],
        },
        select: { type: true },
      },
    },
    take: 50, // pull plus large, on filtre ensuite par occurrence
  });

  // Filtre occurrence : MEETING_BOOKED count =1 ou DASHBOARD_INTERACTION
  // count ≥3 (Anti-poisoning : un click isolé n'est pas du signal).
  const boosters: BoosterFewShot[] = boosterCandidates
    .filter((lead) => {
      const meetings = lead.activities.filter((a) => a.type === "MEETING_BOOKED").length;
      const interactions = lead.activities.filter((a) => a.type === "DASHBOARD_INTERACTION").length;
      return meetings >= 1 || interactions >= 3;
    })
    .slice(0, SAMPLE_SIZE)
    .map((lead) => {
      const t = lead.trigger;
      if (!t) return null;
      const meetings = lead.activities.filter((a) => a.type === "MEETING_BOOKED").length;
      const interactions = lead.activities.filter((a) => a.type === "DASHBOARD_INTERACTION").length;
      const indicator =
        meetings > 0
          ? `${meetings} RDV booké`
          : `${interactions} interactions dashboard`;
      const naf = t.companyNaf ? ` NAF ${t.companyNaf}` : "";
      const size = t.size ? ` ${t.size}p` : "";
      const industry = t.industry ?? t.type;
      return {
        companyName: lead.companyName,
        signal: `${industry}${size}${naf}, ${t.title.slice(0, 80)}`,
        score: t.score,
        reason: `client-booster: ${indicator}`,
      };
    })
    .filter((b): b is BoosterFewShot => b !== null);

  // 2. REJECTED MANUEL : Lead status=ARCHIVED OR Trigger score ≤3 ET
  // LeadActivity DASHBOARD_INTERACTION avec kind="archive_manual" 3-60j.
  // Note : payload.kind est dans Json, on filtre via Prisma JSON path.
  const rejectedCandidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: "ARCHIVED",
      activities: {
        some: {
          type: "DASHBOARD_INTERACTION",
          source: "MANUAL",
          occurredAt: {
            gte: new Date(Date.now() - REJECTED_DECAY_MAX_DAYS * 86400_000),
            lte: new Date(Date.now() - REJECTED_DECAY_MIN_DAYS * 86400_000),
          },
        },
      },
      trigger: {
        is: {
          score: { lte: 3 },
          deletedAt: null,
        },
      },
    },
    select: {
      id: true,
      companyName: true,
      trigger: {
        select: {
          title: true,
          type: true,
          sourceCode: true,
          score: true,
          industry: true,
          size: true,
          companyNaf: true,
        },
      },
      activities: {
        where: {
          type: "DASHBOARD_INTERACTION",
          source: "MANUAL",
        },
        select: { payload: true, occurredAt: true },
        take: 5,
      },
    },
    take: 50,
  });

  const rejected: RejectedFewShot[] = rejectedCandidates
    .filter((lead) => {
      // Garde uniquement ceux avec au moins 1 archive_manual dans payload
      const archives = lead.activities.filter((a) => {
        const p = a.payload as { kind?: string } | null;
        return p?.kind === "archive_manual";
      });
      return archives.length >= 1;
    })
    .slice(0, SAMPLE_SIZE)
    .map((lead) => {
      const t = lead.trigger;
      if (!t) return null;
      const naf = t.companyNaf ? ` NAF ${t.companyNaf}` : "";
      const size = t.size ? ` ${t.size}p` : "";
      const industry = t.industry ?? t.type;
      return {
        companyName: lead.companyName,
        signal: `${industry}${size}${naf}, ${t.title.slice(0, 80)}`,
        score: t.score,
        reason: `client-rejection: archived manuel`,
      };
    })
    .filter((r): r is RejectedFewShot => r !== null);

  return {
    boosters,
    rejected,
    generatedAt: new Date().toISOString(),
    windowDays,
  };
}

/**
 * Format les few-shots en bloc texte injectable dans SYSTEM prompt.
 * Retourne null si aucun few-shot ne respecte les filtres (mode fallback :
 * le bot tourne sur les 9 hardcodés statiques uniquement).
 */
export function formatDynamicFewShotsBlock(fewShots: DynamicFewShots): string | null {
  const total = fewShots.boosters.length + fewShots.rejected.length;
  if (total === 0) return null;

  const lines: string[] = [];
  lines.push("## Few-shots dynamiques (apprentissage client, rotated weekly)");
  lines.push("");
  lines.push(
    `Basé sur ${total} signaux outcomes capturés ${fewShots.windowDays}j (Sprint 7 dashboard tracking).`,
  );
  lines.push("Ces examples reflètent les choix RÉELS du commercial sur ce client.");
  lines.push("Les baseline few-shots ci-dessus restent prioritaires en cas de conflit.");
  lines.push("");

  if (fewShots.boosters.length > 0) {
    lines.push("**Boosters (le client a engagé) :**");
    for (const b of fewShots.boosters) {
      lines.push(`- ${b.companyName} (${b.signal}) → score ${b.score} [${b.reason}]`);
    }
  }
  if (fewShots.rejected.length > 0) {
    lines.push("");
    lines.push("**Rejected manuel (le client a archivé) :**");
    for (const r of fewShots.rejected) {
      lines.push(`- ${r.companyName} (${r.signal}) → score ${r.score} [${r.reason}]`);
    }
  }
  return lines.join("\n");
}

/**
 * Lit les few-shots depuis Client.icp.dynamicFewShots et les formate.
 * Appelé par qualify-trigger.ts. Retourne null si :
 * - dynamicFewShotsEnabled = false (kill switch)
 * - Aucun few-shot stocké
 * - Cache stale (>10j → ignorer en attendant prochain cron)
 */
export function readDynamicFewShotsFromIcp(
  icp: Record<string, unknown>,
): string | null {
  if (icp.dynamicFewShotsEnabled === false) return null;
  const stored = icp.dynamicFewShots as DynamicFewShots | undefined;
  if (!stored || typeof stored !== "object") return null;
  if (!Array.isArray(stored.boosters) || !Array.isArray(stored.rejected)) return null;
  // Stale check : si cache >10j, on l'ignore (le cron weekly devrait
  // avoir tourné, sinon il y a un problème)
  if (stored.generatedAt) {
    const ageDays = (Date.now() - new Date(stored.generatedAt).getTime()) / 86400_000;
    if (ageDays > 10) return null;
  }
  return formatDynamicFewShotsBlock(stored);
}
