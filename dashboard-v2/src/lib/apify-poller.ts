import "server-only";

/**
 * Phase 3.C — Poller Apify pour un client donné.
 *
 * Lance des Actors Apify ciblés sur l'ICP du client (LinkedIn jobs,
 * Welcome to the Jungle, Hellowork) et pousse les résultats en DB
 * Trigger.
 *
 * À lancer en cron hebdomadaire (1×/sem suffit, complète Rodz +
 * TheirStack).
 *
 * Coûts : compute units variable selon l'actor. Plan Starter = 145 CU
 * par mois inclus (~30-50 runs typiques).
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { runAndGetItems } from "@/lib/apify";

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  preferredSignals?: string[];
  antiPersonas?: string[];
  personaTitles?: string[];
  keywordsHiring?: string[];
}

export interface ApifyPollerResult {
  clientId: string;
  actorRuns: Array<{
    actor: string;
    runId: string;
    itemsFound: number;
    triggersCreated: number;
    skipped: number;
    error?: string;
    computeUnits?: number;
  }>;
  totalTriggersCreated: number;
}

// ──────────────────────────────────────────────────────────────────────
// Actors recommandés pour DigitestLab (et clients FR)
// ──────────────────────────────────────────────────────────────────────

/**
 * Bouquet d'actors par préférence.
 * - france-job-scraper : 3-en-1 FR (WTTJ + France Travail + Hellowork)
 * - linkedin-jobs-scraper : LinkedIn Jobs (international)
 * - welcome-to-the-jungle-jobs-api : WTTJ FR pur
 */
export const APIFY_ACTORS = {
  franceJobs: "joyouscam35875/france-job-scraper",
  linkedinJobs: "curious_coder/linkedin-jobs-scraper",
  wttjJobs: "clearpath/welcome-to-the-jungle-jobs-api",
} as const;

// ──────────────────────────────────────────────────────────────────────
// Anti-doublons
// ──────────────────────────────────────────────────────────────────────

async function isAlreadyCaptured(
  clientId: string,
  companyName: string,
  sourceCode: string,
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const existing = await db.trigger.findFirst({
    where: {
      clientId,
      companyName,
      sourceCode,
      deletedAt: null,
      capturedAt: { gte: since },
    },
    select: { id: true },
  });
  return !!existing;
}

// ──────────────────────────────────────────────────────────────────────
// Mapping résultat actor → Trigger
// ──────────────────────────────────────────────────────────────────────

interface NormalizedJob {
  jobTitle: string;
  companyName: string;
  url?: string;
  location?: string;
  postedAt?: string;
  description?: string;
  sourceUrl?: string;
}

