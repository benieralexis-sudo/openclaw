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
// Filtre boîtes étrangères / agrégateurs / agences (centralisé)
// ──────────────────────────────────────────────────────────────────────

const FOREIGN_LEGAL_RE = /\b(GmbH|LLC|Ltd|Inc|Corp|Pty|S\.r\.l\.|S\.A\.R\.L\. España|UAB|s\.r\.o\.|AB|Oy|BV|N\.V\.|GmbH & Co|KG|spol\. s r\.o\.|d\.o\.o\.)\b/i;
const FOREIGN_BIG_NAMES_RE = /\b(Berkeley\s+Payments|Stott\s+and\s+May|Apple|Google|Microsoft|Amazon|Meta\s+Platforms)\b/i;
const AGGREGATOR_PREFIX_RE = /^(jobs\s+via\s+|jobs\s+at\s+)/i;
// Élargi 29/04 : "Recruitment" suffit (Gentis Recruitment SAS, Kali Group...)
const AGENCY_RE = /\b(recruitment(\s+agency)?|staffing|recruiter|talent\s+acquisition|cabinet\s+de\s+recrutement|RH(\s|$)|consulting\s+rh)\b/i;
// Hors ICP DigitestLab (Tech/SaaS+ESN 11-200p) : ESN majeurs >200p,
// grosses corp non-tech (pharma, retail, industrie lourde, agro).
// Audit DB 29/04 : Sanofi 7×, Sword Group/Astek/Capgemini/Atos/Scalian/Hutchinson/
// Avril/E.Leclerc/SEGULA pollutent les pépites Indeed/LinkedIn.
const LARGE_FR_CORPS_RE = /\b(Sanofi|Sword\s+Group|Astek|Capgemini|Atos|Sopra(\s+Steria)?|Accenture|Scalian|SEGULA(\s+Technologies)?|Technology\s+(&|and)\s+Strategy|Alten|Davidson(\s+consulting)?|Akkodis|Inetum|Cegedim|Cegid|Bouygues|Vinci|Thales|Airbus|Safran|Dassault|Renault|Peugeot|Stellantis|Hutchinson|Avril|E\.?\s*Leclerc|Carrefour|Auchan|Decathlon|Total(\s*Energies)?|EDF|Engie|Orange|SFR|Free|BNP\s+Paribas|Cr[ée]dit\s+Agricole|Soci[ée]t[ée]\s+G[ée]n[ée]rale|AXA|Allianz|Generali|La\s+Poste|SNCF|RATP|L'?Or[ée]al|Danone|Pernod\s+Ricard|LVMH|Kering|Hermes|Michelin|BIC)\b/i;

/**
 * Retourne false si le nom de boîte évoque une entité étrangère, un
 * agrégateur de jobs (jobs via X), une agence de recrutement, ou un
 * grand groupe FR hors ICP (>200p, pharma/retail/industrie lourde).
 * Centralisé pour les 3 adapters Apify — pattern aligné avec theirstack-poller.
 */
function isFrenchCompany(name: string | undefined): boolean {
  if (!name) return false;
  if (FOREIGN_LEGAL_RE.test(name)) return false;
  if (FOREIGN_BIG_NAMES_RE.test(name)) return false;
  if (AGGREGATOR_PREFIX_RE.test(name)) return false;
  if (AGENCY_RE.test(name)) return false;
  if (LARGE_FR_CORPS_RE.test(name)) return false;
  return true;
}

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

/**
 * Vérifie si une annonce HIRING pour cette boîte a déjà été captée par
 * UNE QUELCONQUE source jobs (Apify/TheirStack) dans les 30 derniers jours.
 * Évite la duplication "Asys via apify.linkedin-jobs + theirstack.job-offer".
 * Les sources non-HIRING (Rodz fundraising, BODACC capital_increase) sont
 * EXEMPTÉES — leur signal d'événement est unique et doit toujours être capté.
 */
async function isHiringAlreadyCapturedCrossSource(
  clientId: string,
  companyName: string,
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const existing = await db.trigger.findFirst({
    where: {
      clientId,
      companyName,
      type: "HIRING_KEY",
      deletedAt: null,
      capturedAt: { gte: since },
      OR: [
        { sourceCode: { startsWith: "apify." } },
        { sourceCode: { startsWith: "theirstack.job-offer" } },
      ],
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
  // Poster / hiring manager extrait de l'annonce — alimente Lead.linkedinUrl
  // quand présent (gratuit, ~30% des annonces LinkedIn). Si absent, Pappers
  // dirigeant prend le relais.
  posterFullName?: string;
  posterFirstName?: string;
  posterLastName?: string;
  posterLinkedinUrl?: string;
  posterTitle?: string;
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
  // Poster / hiring manager (présent dans ~30% des annonces LinkedIn)
  posterFullName?: string;
  posterProfileUrl?: string;
  posterTitle?: string;
  posterName?: string;
  posterLinkedinUrl?: string;
  recruiter?: {
    name?: string;
    linkedinUrl?: string;
    profileUrl?: string;
    position?: string;
    title?: string;
  };
  poster?: {
    fullName?: string;
    name?: string;
    profileUrl?: string;
    linkedinUrl?: string;
    title?: string;
    position?: string;
  };
}

function splitName(full: string | undefined): { firstName?: string; lastName?: string } {
  if (!full) return {};
  const cleaned = full.trim().replace(/\s+/g, " ");
  if (!cleaned) return {};
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function adaptLinkedinJobItem(item: LinkedinJobItem): NormalizedJob | null {
  const title = item.title ?? item.jobTitle;
  const company = item.companyName ?? item.company;
  if (!title || !company) return null;
  // Filtre FR strict (l'actor remonte aussi PT/BE/etc.)
  if (item.country && item.country !== "FR" && item.country !== "France") return null;

  const posterFullName =
    item.posterFullName ??
    item.posterName ??
    item.poster?.fullName ??
    item.poster?.name ??
    item.recruiter?.name;
  const posterUrl =
    item.posterProfileUrl ??
    item.posterLinkedinUrl ??
    item.poster?.profileUrl ??
    item.poster?.linkedinUrl ??
    item.recruiter?.linkedinUrl ??
    item.recruiter?.profileUrl;
  const posterTitle =
    item.posterTitle ??
    item.poster?.title ??
    item.poster?.position ??
    item.recruiter?.title ??
    item.recruiter?.position;
  const { firstName, lastName } = splitName(posterFullName);

  return {
    jobTitle: title,
    companyName: company,
    url: item.link ?? item.jobUrl ?? item.url,
    location: item.location,
    postedAt: item.postedAt,
    description: item.descriptionText ?? item.jobDescription ?? item.description,
    sourceUrl: item.link ?? item.jobUrl ?? item.url,
    posterFullName,
    posterFirstName: firstName,
    posterLastName: lastName,
    posterLinkedinUrl: posterUrl && /linkedin\.com/i.test(posterUrl) ? posterUrl : undefined,
    posterTitle,
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
  // WTTJ expose parfois le recruiter / hiring manager
  recruiter?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    linkedin_url?: string;
    title?: string;
  };
  contact?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    linkedin_url?: string;
    title?: string;
  };
}

function adaptWttjItem(item: WttjJobItem): NormalizedJob | null {
  const title = item.name;
  const company = item.organization?.name;
  if (!title || !company) return null;
  if (item.office?.country_code && item.office.country_code !== "FR") return null;

  const r = item.recruiter ?? item.contact;
  const composedName = [r?.first_name, r?.last_name].filter(Boolean).join(" ").trim();
  const posterFullName = r?.full_name ?? (composedName.length > 0 ? composedName : undefined);
  const { firstName, lastName } = splitName(posterFullName);

  return {
    jobTitle: title,
    companyName: company,
    url: item.url,
    location: item.office?.city,
    postedAt: item.published_at,
    description: item.description?.slice(0, 600),
    sourceUrl: item.url,
    posterFullName,
    posterFirstName: r?.first_name ?? firstName,
    posterLastName: r?.last_name ?? lastName,
    posterLinkedinUrl: r?.linkedin_url && /linkedin\.com/i.test(r.linkedin_url) ? r.linkedin_url : undefined,
    posterTitle: r?.title,
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

// Normalise sourceUrl Indeed pour dedup : keep uniquement le job key (jk=...)
// L'URL applystart contient des params tracking (mobvjtk, astse, assa, ...)
// qui changent à chaque scrape → 7× la même offre Sanofi en DB. Fix 29/04.
function normalizeIndeedUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/[?&]jk=([a-f0-9]+)/i);
  if (m) return `https://fr.indeed.com/viewjob?jk=${m[1]}`;
  return url;
}

function adaptIndeedItem(item: IndeedJobItem): NormalizedJob | null {
  const title = item.positionName;
  const company = item.companyName ?? item.company;
  if (!title || !company) return null;
  const rawUrl = item.externalApplyLink ?? item.url;
  const normalized = normalizeIndeedUrl(rawUrl);
  return {
    jobTitle: title,
    companyName: company,
    url: normalized ?? rawUrl,
    location: item.location,
    postedAt: item.postingDateParsed,
    description: item.description?.slice(0, 600),
    sourceUrl: normalized ?? rawUrl,
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
      // Filtre étrangers / agrégateurs / agences (aligné TheirStack)
      if (!isFrenchCompany(job.companyName)) {
        start.skipped += 1;
        continue;
      }
      // Anti-personas (anti-ICP confirmé du client)
      if (args.antiCompanies.some((a) => job.companyName.toLowerCase().includes(a))) {
        start.skipped += 1;
        continue;
      }
      // Anti-doublons cross-source : si Asys est déjà capté via theirstack.job-offer
      // ou un autre apify.* dans les 30j, on skip pour éviter le doublon dans
      // le dashboard. La cross-fertilisation Lead se fait ensuite via
      // mergeLeadsBySiret.
      if (await isHiringAlreadyCapturedCrossSource(args.clientId, job.companyName)) {
        start.skipped += 1;
        continue;
      }
      // Anti-doublons same-source (filet de sécurité contre race conditions)
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
  // - f_TPR=r604800 = posted last week (jobs frais 7j)
  // - f_F=B,C = company size filter (B=11-50, C=51-200) — cible ICP DTL Tech 11-200p
  //   (29/04 : limite naturellement les Sanofi/Capgemini/Atos qui sont taille E+)
  if (useLinkedin) {
    const kw = keywords[0] ?? "QA Engineer";
    const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=France&f_TPR=r604800&f_F=B%2CC`;
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
  // Location ciblée Île-de-France (90% des PME tech FR) au lieu de "France"
  // entier — réduit le bruit (Sanofi/Avril/E.Leclerc rural moins exposés)
  // tout en gardant Paris + couronne. Multi-villes (Lyon/Bdx/Mrs) fait via
  // runs dédiés si volume nécessaire — pas la priorité ICP DTL.
  if (useIndeed) {
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.indeedJobs,
      input: {
        position: keywords[0] ?? "QA Engineer",
        country: "FR",
        location: "Île-de-France",
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
