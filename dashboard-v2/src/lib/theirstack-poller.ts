import "server-only";

/**
 * Phase 3.C — Poller TheirStack pour un client donné.
 *
 * Lit l'ICP du client en DB, lance les recherches TheirStack
 * appropriées, et pousse les résultats en DB Trigger + Lead.
 *
 * À lancer en cron (1×/jour) ou via bouton admin "Run TheirStack".
 *
 * Coûts indicatifs : 1 cr/job · 3 cr/company.
 */

import { Prisma, TriggerStatus, TriggerType, LeadStatus, EmailStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { searchJobs, searchCompanies, type JobResult, type JobSearchFilters, type CompanyResult, type CompanySearchFilters } from "@/lib/theirstack";
import { attributeSirene, getEntreprise } from "@/lib/pappers";
import { markLeadEnrichedFromPappers } from "@/lib/lead-enrichment-tagging";
import { mergeDuplicateTriggersBySiret } from "@/lib/trigger-dedup";
import { checkQuota, recordSpend } from "@/lib/quota-checker";
import { getP1Keywords, getP3Industries, getP3Sizes } from "@/lib/signal-config";

// Sprint 8 (10/05/2026) — TheirStack pricing : ~$89/5200 cr ≈ $0.0171/cr.
// 1 cr/job · 3 cr/company. On record le cout post-call sur creditsEstimateUsed.
const THEIRSTACK_USD_PER_CREDIT = 0.0171;
// Estimation upper-bound par poll : jobs (30 cr) + companies buying-intent (45 cr) = ~$1.30
const THEIRSTACK_ESTIMATE_PER_POLL_USD = 1.5;

/**
 * Slugs TheirStack des outils de test/QA — utilisés par DTL et tout
 * client positionné sur le testing externalisé. Une boîte qui en utilise
 * au moins un a investi dans son infra test → cible naturelle DTL.
 *
 * Liste basée sur la nomenclature kebab-case standard TheirStack.
 * À valider en run réel (slugs exacts peuvent varier — voir
 * /v0/technologies/search côté API TheirStack si besoin de check).
 */
export const QA_TESTING_TECH_SLUGS = [
  // E2E / browser automation
  "selenium",
  "cypress",
  "playwright",
  "puppeteer",
  "katalon",
  "testcafe",
  // Unit / integration
  "jest",
  "mocha",
  "jasmine",
  "vitest",
  // Test management
  "testrail",
  "qtest",
  "xray",
  "zephyr",
  // API testing
  "postman",
  "soapui",
  "karate",
  // Mobile / cross-browser
  "appium",
  "browserstack",
  "saucelabs",
  // Performance
  "jmeter",
  "gatling",
  "k6",
  // Robot frameworks
  "robot-framework",
  "ranorex",
];

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  preferredSignals?: string[];
  antiPersonas?: string[];
  personaTitles?: string[];
  keywordsHiring?: string[];
}

export interface PollerResult {
  clientId: string;
  jobsFound: number;
  jobsCreated: number;
  jobsSkipped: number;
  companiesFound: number;
  errors: Array<{ kind: string; error: string }>;
  creditsEstimateUsed: number;
}

const SIZE_RANGE: Record<string, [number, number]> = {
  "1-10": [1, 10],
  "11-50": [11, 50],
  "51-200": [51, 200],
  "201-500": [201, 500],
  "501-1000": [501, 1000],
  "1001-5000": [1001, 5000],
  "5001-10000": [5001, 10000],
  "10001+": [10001, 100000],
};

function rangeForSizes(sizes: string[] | undefined): { gte?: number; lte?: number } {
  if (!sizes || sizes.length === 0) return {};
  const matched = sizes.map((s) => SIZE_RANGE[s]).filter((r): r is [number, number] => Boolean(r));
  if (matched.length === 0) return {};
  return {
    gte: Math.min(...matched.map((r) => r[0])),
    lte: Math.max(...matched.map((r) => r[1])),
  };
}

