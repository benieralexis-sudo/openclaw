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
 * Bouquet d'actors par préférence (audit 28/04 : 3-en-1 cassé, switch vers actors dédiés).
 * - linkedin-jobs-scraper : LinkedIn Jobs (curious_coder, leader 59K users — fix input urls/count 28/04)
 * - wttjJobs : WTTJ FR avec filtre companySize ICP-aware (clearpath, le seul WTTJ vivant)
 * - indeedJobs : Indeed FR (misceres, leader Apify 21K users 1.34M runs)
 * - linkedinCompanyPosts : declarative pain detection (harvestapi, 872K runs, $1.50/1k posts)
 */
export const APIFY_ACTORS = {
  franceJobs: "joyouscam35875/france-job-scraper", // ⚠️ deprecated — Hellowork/FT cassés
  linkedinJobs: "curious_coder/linkedin-jobs-scraper",
  wttjJobs: "clearpath/welcome-to-the-jungle-jobs-api",
  indeedJobs: "misceres/indeed-scraper",
  linkedinCompanyPosts: "harvestapi/linkedin-company-posts",
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
  // Schéma actor curious_coder/linkedin-jobs-scraper (28/04/2026)
  title?: string;
  companyName?: string;
  location?: string;
  postedAt?: string;
  link?: string;
  descriptionText?: string;
  applicantsCount?: number;
  country?: string;
  // Compat anciens champs
  jobTitle?: string;
  company?: string;
  jobUrl?: string;
  url?: string;
  jobDescription?: string;
  description?: string;
}

function adaptLinkedinJobItem(item: LinkedinJobItem): NormalizedJob | null {
  const title = item.title ?? item.jobTitle;
  const company = item.companyName ?? item.company;
  if (!title || !company) return null;
  // Filtre FR strict (l'actor remonte aussi PT/BE/etc.)
  if (item.country && item.country !== "FR" && item.country !== "France") return null;
  return {
    jobTitle: title,
    companyName: company,
    url: item.link ?? item.jobUrl ?? item.url,
    location: item.location,
    postedAt: item.postedAt,
    description: item.descriptionText ?? item.jobDescription ?? item.description,
    sourceUrl: item.link ?? item.jobUrl ?? item.url,
  };
}

// ── Adapter WTTJ (clearpath/welcome-to-the-jungle-jobs-api) ──
interface WttjJobItem {
  name?: string;
  url?: string;
  organization?: { name?: string; size?: string };
  office?: { city?: string; country_code?: string };
  contract_type?: string;
  description?: string;
  published_at?: string;
}

function adaptWttjItem(item: WttjJobItem): NormalizedJob | null {
  const title = item.name;
  const company = item.organization?.name;
  if (!title || !company) return null;
  if (item.office?.country_code && item.office.country_code !== "FR") return null;
  return {
    jobTitle: title,
    companyName: company,
    url: item.url,
    location: item.office?.city,
    postedAt: item.published_at,
    description: item.description?.slice(0, 600),
    sourceUrl: item.url,
  };
}

// ── Adapter Indeed (misceres/indeed-scraper) ──
interface IndeedJobItem {
  positionName?: string;
  company?: string;
  companyName?: string;
  location?: string;
  description?: string;
  url?: string;
  externalApplyLink?: string;
  postingDateParsed?: string;
  jobType?: string[];
}

function adaptIndeedItem(item: IndeedJobItem): NormalizedJob | null {
  const title = item.positionName;
  const company = item.companyName ?? item.company;
  if (!title || !company) return null;
  return {
    jobTitle: title,
    companyName: company,
    url: item.externalApplyLink ?? item.url,
    location: item.location,
    postedAt: item.postingDateParsed,
    description: item.description?.slice(0, 600),
    sourceUrl: item.externalApplyLink ?? item.url,
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
  options: {
    dryRun?: boolean;
    useFranceJobs?: boolean;
    useLinkedin?: boolean;
    useWttj?: boolean;
    useIndeed?: boolean;
  } = {},
): Promise<ApifyPollerResult> {
  const useFranceJobs = options.useFranceJobs ?? false; // 28/04 deprecated
  const useLinkedin = options.useLinkedin ?? true;
  const useWttj = options.useWttj ?? true;
  const useIndeed = options.useIndeed ?? true;

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
  // ⚠️ Actor `joyouscam35875/france-job-scraper` retourne 0 items depuis 28/04
  // (sites scrapés ont changé leur HTML/API, actor non maintenu).
  // Désactivé par défaut. Réactiver `useFranceJobs: true` quand actor patché
  // ou switch vers actor alternatif (apimaestro/linkedin-jobs ou clockworks).
  if (useFranceJobs) {
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.franceJobs,
      input: {
        // Test live 28/04 : 1 keyword OU multi-keywords → tous renvoient [].
        // Bug actor amont. On garde le code en place pour réactivation ultérieure.
        keywords: keywords[0] ?? "QA Engineer",
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

  // 2. LinkedIn Jobs (curious_coder/linkedin-jobs-scraper)
  // Schéma corrigé 28/04 : urls (array LinkedIn search URLs) + count >= 10
  // f_TPR=r604800 = "posted last week" (jobs frais 7j)
  if (useLinkedin) {
    const kw = keywords[0] ?? "QA Engineer";
    const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=France&f_TPR=r604800`;
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.linkedinJobs,
      input: {
        urls: [linkedinUrl],
        count: 30,
        scrapeCompany: false,
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

  // 3. WTTJ — clearpath/welcome-to-the-jungle-jobs-api
  // Filtre companySize ICP-aware : 50-250p (cible DTL Tech 11-200)
  if (useWttj) {
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.wttjJobs,
      input: {
        query: keywords[0] ?? "test logiciel",
        countryCode: "FR",
        companySize: "50-250",
        contractType: ["full_time"],
      },
      clientId,
      sourceCode: "apify.wttj-jobs",
      adapter: (item) => adaptWttjItem(item as WttjJobItem),
      antiCompanies,
      dryRun: options.dryRun,
    });
    result.actorRuns.push(r);
    result.totalTriggersCreated += r.triggersCreated;
  }

  // 4. Indeed FR — misceres/indeed-scraper
  if (useIndeed) {
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.indeedJobs,
      input: {
        position: keywords[0] ?? "QA Engineer",
        country: "FR",
        location: "France",
        maxItems: 30,
        parseCompanyDetails: false,
      },
      clientId,
      sourceCode: "apify.indeed-jobs",
      adapter: (item) => adaptIndeedItem(item as IndeedJobItem),
      antiCompanies,
      dryRun: options.dryRun,
    });
    result.actorRuns.push(r);
    result.totalTriggersCreated += r.triggersCreated;
  }

  return result;
}
