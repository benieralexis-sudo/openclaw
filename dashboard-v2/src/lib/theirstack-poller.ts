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
import { searchJobs, searchCompanies, type JobResult, type JobSearchFilters, type CompanyResult } from "@/lib/theirstack";
import { attributeSirene } from "@/lib/pappers";

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
    size: null,
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

  const icp = client.icp as ClientIcpExtended;
  const sizeRange = rangeForSizes(icp.sizes);
  const tsIndustries = mapIndustries(icp.industries);
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());
  const hiringKeywords = icp.keywordsHiring ?? [];
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
        // Skip si nom de boîte avec suffixe légal étranger (GmbH, LLC, Ltd, Inc)
        if (/\b(GmbH|LLC|Ltd|Inc|Pty|S\.r\.l\.|S\.A\.R\.L\. España)\b/i.test(job.company)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Skip si location contient marqueur non-FR
        const loc = `${job.long_location ?? ""} ${job.short_location ?? ""}`.toLowerCase();
        if (/\b(us|usa|united states|united kingdom|germany|spain|italy|netherlands|belgium)\b/i.test(loc)) {
          result.jobsSkipped += 1;
          continue;
        }
        // Anti-doublons
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
  // 2) Companies : match ICP firmographic
  //
  // Désactivé 27/04/2026 : trop bruité (Leclerc, plateformes RH, assoc).
  // searchCompanies remonte des entreprises matchant l'ICP firmographique
  // mais SANS signal d'achat (pas de hire récent, pas de levée). Score 6
  // par défaut → pollue le dashboard sans valeur. Réactiver uniquement si
  // searchJobs ne suffit pas.
  // ────────────────────────────────────────────────────────────────────
  // (bloc supprimé — voir git history pour réactivation)

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Helper post-poll : enrichissement Pappers SIRENE pour les triggers
// récents qui n'ont pas de SIRET (nécessite Pappers)
// ──────────────────────────────────────────────────────────────────────

export async function enrichRecentTriggersWithSirene(
  clientId: string,
  options: { limit?: number } = {},
): Promise<{ enriched: number; skipped: number; errors: number; pruned?: number }> {
  const limit = options.limit ?? 20;
  const since = new Date();
  since.setHours(since.getHours() - 24);

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
      await db.trigger.update({
        where: { id: t.id },
        data: {
          companySiret: result.siren,
          companyNaf: result.code_naf ?? null,
        },
      });
      stats.enriched += 1;
    } catch {
      stats.errors += 1;
    }
  }

  // Cleanup post-enrichissement : supprimer triggers avec NAF non-tech.
  // Whitelist NAF tech : 58.29* (édition logiciels), 62.0* (services info),
  // 63.* (traitement données), 70.22Z (conseil affaires), 71.12B (ingénierie).
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

  const techNafPrefixes = ["58.29", "62.0", "62.01", "62.02", "62.03", "63.1", "63.99", "70.22", "71.12B"];
  const recentTriggers = await db.trigger.findMany({
    where: {
      clientId,
      companyNaf: { not: null },
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: { id: true, companyName: true, companyNaf: true },
  });
  for (const t of recentTriggers) {
    if (!t.companyNaf) continue;
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