function jobToTrigger(
  job: NormalizedJob,
  clientId: string,
  sourceCode: string,
): Prisma.TriggerCreateInput {
  // Score : keyword match QA/Test = boost
  const titleLower = job.jobTitle.toLowerCase();
  const isQa =
    titleLower.includes("qa") ||
    titleLower.includes("test") ||
    titleLower.includes("quality");
  let score = 6;
  if (isQa) score = 8;
  // Senior level boost
  if (titleLower.includes("senior") || titleLower.includes("head") || titleLower.includes("lead"))
    score = Math.min(10, score + 1);

  return {
    client: { connect: { id: clientId } },
    sourceCode,
    sourceUrl: job.sourceUrl ?? job.url ?? null,
    capturedAt: new Date(),
    publishedAt: job.postedAt ? new Date(job.postedAt) : null,
    companyName: job.companyName,
    industry: null,
    region: job.location ?? null,
    type: TriggerType.HIRING_KEY,
    title: `${job.jobTitle}${isQa ? " (QA match)" : ""}`,
    detail: job.description?.slice(0, 600) ?? null,
    rawPayload: job as unknown as Prisma.InputJsonValue,
    score,
    isHot: score >= 9,
    isCombo: false,
    status: TriggerStatus.NEW,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Adapters par actor (chaque actor a son propre format de retour)
// ──────────────────────────────────────────────────────────────────────

interface FranceJobItem {
  title?: string;
  company?: string;
  url?: string;
  location?: string;
  publishedAt?: string;
  description?: string;
  source?: string;
}

function adaptFranceJobItem(item: FranceJobItem): NormalizedJob | null {
  if (!item.title || !item.company) return null;
  return {
    jobTitle: item.title,
    companyName: item.company,
    url: item.url,
    location: item.location,
    postedAt: item.publishedAt,
    description: item.description,
    sourceUrl: item.url,
  };
}

interface LinkedinJobItem {
  jobTitle?: string;
  title?: string;
  companyName?: string;
  company?: string;
  jobUrl?: string;
  url?: string;
  location?: string;
  postedAt?: string;
  postedTimeAgo?: string;
  jobDescription?: string;
  description?: string;
}

function adaptLinkedinJobItem(item: LinkedinJobItem): NormalizedJob | null {
  const title = item.jobTitle ?? item.title;
  const company = item.companyName ?? item.company;
  if (!title || !company) return null;
  return {
    jobTitle: title,
    companyName: company,
    url: item.jobUrl ?? item.url,
    location: item.location,
    postedAt: item.postedAt,
    description: item.jobDescription ?? item.description,
    sourceUrl: item.jobUrl ?? item.url,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Run + push triggers
// ──────────────────────────────────────────────────────────────────────

async function runActorAndPushTriggers(args: {
  actor: string;
  input: Record<string, unknown>;
  clientId: string;
  sourceCode: string;
  adapter: (item: unknown) => NormalizedJob | null;
  antiCompanies: string[];
  dryRun?: boolean;
}): Promise<ApifyPollerResult["actorRuns"][number]> {
  const start = {
    actor: args.actor,
    runId: "",
    itemsFound: 0,
    triggersCreated: 0,
    skipped: 0,
  } as ApifyPollerResult["actorRuns"][number];

  try {
    const { run, items } = await runAndGetItems<Record<string, unknown>>(
      args.actor,
      args.input,
      { itemsLimit: 100, timeout: 180 }, // 3 min max
    );
    start.runId = run?.id ?? "(sync)";
    start.computeUnits = run?.stats?.computeUnits;
    start.itemsFound = items.length;

    for (const raw of items) {
      const job = args.adapter(raw);
      if (!job) {
        start.skipped += 1;
        continue;
      }
      // Anti-personas
      if (args.antiCompanies.some((a) => job.companyName.toLowerCase().includes(a))) {
        start.skipped += 1;
        continue;
      }
      // Anti-doublons
      if (await isAlreadyCaptured(args.clientId, job.companyName, args.sourceCode)) {
        start.skipped += 1;
        continue;
      }
      if (args.dryRun) {
        start.triggersCreated += 1;
        continue;
      }
      try {
        await db.trigger.create({
          data: jobToTrigger(job, args.clientId, args.sourceCode),
        });
        start.triggersCreated += 1;
      } catch (e) {
        start.skipped += 1;
        console.warn(`[apify-poller] trigger create failed: ${e}`);
      }
    }
  } catch (e) {
    start.error = e instanceof Error ? e.message : String(e);
  }

  return start;
}

// ──────────────────────────────────────────────────────────────────────
// Poller principal
// ──────────────────────────────────────────────────────────────────────

export async function pollApifyForClient(
  clientId: string,
  options: { dryRun?: boolean; useFranceJobs?: boolean; useLinkedin?: boolean } = {},
): Promise<ApifyPollerResult> {
  const useFranceJobs = options.useFranceJobs ?? true;
  const useLinkedin = options.useLinkedin ?? false; // par défaut OFF, plus cher

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  const icp = client.icp as ClientIcpExtended;
  const keywords = icp.keywordsHiring ?? [];
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());
  const result: ApifyPollerResult = {
    clientId,
    actorRuns: [],
    totalTriggersCreated: 0,
  };

  if (keywords.length === 0) {
    return result;
  }

  // 1. France Jobs Scraper (WTTJ + France Travail + Hellowork)
  if (useFranceJobs) {
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.franceJobs,
      input: {
        keywords: keywords.join(", "),
        location: "France",
        maxResults: 50,
      },
      clientId,
      sourceCode: "apify.france-jobs",
      adapter: (item) => adaptFranceJobItem(item as FranceJobItem),
      antiCompanies,
      dryRun: options.dryRun,
    });
    result.actorRuns.push(r);
    result.totalTriggersCreated += r.triggersCreated;
  }

  // 2. LinkedIn Jobs (optionnel — plus cher)
  if (useLinkedin) {
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.linkedinJobs,
      input: {
        searchTerm: keywords[0] ?? "QA",
        location: "France",
        rows: 30,
      },
      clientId,
      sourceCode: "apify.linkedin-jobs",
      adapter: (item) => adaptLinkedinJobItem(item as LinkedinJobItem),
      antiCompanies,
      dryRun: options.dryRun,
    });
    result.actorRuns.push(r);
    result.totalTriggersCreated += r.triggersCreated;
  }

  return result;
}
