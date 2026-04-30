import "server-only";
import { db } from "@/lib/db";
import { TriggerType, TriggerStatus } from "@prisma/client";

/**
 * Growth alert detector — boîtes pré-ICP qui scalent vite
 * ════════════════════════════════════════════════════════
 * Audit 30/04 soir : permet de détecter les boîtes qui sont JUSTE EN DESSOUS
 * du seuil ICP DigitestLab (Tech/SaaS/ESN 11-200p) mais qui montrent une
 * trajectoire de croissance forte (3+ hires en 60 jours).
 *
 * Stratégie :
 *   1. Compter les Triggers hiring (TheirStack jobs, Apify LinkedIn-jobs,
 *      Apify Indeed-jobs) sur la même boîte (companySiret) sur 60j.
 *   2. Si N >= 3 hires détectés ET la boîte est marquée "TPE" / "0-9 sal." /
 *      taille < 11p, on crée un Trigger sourceCode=growth-alert avec score 7.
 *   3. Ce Trigger devient éligible au pipeline d'enrichissement standard
 *      (HarvestAPI Profile Search, Kaspr, FullEnrich).
 *   4. Boost commercial : "boîte de 8 personnes qui hire 3 dev en 2 mois →
 *      contact maintenant = relation établie quand ils signent leur série A
 *      dans 6 mois".
 *
 * Plafond : 30 boîtes/run pour éviter inflation Triggers.
 * Dedup : on ne re-crée pas un growth-alert si déjà un sur 60j.
 */

const HIRING_SOURCES = [
  "theirstack.job-offer",
  "apify.linkedin-jobs",
  "apify.indeed-jobs",
  "apify.welcome-to-the-jungle",
  "trigger-engine.tech-hiring",
  "trigger-engine.qa-hiring",
  "francetravail.offre",
];

const MIN_HIRES_60D = 3;
const WINDOW_DAYS = 60;
const GROWTH_SCORE = 7;
const GROWTH_DEDUP_DAYS = 60;
const MAX_PER_RUN = 30;

// Patterns "petite boîte" = sous l'ICP DTL 11p mais qui scale
const SMALL_SIZE_PATTERNS = [
  "TPE",
  "0-9",
  "1-10",
  "2-10",
  "Micro",
  "0 à 9",
  "1 à 9",
];

function isSmallCompany(size: string | null | undefined): boolean {
  if (!size) return false;
  const s = size.toLowerCase();
  return SMALL_SIZE_PATTERNS.some((p) => s.includes(p.toLowerCase()));
}

interface GrowthAlertResult {
  scanned: number;
  alertsCreated: number;
  skipped: number;
  errors: number;
}

export async function detectGrowthAlertsForClient(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<GrowthAlertResult> {
  const limit = Math.min(opts.limit ?? MAX_PER_RUN, MAX_PER_RUN);
  const result: GrowthAlertResult = {
    scanned: 0,
    alertsCreated: 0,
    skipped: 0,
    errors: 0,
  };
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // 1. Group hire-related triggers par companySiret
  const hires = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      capturedAt: { gte: since },
      sourceCode: { in: HIRING_SOURCES },
      companySiret: { not: null },
    },
    select: {
      companySiret: true,
      companyName: true,
      size: true,
      industry: true,
      region: true,
      type: true,
    },
  });

  const groups = new Map<
    string,
    {
      companyName: string;
      size: string | null;
      industry: string | null;
      region: string | null;
      hireCount: number;
    }
  >();
  for (const h of hires) {
    if (!h.companySiret) continue;
    const existing = groups.get(h.companySiret);
    if (existing) {
      existing.hireCount++;
    } else {
      groups.set(h.companySiret, {
        companyName: h.companyName,
        size: h.size,
        industry: h.industry,
        region: h.region,
        hireCount: 1,
      });
    }
  }

  // 2. Filtrer : ≥3 hires + petite boîte
  const candidates = Array.from(groups.entries())
    .filter(([, g]) => g.hireCount >= MIN_HIRES_60D && isSmallCompany(g.size))
    .slice(0, limit);

  result.scanned = candidates.length;

  // 3. Dedup : skip si growth-alert déjà créé sur cette boîte <60j
  const dedupSince = new Date(Date.now() - GROWTH_DEDUP_DAYS * 24 * 60 * 60 * 1000);
  const existingAlerts = candidates.length
    ? await db.trigger.findMany({
        where: {
          clientId,
          sourceCode: "growth-alert",
          companySiret: { in: candidates.map(([siret]) => siret) },
          deletedAt: null,
          capturedAt: { gte: dedupSince },
        },
        select: { companySiret: true },
      })
    : [];
  const alreadyAlerted = new Set(existingAlerts.map((a) => a.companySiret));

  // 4. Créer les Triggers growth-alert
  for (const [siret, group] of candidates) {
    if (alreadyAlerted.has(siret)) {
      result.skipped++;
      continue;
    }
    try {
      await db.trigger.create({
        data: {
          clientId,
          companyName: group.companyName,
          companySiret: siret,
          industry: group.industry,
          region: group.region,
          size: group.size,
          sourceCode: "growth-alert",
          sourceUrl: `internal://growth-alert/${siret}`,
          type: TriggerType.HIRING_KEY,
          status: TriggerStatus.NEW,
          title: `Growth alert : ${group.hireCount} recrutements en ${WINDOW_DAYS}j`,
          detail: `Boîte ${group.size ?? "?"} qui scale vite — ${group.hireCount} hires détectés sur ${WINDOW_DAYS}j. Pré-ICP mais trajectoire forte → contact maintenant pour relation établie quand ils franchissent le seuil ICP.`,
          score: GROWTH_SCORE,
          scoreReason: `Growth alert auto : ${group.hireCount} hires en ${WINDOW_DAYS}j sur boîte ${group.size ?? "?"}`,
          isHot: false,
          isCombo: true, // multi-source de fait
          rawPayload: {
            growthAlert: {
              hireCount: group.hireCount,
              windowDays: WINDOW_DAYS,
              detectedAt: new Date().toISOString(),
            },
          },
        },
      });
      result.alertsCreated++;
    } catch (e) {
      result.errors++;
      console.warn(
        `[growth-detector] failed to create alert for ${siret}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return result;
}