function mapIndustries(icpIndustries: string[] | undefined): string[] {
  if (!icpIndustries) return [];
  return icpIndustries.flatMap((i) => {
    const lower = i.toLowerCase();
    if (lower.includes("saas") || lower.includes("logiciel") || lower.includes("tech"))
      return ["Software", "SaaS", "Information Technology"];
    if (lower.includes("esn") || lower.includes("ssii") || lower.includes("cabinet it"))
      return ["IT Services", "Information Technology"];
    if (lower.includes("btp") || lower.includes("construction"))
      return ["Construction"];
    if (lower.includes("logistique"))
      return ["Logistics", "Supply Chain"];
    return [i];
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mapping job → Trigger (pas de Lead car pas de contact dans TheirStack jobs)
// ──────────────────────────────────────────────────────────────────────

function jobToTriggerData(
  job: JobResult,
  clientId: string,
): Prisma.TriggerCreateInput {
  // Score : seniority + repost flag = boost
  let score = 6;
  if (job.seniority === "c_level") score = 9;
  else if (job.seniority === "vp" || job.seniority === "director") score = 8;
  else if (job.seniority === "senior") score = 7;
  if (job.reposted) score = Math.max(score, 8); // republished = signal urgence

  // Bug DiXiO (11/05/2026) — capter l'effectif réel du groupe depuis le bloc
  // company_object de TheirStack au lieu de laisser size=null puis se faire
  // écraser par la tranche Pappers de la coquille FR (cas DiXiO 42p Dubai →
  // SIREN FR 1-2 salariés). 27/32 triggers job-offer perdaient l'info.
  const employeeCount =
    typeof job.company_object?.employee_count === "number"
      ? job.company_object.employee_count
      : null;

  return {
    client: { connect: { id: clientId } },
    sourceCode: "theirstack.job-offer",
    sourceUrl: job.url,
    capturedAt: new Date(),
    publishedAt: job.date_posted ? new Date(job.date_posted) : null,
    companyName: job.company,
    companySiret: null, // sera enrichi via Pappers en post-traitement
    industry: null,
    region: job.country_code === "FR" ? job.short_location ?? job.country : job.country,
    size: employeeCount !== null ? String(employeeCount) : null,
    type: TriggerType.HIRING_KEY,
    title: `Recrutement ${job.job_title}${job.reposted ? " (republished)" : ""}`,
    detail: [
      job.long_location,
      job.salary_string ?? null,
      job.remote ? "Remote OK" : null,
      job.hybrid ? "Hybride" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    rawPayload: job as unknown as Prisma.InputJsonValue,
    score,
    isHot: score >= 9,
    isCombo: false,
    status: TriggerStatus.NEW,
  };
}

function companyToTriggerData(
  company: CompanyResult,
  clientId: string,
  triggerKind: string,
): Prisma.TriggerCreateInput {
  const score = 6; // companies sans signal direct = score moyen, sera up si combo détecté
  return {
    client: { connect: { id: clientId } },
    sourceCode: `theirstack.${triggerKind}`,
    sourceUrl: company.linkedin_url ?? null,
    capturedAt: new Date(),
    publishedAt: null,
    companyName: company.name,
    companySiret: null,
    industry: company.industry ?? null,
    region: company.country ?? company.country_code ?? null,
    size: company.employee_count ? String(company.employee_count) : null,
    type: TriggerType.OTHER,
    title: `${company.name} — match ICP`,
    detail: [
      company.industry,
      company.employee_count ? `${company.employee_count} employés` : null,
      company.revenue_usd ? `CA ${(company.revenue_usd / 1_000_000).toFixed(1)}M$` : null,
      company.technologies?.length ? `Tech: ${company.technologies.slice(0, 5).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    rawPayload: company as unknown as Prisma.InputJsonValue,
    score,
    isHot: false,
    isCombo: false,
    status: TriggerStatus.NEW,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Anti-doublons (cache 30 jours par companyName + sourceCode)
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
 * Cross-source dédup HIRING — voir apify-poller pour détails. Évite
 * Asys créée 2x (apify.* + theirstack.job-offer) dans le dashboard.
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
// Poller principal
// ──────────────────────────────────────────────────────────────────────

export async function pollTheirstackForClient(
  clientId: string,
  options: { dryRun?: boolean; jobsLimit?: number; companiesLimit?: number } = {},
): Promise<PollerResult> {
  const result: PollerResult = {
    clientId,
    jobsFound: 0,
    jobsCreated: 0,
    jobsSkipped: 0,
    companiesFound: 0,
    errors: [],
    creditsEstimateUsed: 0,
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  // Sprint 8 — Quota check TheirStack AVANT searchJobs (~30 cr ≈ $0.51 estim).
  const quota = await checkQuota(clientId, "theirstack", THEIRSTACK_ESTIMATE_PER_POLL_USD);
  if (!quota.ok) {
    console.warn(
      `[theirstack-poller.quota-blocked] client=${clientId} reason=${quota.reason} pct=${quota.pctUsed}%`,
    );
    result.errors.push({ kind: "quota-blocked", error: quota.reason ?? "unknown" });
    return result;
  }

  const icp = client.icp as ClientIcpExtended;
  // Sprint catalogue P1.3+1.4 (17/05) — params depuis ClientSignalConfig
  // avec fallback icp (transition douce). TheirStack jobs alimente le signal
  // P1 Hire role X (job_title_or = keywords) + P3 Stack tech (industries/sizes).
  const p3Sizes = await getP3Sizes(clientId, icp);
  const p3Industries = await getP3Industries(clientId, icp);
  const hiringKeywords = await getP1Keywords(clientId, icp);
  const sizeRange = rangeForSizes(p3Sizes);
  const tsIndustries = mapIndustries(p3Industries);
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());
  const limit = options.jobsLimit ?? 30;

  // ────────────────────────────────────────────────────────────────────
  // 1) Jobs : keywords ICP × pays FR × age 7 jours (pour MVP test)
  // ────────────────────────────────────────────────────────────────────
  if (hiringKeywords.length > 0) {
    try {
      const jobFilters: JobSearchFilters = {
        job_country_code_or: ["FR"],
        job_title_or: hiringKeywords,
        posted_at_max_age_days: 7,
        limit,
        ...(sizeRange.gte !== undefined && { min_employee_count: sizeRange.gte }),
        ...(sizeRange.lte !== undefined && { max_employee_count: sizeRange.lte }),
        ...(tsIndustries.length > 0 && { industry_or: tsIndustries }),
      };

      const { data: jobs } = await searchJobs(jobFilters);
      result.jobsFound = jobs.length;
      result.creditsEstimateUsed += jobs.length;

      for (const job of jobs) {
        // Anti-personas filter
        if (antiCompanies.some((a) => job.company.toLowerCase().includes(a))) {
          result.jobsSkipped += 1;
          continue;
        }
        // Strict FR : skip si country_code != FR (TheirStack peut remonter cross-border)
        if (job.country_code && job.country_code !== "FR") {
          result.jobsSkipped += 1;
          continue;
        }
        // Skip si nom de boîte avec suffixe légal étranger (GmbH, LLC, Ltd, Inc, Corp)
        // ou marqueur spécifique non-FR (Payments US, Berkeley, etc.)
        if (/\b(GmbH|LLC|Ltd|Inc|Corp|Pty|S\.r\.l\.|S\.A\.R\.L\. España|UAB|s\.r\.o\.|AB)\b/i.test(job.company)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Filtre étendu : noms d'entreprises connues hors-ICP FR
        if (/\b(Berkeley\s+Payments|Stott\s+and\s+May|Apple|Google|Microsoft|Amazon|Meta\s+Platforms)\b/i.test(job.company)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Skip patterns d'agrégateurs / agences de recrutement (qui ne sont pas le client final)
        if (/^(jobs\s+via\s+|jobs\s+at\s+)/i.test(job.company)) {
          result.jobsSkipped += 1;
          continue;
        }
        if (/\b(recruitment\s+agency|staffing|recruiter|talent\s+acquisition)\b/i.test(job.company)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Skip si location contient marqueur non-FR
        const loc = `${job.long_location ?? ""} ${job.short_location ?? ""}`.toLowerCase();
        if (/\b(us|usa|united states|united kingdom|germany|spain|italy|netherlands|belgium)\b/i.test(loc)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Anti-doublons cross-source : si Asys déjà capté via apify.* ou autre
        // theirstack.job-offer dans les 30j → skip. Cross-fertilisation des
        // Leads se fait ensuite via mergeLeadsBySiret.
        if (await isHiringAlreadyCapturedCrossSource(clientId, job.company)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Anti-doublons same-source (filet race conditions)
        if (await isAlreadyCaptured(clientId, job.company, "theirstack.job-offer")) {
          result.jobsSkipped += 1;
          continue;
        }
        if (options.dryRun) {
          result.jobsCreated += 1;
          continue;
        }
        try {
          await db.trigger.create({ data: jobToTriggerData(job, clientId) });
          result.jobsCreated += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("Trigger_clientId_sourceCode_sourceUrl_unique") || msg.includes("P2002") || msg.includes("Unique constraint failed")) {
            result.jobsSkipped += 1;
          } else {
            result.errors.push({ kind: "trigger-create", error: msg });
          }
        }
      }
    } catch (e) {
      result.errors.push({
        kind: "searchJobs",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 2) Companies / buying-intent : reboot 04/05 (Bougie 2).
  //
  // Ancienne approche (29/04) cherchait "tech stack + industry" trop
  // large → 0 pépite. Nouvelle approche : cible précise sur outils de
  // test installés (Selenium/Cypress/TestRail/etc) → boîte qui a investi
  // dans l'infra test = candidate naturelle pour externalisation/renfort.
  // Voir pollTheirstackBuyingIntentForClient() ci-dessous, appelée
  // séparément (cron quotidien dédié, pas dans le poll principal pour
  // garder le coût lisible).
  // ────────────────────────────────────────────────────────────────────

  // Sprint 8 — record cost reel (creditsEstimateUsed comptabilise jobs trouves)
  if (result.creditsEstimateUsed > 0) {
    const actualCostUsd = result.creditsEstimateUsed * THEIRSTACK_USD_PER_CREDIT;
    await recordSpend(clientId, "theirstack", actualCostUsd).catch((e) =>
      console.warn(
        `[theirstack-poller.recordSpend] client=${clientId} failed: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Buying intent — outils de test installés (cible DTL)
// ──────────────────────────────────────────────────────────────────────

export interface BuyingIntentPollerResult {
  clientId: string;
  companiesFound: number;
  triggersCreated: number;
  triggersSkipped: number;
  errors: Array<{ kind: string; error: string }>;
  creditsEstimateUsed: number;
}

/**
 * Cherche les boîtes qui utilisent un outil de test (Selenium, Cypress,
 * TestRail…) ET qui matchent l'ICP du client (FR, taille, industrie).
 *
 * Crée des triggers BUYING_INTENT score plancher 7 — Opus peut booster
 * via qualify-trigger.ts. Dédup cross-source : skip si déjà en HIRING_KEY
 * dans les 30j (la boîte est déjà dans le pipeline via une autre route).
 *
 * Coût : 3 credits / company retournée (limite par défaut 15 → ~45 cr).
 */
export async function pollTheirstackBuyingIntentForClient(
  clientId: string,
  options: {
    dryRun?: boolean;
    techSlugs?: string[]; // par défaut QA_TESTING_TECH_SLUGS
    companiesLimit?: number;
  } = {},
): Promise<BuyingIntentPollerResult> {
  const result: BuyingIntentPollerResult = {
    clientId,
    companiesFound: 0,
    triggersCreated: 0,
    triggersSkipped: 0,
    errors: [],
    creditsEstimateUsed: 0,
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  // Sprint 8 — Quota check TheirStack AVANT buying-intent (~45 cr ≈ $0.77 estim).
  const quota = await checkQuota(clientId, "theirstack", 0.8);
  if (!quota.ok) {
    console.warn(
      `[theirstack-poller-bi.quota-blocked] client=${clientId} reason=${quota.reason} pct=${quota.pctUsed}%`,
    );
    result.errors.push({ kind: "quota-blocked", error: quota.reason ?? "unknown" });
    return result;
  }

  const icp = client.icp as ClientIcpExtended;
  // Sprint catalogue P1.4 (17/05) — params depuis ClientSignalConfig.P3
  // avec fallback icp.industries/sizes (transition).
  const p3Sizes = await getP3Sizes(clientId, icp);
  const p3Industries = await getP3Industries(clientId, icp);
  const sizeRange = rangeForSizes(p3Sizes);
  const tsIndustries = mapIndustries(p3Industries);
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());
  const techSlugs = options.techSlugs ?? QA_TESTING_TECH_SLUGS;
  const limit = options.companiesLimit ?? 15;

  if (techSlugs.length === 0) {
    result.errors.push({ kind: "config", error: "techSlugs vide" });
    return result;
  }

  try {
    const filters: CompanySearchFilters = {
      company_country_code_or: ["FR"],
      company_technology_slug_or: techSlugs,
      limit,
      ...(sizeRange.gte !== undefined && { min_employee_count: sizeRange.gte }),
      ...(sizeRange.lte !== undefined && { max_employee_count: sizeRange.lte }),
      ...(tsIndustries.length > 0 && { industry_or: tsIndustries }),
    };

    const { data: companies } = await searchCompanies(filters);
    result.companiesFound = companies.length;
    result.creditsEstimateUsed += companies.length * 3;

    // Dédup intra-batch sur linkedin_url (TheirStack peut renvoyer plusieurs
    // rows pour la même company quand elle matche plusieurs technos demandées).
    const seenUrls = new Set<string>();
    const uniqueCompanies = companies.filter((c) => {
      if (!c.linkedin_url) return true;
      if (seenUrls.has(c.linkedin_url)) return false;
      seenUrls.add(c.linkedin_url);
      return true;
    });

    for (const company of uniqueCompanies) {
      // Anti-personas
      if (antiCompanies.some((a) => company.name.toLowerCase().includes(a))) {
        result.triggersSkipped += 1;
        continue;
      }
      // Strict FR (TheirStack peut lâcher du bruit cross-border)
      if (company.country_code && company.country_code !== "FR") {
        result.triggersSkipped += 1;
        continue;
      }
      // Suffixes légaux étrangers
      if (/\b(GmbH|LLC|Ltd|Inc|Corp|Pty|S\.r\.l\.|UAB|s\.r\.o\.|AB)\b/i.test(company.name)) {
        result.triggersSkipped += 1;
        continue;
      }
      // Dédup cross-source : skip si déjà capté en HIRING_KEY récemment
      // (la boîte est déjà dans le pipeline via apify ou theirstack jobs,
      // pas la peine d'ajouter un buying-intent en plus)
      if (await isHiringAlreadyCapturedCrossSource(clientId, company.name)) {
        result.triggersSkipped += 1;
        continue;
      }
      // Dédup same-source
      if (await isAlreadyCaptured(clientId, company.name, "theirstack.buying-intent")) {
        result.triggersSkipped += 1;
        continue;
      }

      // C15 — Gate taille buying-intent (signal faible "utilise outils QA").
      // L'audit Agent #4 a montré 70% bruit — capte ALTEN 39169p, Capgemini
      // 46k, secteurs Oil&Gas/Broadcast hors ICP DTL. On force la cohérence
      // ICP-taille AVANT création trigger pour ne pas polluer le pool.
      const employeeCount =
        typeof company.employee_count === "number" ? company.employee_count : null;
      if (employeeCount !== null && (employeeCount < 11 || employeeCount > 200)) {
        result.triggersSkipped += 1;
        continue;
      }
      // Industry hors-tech : Oil&Gas, Broadcast Media, Manufacturing pure,
      // Defense, Aerospace, Mining. Si TheirStack a une catégorie explicite
      // hors ICP DTL Tech/SaaS+ESN, on skip avant qualif.
      const industryLower = (company.industry ?? "").toLowerCase();
      const HARD_ANTI_INDUSTRIES = [
        "oil",
        "gas",
        "petroleum",
        "mining",
        "broadcast",
        "defense",
        "defence",
        "aerospace",
        "automotive manufacturing",
        "construction",
        "real estate",
        "agriculture",
        "food production",
        "shipping",
        "trucking",
        // 15/05/2026 — cabinets conseil/recrutement/staffing (Auditor EXTERNATIC
        // NAF 70.22Z). Le signal "utilise outils QA" matche le cabinet IT lui-même
        // (qui consomme ces outils pour ses missions), pas le client final cible.
        // Pollue le quota TheirStack pour rien.
        "staffing",
        "recruitment",
        "recruiting",
        "human resources services",
        "executive search",
      ];
      if (HARD_ANTI_INDUSTRIES.some((k) => industryLower.includes(k))) {
        result.triggersSkipped += 1;
        continue;
      }

      if (options.dryRun) {
        result.triggersCreated += 1;
        continue;
      }

      try {
        // Détail = liste des outils QA détectés (intersection avec notre liste)
        const matchedTools = (company.technologies ?? []).filter((t) =>
          techSlugs.some((s) => t.toLowerCase().includes(s.toLowerCase())),
        );
        const trigger = companyToTriggerData(company, clientId, "buying-intent");
        // Override score + type pour buying-intent QA (signal d'achat
        // outils test = vraie cible DTL, plus fort qu'un simple match ICP)
        trigger.type = TriggerType.BUYING_INTENT;
        trigger.score = 7;
        trigger.title = `${company.name} — utilise outils QA${matchedTools.length > 0 ? ` (${matchedTools.slice(0, 3).join(", ")})` : ""}`;
        trigger.detail = [
          company.industry,
          company.employee_count ? `${company.employee_count} employés` : null,
          matchedTools.length > 0 ? `Tools détectés : ${matchedTools.join(", ")}` : null,
          "Signal : a investi dans l'infra test, candidat externalisation/renfort QA",
        ]
          .filter(Boolean)
          .join(" · ");
        await db.trigger.create({ data: trigger });
        result.triggersCreated += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Trigger_clientId_sourceCode_sourceUrl_unique") || msg.includes("P2002")) {
          result.triggersSkipped += 1;
        } else {
          result.errors.push({ kind: "trigger-create", error: msg });
        }
      }
    }
  } catch (e) {
    result.errors.push({
      kind: "searchCompanies",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Sprint 8 — record cost reel buying-intent (3 cr/company × companies trouvees)
  if (result.creditsEstimateUsed > 0) {
    const actualCostUsd = result.creditsEstimateUsed * THEIRSTACK_USD_PER_CREDIT;
    await recordSpend(clientId, "theirstack", actualCostUsd).catch((e) =>
      console.warn(
        `[theirstack-poller-bi.recordSpend] client=${clientId} failed: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Helper post-poll : enrichissement Pappers SIRENE pour les triggers
// récents qui n'ont pas de SIRET (nécessite Pappers)
// ──────────────────────────────────────────────────────────────────────

export async function enrichRecentTriggersWithSirene(
  clientId: string,
  options: { limit?: number; lookbackHours?: number } = {},
): Promise<{ enriched: number; skipped: number; errors: number; pruned?: number }> {
  const limit = options.limit ?? 20;
  // B4 (17/05/2026) — Fenêtre paramétrable. Par défaut 24h (cron run-pollers
  // standard). Job de retry ENRICH passe à 168h = 7j pour re-tenter sur les
  // triggers verdict=ENRICH où Opus a dit "Attribution Pappers needed" sans
  // que ça ait abouti au 1er passage.
  const hoursBack = options.lookbackHours ?? 24;
  const since = new Date();
  since.setHours(since.getHours() - hoursBack);

  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      companySiret: null,
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: { id: true, companyName: true },
    take: limit,
  });

  const stats: { enriched: number; skipped: number; errors: number; pruned: number } =
    { enriched: 0, skipped: 0, errors: 0, pruned: 0 };

  for (const t of triggers) {
    try {
      const result = await attributeSirene(t.companyName);
      if (!result) {
        // Pas de SIRET trouvé via Pappers — on garde le trigger en attente,
        // les commerciaux pourront enrichir manuellement (LinkedIn search,
        // ajout fiche). On NE SUPPRIME PAS — la stratégie est d'enrichir
        // à fond les leads qu'on garde, pas de jeter ceux pas auto-enrichis.
        stats.skipped += 1;
        continue;
      }
      // Sprint Vague 3 P16 (08/05) — Filtre NAF amont blacklist
      // Si le NAF est dans la blacklist (immo, holding, recrutement, etc.),
      // on soft-delete le trigger immédiatement après résolution SIRENE.
      // Évite que le pipeline aval (enrichDirigeants/Kaspr/FullEnrich) consomme
      // des crédits sur ces fantômes hors-ICP.
      const { isBlacklistNaf } = await import("@/lib/naf-whitelist");
      if (isBlacklistNaf(result.code_naf)) {
        await db.trigger.update({
          where: { id: t.id },
          data: {
            companySiret: result.siren,
            companyNaf: result.code_naf ?? null,
            size: result.effectif ?? null,
            status: "IGNORED",
            scoreReason: `[NAF-blacklist:${result.code_naf}] Secteur structurellement hors-ICP (immo/holding/recrutement/etc) — auto-skip P16`,
            // Fix B4.1 (15/05/2026) — Cohérence ignoredReason + ignoredAt
            // alignée sur les autres voies IGNORED (avant : seul scoreReason
            // était posé, ignoredReason restait NULL).
            ignoredAt: new Date(),
            ignoredReason: `naf-blacklist:${result.code_naf}`,
            deletedAt: new Date(),
          },
        });
        console.log(`[theirstack.naf-filter] ${t.companyName} NAF=${result.code_naf} → soft-deleted (blacklist)`);
        stats.pruned += 1;
        continue;
      }
      await db.trigger.update({
        where: { id: t.id },
        data: {
          companySiret: result.siren,
          companyNaf: result.code_naf ?? null,
          size: result.effectif ?? null,
        },
      });
      stats.enriched += 1;

      // Sprint Perfection P3 (08/05) — Dédup post-attribution SIRENE.
      // Si un autre trigger existe déjà avec ce SIRET (cas typique : Asys
      // capté via apify.wttj-jobs ET via theirstack.job-offer), on fusionne
      // les 2 maintenant que les SIRET sont alignés. Le trigger avec score
      // max gagne, l'autre est soft-deleted (ignoredReason="dedup-merged"),
      // multiSourceBoost cumulé, isCombo=true.
      // Charge le client pour récupérer minScore (promote IGNORED→NEW si
      // newScore atteint le seuil).
      const clientForIcp = await db.client.findUnique({
        where: { id: clientId },
        select: { icp: true },
      }).catch(() => null);
      const icpMinScore = (clientForIcp?.icp as Record<string, unknown> | null)?.minScore;
      await mergeDuplicateTriggersBySiret(t.id, {
        icp: typeof icpMinScore === "number" ? { minScore: icpMinScore } : null,
      }).catch((e) => {
        console.warn(
          `[trigger-dedup.merge] err on ${t.id}:`,
          e instanceof Error ? e.message : e,
        );
      });
    } catch {
      stats.errors += 1;
    }
  }

  // Sprint 1 A3 (05/05/2026) — Triggers AVEC SIRET mais SANS companyNaf/size.
  //
  // Sprint Perfection P2 (08/05) — fenêtre étendue 24h → 7j + filtre élargi
  // (industry, region) + take 20 → 50 pour absorber le backlog.
  // KPI baseline : size rempli 29% / industry 29% sur 7j. Cible : ≥70%.
  //
  // Cas typique : funding-recent depuis postgres-sync.js. Le sync attribue
  // un SIREN au moment où il transfère SQLite → Postgres (ligne 288), mais
  // la SQLite "companies" table peut être partielle (rss-levees ingest n'a pas
  // forcément hydraté NAF/effectif au moment de l'attribution SIRENE initiale).
  //
  // Fix : sweep ciblé via getEntreprise(siren) Pappers (1 cr/call, cache 1h
  // in-process). On comble companyNaf, size, industry, region quand vides.
  // Coût marginal : ~30-40 calls/jour selon volume (forfait Pappers illimité).
  const sweepWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const triggersIncomplete = await db.trigger.findMany({
    where: {
      clientId,
      companySiret: { not: null },
      OR: [
        { companyNaf: null },
        { size: null },
        { industry: null },
        { region: null },
      ],
      capturedAt: { gte: sweepWindow },
      deletedAt: null,
    },
    select: {
      id: true,
      companySiret: true,
      companyName: true,
      companyNaf: true,
      size: true,
      industry: true,
      region: true,
      sourceCode: true,
    },
    take: 50,
  });

  for (const t of triggersIncomplete) {
    if (!t.companySiret) continue;
    // Garde-fou : pseudo-SIREN type "FTabc1234" doivent être ignorés (déjà
    // filtrés en amont par postgres-sync.js:196 mais defensive coding).
    if (!/^\d+$/.test(t.companySiret)) continue;
    try {
      // Sprint Perfection P1 (08/05) — Inclure aussi bilans+depots+etablissements
      // pour permettre au helper markLeadEnrichedFromPappers de persister
      // companyRevenue/ResultNet/EtabsCount/RecentDepots sur le Lead. Forfait
      // Pappers illimité = 0€ surcoût pour ces options.
      // Sprint 1 Q2 (05/05/2026) — procedures_collectives pour gate insolvency.
      const entreprise = await getEntreprise(t.companySiret, {
        includeProceduresCollectives: true,
        includeBilans: true,
        includeDepotsActes: true,
        includeEtablissements: true,
      });
      if (!entreprise) {
        stats.skipped += 1;
        continue;
      }

      // Sprint 1 Q2 (05/05/2026) — Insolvency gate AVANT Lead creation.
      // L'audit Phase 1 du 05/05 a constaté 0/146 leads avec
      // companyHasInsolvency=true côté DTL alors que le check post-hoc dans
      // enrich-lead-dirigeants.ts:205-220 fonctionne (les leads sont
      // soft-deleted retroactivement). Ici on gate plus tôt : si la boîte est
      // en RJ/LJ, on archive le Trigger AVANT que ensureLeadsForAllTriggers
      // ne crée le Lead → économise 1 Lead créé puis enrichers cramés
      // (Kaspr/FullEnrich/HarvestAPI ~$0.10/lead) inutilement.
      if (entreprise.procedure_collective_en_cours === true) {
        await db.lead.updateMany({
          where: { triggerId: t.id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        await db.trigger.update({
          where: { id: t.id },
          data: {
            deletedAt: new Date(),
            ignoredAt: new Date(),
            ignoredReason: "q2-gate-insolvency-pre-lead",
          },
        });
        stats.skipped += 1;
        console.log(
          `[Q2 insolvency-gate] ${t.id} (${t.sourceCode}) siren=${t.companySiret} → ARCHIVED (RJ/LJ en cours)`,
        );
        continue;
      }

      const updates: {
        companyNaf?: string;
        size?: string;
        industry?: string;
        region?: string;
      } = {};
      if (!t.companyNaf && entreprise.code_naf) {
        updates.companyNaf = entreprise.code_naf;
      }
      // Bug DiXiO (11/05/2026) — ne PAS écraser un effectif numérique TheirStack
      // (`size` = "42") par une tranche Pappers ("01" = 1-2 salariés). Le cas
      // typique : groupe étranger 42p + SIREN FR coquille 1-2p. La tranche
      // Pappers est la vérité légale du SIREN, mais l'effectif TheirStack
      // reflète le groupe (= la cible de recrutement réelle).
      const sizeAlreadyNumeric = t.size ? /^\d+$/.test(t.size) : false;
      if (!t.size && entreprise.tranche_effectif) {
        updates.size = entreprise.tranche_effectif;
      } else if (sizeAlreadyNumeric && entreprise.tranche_effectif) {
        // Trigger size = "42", Pappers tranche = "01" → on conserve "42" mais
        // on garde une trace de la divergence pour le brief Opus (signal
        // coquille étrangère : "DiXiO global 42p / DiXiO FR 1-2p").
        const numeric = parseInt(t.size!, 10);
        const lowTranches = ["00", "01", "02", "03"];
        if (numeric >= 11 && lowTranches.includes(entreprise.tranche_effectif.trim())) {
          console.log(
            `[theirstack-enrich coquille] ${t.companyName} (${t.companySiret}) — TheirStack=${numeric}p vs Pappers tranche=${entreprise.tranche_effectif} → coquille FR détectée, on garde TheirStack`,
          );
        }
      }
      if (!t.industry && entreprise.libelle_code_naf) {
        updates.industry = entreprise.libelle_code_naf;
      }
      if (!t.region && entreprise.siege?.region) {
        updates.region = entreprise.siege.region;
      }
      if (Object.keys(updates).length > 0) {
        await db.trigger.update({
          where: { id: t.id },
          data: updates,
        });
        stats.enriched += 1;
        console.log(
          `[A3 enrich-incomplete] ${t.id} (${t.sourceCode}) siren=${t.companySiret} → ` +
            Object.keys(updates).join("+"),
        );
      } else {
        stats.skipped += 1;
      }

      // Sprint Perfection P1 (08/05) — Tagger les Leads du trigger avec
      // enrichedAt + données financières Pappers. Idempotent (skip si <24h).
      // Bénéfice : le judge Opus reçoit companyRevenue/ResultNet/Depots/Etabs
      // sur 80%+ des leads au lieu de 22% pre-fix.
      await markLeadEnrichedFromPappers(t.id, entreprise).catch((e) => {
        console.warn(
          `[lead-enrichment-tagging] ${t.id} err :`,
          e instanceof Error ? e.message : e,
        );
      });
    } catch {
      stats.errors += 1;
    }
  }

  // Cleanup post-enrichissement : supprimer triggers avec NAF non-tech.
  // Whitelist NAF tech : 58.29* (édition logiciels), 62.0* (services info),
  // 63.* (traitement données), 70.22Z (conseil affaires).
  // 71.12B (ingénierie industrielle) RETIRÉ 04/05 — laissait passer B-HIVE,
  // CTS Consulting (aérospatial), TechnicAtome, Ekium, Nepsen, Sophia Engineering,
  // SETELIA, Klanik, INGELIANCE etc. = ESN industrielles hors ICP DTL Tech/SaaS.
  // Déclenche uniquement si l'ICP du client a `industries` qui ressemble à tech/SaaS.
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { icp: true },
  });
  const icp = (client?.icp ?? {}) as { industries?: string[] };
  const isTechIcp = (icp.industries ?? []).some((i) =>
    /saas|logiciel|tech|esn|ssii|software|it/i.test(i),
  );
  if (!isTechIcp) return stats;

  const techNafPrefixes = ["58.29", "62.0", "62.01", "62.02", "62.03", "63.1", "63.99", "70.22"];
  // Sources fiables : on EXEMPTE du pruning NAF strict.
  // Rodz fundraising = la boîte a levé, c'est qualifié à la source.
  // BODACC capital_increase = augmentation de capital officielle.
  // Pour ces sources, le NAF Pappers peut être trompeur (holding, classement
  // historique) mais la pertinence est garantie. Le score Opus filtrera plus tard.
  const TRUSTED_SOURCES = [
    "rodz.fundraising",
    "rodz.mergers-acquisitions",
    "rodz.job-changes",
    "bodacc.capital-increase",
    "trigger-engine.funding-recent",
  ];
  const recentTriggers = await db.trigger.findMany({
    where: {
      clientId,
      companyNaf: { not: null },
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: { id: true, companyName: true, companyNaf: true, sourceCode: true },
  });
  for (const t of recentTriggers) {
    if (!t.companyNaf) continue;
    if (TRUSTED_SOURCES.includes(t.sourceCode)) continue;
    const isTech = techNafPrefixes.some((p) => t.companyNaf!.startsWith(p));
    if (!isTech) {
      await db.trigger.update({
        where: { id: t.id },
        data: { deletedAt: new Date() },
      });
      stats.pruned += 1;
    }
  }

  return stats;
}
