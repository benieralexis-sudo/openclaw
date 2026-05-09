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
import { checkQuota, recordSpend } from "@/lib/quota-checker";

// Sprint 8 (10/05/2026) — Apify pricing approx : 1 CU ≈ $0.40 sur plan Starter.
// Conservateur (CU réel facturé varie selon RAM allouée). Pour un calcul précis
// post-facto, voir lib/apify.ts getCachedBudget() qui interroge le total mensuel.
const APIFY_USD_PER_CU = 0.4;
// Estimation par run (3 actors × ~0.4 CU moy = 1.2 CU = $0.48). On check à $0.50.
const APIFY_ESTIMATE_PER_RUN_USD = 0.5;

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
  companySiret?: string | null,
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  // Audit 30/04 : ajout du match sur companySiret quand dispo (plus stable
  // que companyName qui varie en casse/accents/espaces entre runs Apify).
  // Avant : 84 doublons triggers détectés sur même siret+sourceCode.
  // Match ENTRE companyName ILIKE OU companySiret EXACT (tolérant aux
  // variations de nom commercial vs RCS).
  const orClauses: Array<Record<string, unknown>> = [
    { companyName: { equals: companyName, mode: "insensitive" } },
  ];
  if (companySiret) {
    orClauses.push({ companySiret });
  }
  const existing = await db.trigger.findFirst({
    where: {
      clientId,
      sourceCode,
      deletedAt: null,
      capturedAt: { gte: since },
      OR: orClauses,
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
  // Sprint 2 B.4 (05/05) — `description` reste la version 600c pour Trigger.detail
  // (affichage dashboard). `fullDescription` (jusqu'à 8000c) est conservée dans
  // rawPayload pour que extractFullDescription() côté qualify-trigger.ts puisse
  // donner au judge Opus les vrais signaux durs : "10 ans d'historique on-site",
  // "équipe 200p", "présentiel obligatoire", etc. Nom `fullDescription` aligné
  // sur FULL_DESC_FIELDS (qualify-trigger.ts:28-34) — pas de modif côté lecture.
  description?: string;
  fullDescription?: string;
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
    description: item.description?.slice(0, 600),
    fullDescription: item.description?.slice(0, 8000),
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
    description: (item.descriptionText ?? item.jobDescription ?? item.description)?.slice(0, 600),
    fullDescription: (item.descriptionText ?? item.jobDescription ?? item.description)?.slice(0, 8000),
    sourceUrl: item.link ?? item.jobUrl ?? item.url,
    posterFullName,
    posterFirstName: firstName,
    posterLastName: lastName,
    posterLinkedinUrl: posterUrl && /linkedin\.com/i.test(posterUrl) ? posterUrl : undefined,
    posterTitle,
  };
}

// ── Adapter WTTJ (clearpath/welcome-to-the-jungle-jobs-api) ──
// Schéma vérifié 03/05/2026 via run dataset : flat fields organizationName +
// offices[] (array) + contractType/publishedAt camelCase. Ancien schéma avec
// `organization.name` / `office.country_code` (snake_case nested) est mort —
// adaptWttjItem retournait null sur 100% des items, expliquant les 0 triggers
// créés malgré $8.38 de scrape sur 7 jours (incident 03/05).
interface WttjJobItem {
  name?: string;
  url?: string;
  contractType?: string;
  remote?: string;
  language?: string;
  publishedAt?: string;
  category?: string;
  subcategory?: string;
  summary?: string;
  description?: string;
  offices?: Array<{
    city?: string;
    country_code?: string;
    district?: string;
    address?: string;
    zip_code?: string;
  }>;
  organizationName?: string;
  organizationSlug?: string;
  organizationEmployees?: number;
  organizationCreationYear?: number;
}

function adaptWttjItem(item: WttjJobItem): NormalizedJob | null {
  const title = item.name;
  const company = item.organizationName;
  if (!title || !company) return null;
  // Filtre pays : si offices renseigné, exiger au moins un FR
  const offices = item.offices ?? [];
  if (offices.length > 0) {
    const hasFr = offices.some((o) => !o.country_code || o.country_code === "FR");
    if (!hasFr) return null;
  }
  // Pré-filtre ICP DTL côté adapter : exclure boîtes >250p (gain bruit
  // 30/04 : Sword/Atos/Capgemini/Sopra polluent les Pépites). Le filtre
  // companySize côté input actor `50-250` ne suffit pas toujours.
  const employees = item.organizationEmployees ?? 0;
  if (employees > 0 && employees > 250) return null;

  const office = offices[0];
  return {
    jobTitle: title,
    companyName: company,
    url: item.url,
    location: office?.city,
    postedAt: item.publishedAt,
    description: (item.summary ?? item.description)?.slice(0, 600),
    fullDescription: (item.summary ?? item.description)?.slice(0, 8000),
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
    fullDescription: item.description?.slice(0, 8000),
    sourceUrl: normalized ?? rawUrl,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Filtre titre QA strict (anti-bruit Indeed/LinkedIn FR)
// ──────────────────────────────────────────────────────────────────────
// Indeed FR matche large : "QA Engineer" → tout job avec "Engineer".
// On post-filtre sur jobTitle pour ne garder QUE les vraies offres
// QA/Test/Quality/Tester/Automation. Évite Sophia Engineering, Climater
// CVC, COMET Aerospace qui pollutent à score 1-3.
const QA_TITLE_REGEX =
  /\b(qa|q\.a\.|test(?:eur|ing|er|s)?|quality\s*assurance|automaticien|sdet|qualiticien|recette|validation\s+log)/i;

const NON_QA_TITLE_REGEX =
  /\b(m[ée]canique|cvc|a[eé]rospatial|a[eé]ronautique|industriel(?!le.*qa)|paqa\b|chimie|bio[mt]|process(?!.*qa)|cadre\s+de\s+sant)/i;

function titleMatchesQaIntent(title: string | undefined | null): boolean {
  if (!title) return false;
  if (NON_QA_TITLE_REGEX.test(title)) return false;
  return QA_TITLE_REGEX.test(title);
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
  titleFilter?: (title: string) => boolean;
}): Promise<ApifyPollerResult["actorRuns"][number]> {
  const start = {
    actor: args.actor,
    runId: "",
    itemsFound: 0,
    triggersCreated: 0,
    skipped: 0,
  } as ApifyPollerResult["actorRuns"][number];

  // Sprint 8 — Quota check Apify AVANT run. Bloque si client a depasse hard cap.
  const quota = await checkQuota(args.clientId, "apify", APIFY_ESTIMATE_PER_RUN_USD);
  if (!quota.ok) {
    console.warn(
      `[apify-poller.quota-blocked] client=${args.clientId} actor=${args.actor} reason=${quota.reason} pct=${quota.pctUsed}%`,
    );
    start.error = `quota-blocked: ${quota.reason}`;
    return start;
  }

  try {
    const { run, items } = await runAndGetItems<Record<string, unknown>>(
      args.actor,
      args.input,
      { itemsLimit: 100, timeout: 180 }, // 3 min max
    );
    start.runId = run?.id ?? "(sync)";
    start.computeUnits = run?.stats?.computeUnits;
    start.itemsFound = items.length;

    // Sprint 8 — record cost reel post-run (CU facture par Apify).
    if (start.computeUnits !== undefined && start.computeUnits > 0) {
      const actualCostUsd = start.computeUnits * APIFY_USD_PER_CU;
      await recordSpend(args.clientId, "apify", actualCostUsd).catch((e) =>
        console.warn(
          `[apify-poller.recordSpend] client=${args.clientId} failed: ${e instanceof Error ? e.message : e}`,
        ),
      );
    }

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
      // Post-filter titre (anti-bruit Indeed/LinkedIn : "Ingénieur Méthodes
      // Industrielles", "Ingénieur CVC", "Process Engineer Aerospace" matchent
      // "Engineer" mais ne sont pas du QA — score 1-3 = pure pollution).
      if (args.titleFilter && !args.titleFilter(job.jobTitle)) {
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
  // Indeed FR ABANDON DÉFINITIF 03/05/2026 (commit 9acab836b — A/B test 4 stratégies
  // échouées, actor misceres ne supporte pas filtre catégorie Quality Assurance,
  // 90% bruit industriel/aérospatial). Verrou dur ici : ignore options.useIndeed.
  // Pour ressusciter (nouveau actor catégorisable), changer manuellement cette ligne.
  const useIndeed = false;

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
    // Fix M5 (04/05) — Boucle sur top 3 keywords au lieu de keywords[0] seul.
    // Avant : 1 keyword sur 24 (avec C13 keywordsHiring élargi) → 95% des
    // termes ICP DTL ne sont jamais cherchés dans LinkedIn-jobs.
    // Maintenant : on cherche les 3 plus pertinents (QA Engineer, SDET,
    // Test Automation Engineer typiquement). Le actor Apify reçoit 3 URLs
    // dans le tableau `urls` → en parallèle, count: 30 par URL = max 90 jobs.
    // L'actor fait ensuite la dédup interne (mêmes job-ids dans les runs).
    const topKeywords = (keywords.length > 0 ? keywords : ["QA Engineer"])
      .slice(0, 3);
    const linkedinUrls = topKeywords.map(
      (kw) =>
        `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=France&f_TPR=r604800&f_F=B%2CC`,
    );
    const r = await runActorAndPushTriggers({
      actor: APIFY_ACTORS.linkedinJobs,
      input: {
        urls: linkedinUrls,
        count: 30,
        scrapeCompany: false,
      },
      clientId,
      sourceCode: "apify.linkedin-jobs",
      adapter: (item) => adaptLinkedinJobItem(item as LinkedinJobItem),
      antiCompanies,
      dryRun: options.dryRun,
      titleFilter: titleMatchesQaIntent,
    });
    result.actorRuns.push(r);
    result.totalTriggersCreated += r.triggersCreated;
  }

  // 3. WTTJ — clearpath/welcome-to-the-jungle-jobs-api
  // Filtre companySize ICP-aware : 50-250p (cible DTL Tech 11-200)
  //
  // Patch A1+B (06/05/2026, audit Apify) :
  //  - Gate horaire 06h UTC : 1×/jour au lieu de 4×/jour. Mesure empirique
  //    sur 2 runs WTTJ à 6h d'intervalle = 100% overlap (36/36 jobs identiques),
  //    0 NEW triggers DTL en 24h sur les 4 runs. Conclusion : WTTJ ne refresh
  //    pas en 6h, scraper à cette fréquence = gaspillage pur.
  //  - Multi-keyword : top 3 keywordsHiring au lieu de keywords[0] seul.
  //    Avant : 1 query "QA Engineer" sur 24 keywords ICP DTL. Après : "QA",
  //    "Software Tester", "Test Engineer" en parallèle. Gain estimé +10-50%
  //    triggers WTTJ uniques (mesure DB : 6% boîtes ont 2+ titles distincts).
  //  - Coût : 3 runs/j × $0.11 = $0.33/j vs $0.44/j avant = -$3/mois net.
  if (useWttj && new Date().getUTCHours() === 6) {
    const wttjKeywords = (keywords.length > 0 ? keywords : ["test logiciel"]).slice(0, 3);
    for (const kw of wttjKeywords) {
      const r = await runActorAndPushTriggers({
        actor: APIFY_ACTORS.wttjJobs,
        input: {
          query: kw,
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
        // BUGFIX 03/05 : le param actor est `maxItemsPerSearch` (PAS `maxItems`).
        // Même classe d'erreur que maxPostsPerCompany→maxPosts (commit 446b136b5).
        // Avant : actor ignorait notre limite et scrapait toute la pagination
        // → ~30 jobs facturés/run mais 100% bruit "Ingénieur Maintenance/CVC"
        // rejetés au post-filtre titleMatchesQaIntent.
        // Baisse 30→15 : on filtre 80% au post-scrape, garder 30 = waste.
        maxItemsPerSearch: 15,
        saveOnlyUniqueItems: true,
        parseCompanyDetails: false,
      },
      clientId,
      sourceCode: "apify.indeed-jobs",
      adapter: (item) => adaptIndeedItem(item as IndeedJobItem),
      antiCompanies,
      dryRun: options.dryRun,
      titleFilter: titleMatchesQaIntent,
    });
    result.actorRuns.push(r);
    result.totalTriggersCreated += r.triggersCreated;
  }

  return result;
}
