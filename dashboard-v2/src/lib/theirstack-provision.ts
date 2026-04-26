import "server-only";

/**
 * Provisionning des saved_searches TheirStack par client.
 *
 * Phase 3.B — pour un client donné, lit son ICP en DB et crée 2-3
 * saved_searches TheirStack qu'on pourra rejouer en cron quotidien.
 *
 * Coûts indicatifs : 1 cr/job · 3 cr/company.
 */

import { db } from "@/lib/db";
import {
  createSavedSearch,
  listSavedSearches,
  type SavedSearch,
} from "@/lib/theirstack";

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  preferredSignals?: string[];
  antiPersonas?: string[];
  personaTitles?: string[];
  keywordsHiring?: string[];
}

export interface TheirStackProvisionResult {
  clientId: string;
  searchesCreated: SavedSearch[];
  searchesSkipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; error: string }>;
}

interface SearchSpec {
  name: string;
  search_type: "jobs" | "companies";
  filters: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────
// Mapping ICP → filtres TheirStack
// ──────────────────────────────────────────────────────────────────────

function mapCountryCodes(regions: string[] | undefined): string[] {
  if (!regions) return ["FR"];
  // ICP régions de DigitestLab = "France entière", "Paris", ... → FR
  return ["FR"];
}

function mapEmployeeCountRange(sizes: string[] | undefined): {
  gte?: number;
  lte?: number;
} {
  if (!sizes || sizes.length === 0) return {};
  // Map "11-50", "51-200", etc. → range numérique
  const allRanges = sizes.map((s) => {
    if (s === "Self-employed" || s === "1-10") return [1, 10];
    if (s === "11-50") return [11, 50];
    if (s === "51-200") return [51, 200];
    if (s === "201-500") return [201, 500];
    if (s === "501-1000") return [501, 1000];
    if (s === "1001-5000") return [1001, 5000];
    if (s === "5001-10000") return [5001, 10000];
    if (s === "10001+") return [10001, 100000];
    return null;
  }).filter((r): r is [number, number] => r !== null);
  if (allRanges.length === 0) return {};
  const min = Math.min(...allRanges.map((r) => r[0]));
  const max = Math.max(...allRanges.map((r) => r[1]));
  return { gte: min, lte: max };
}

function buildSearches(client: { name: string; icp: ClientIcpExtended }): SearchSpec[] {
  const { name, icp } = client;
  const countryCodes = mapCountryCodes(icp.regions);
  const employees = mapEmployeeCountRange(icp.sizes);
  const hiringKeywords = icp.keywordsHiring ?? [];
  const industries = icp.industries ?? [];
  // TheirStack utilise des intitulés industrie standards Crunchbase/LinkedIn
  // On mappe les ICP libres vers ces standards
  const tsIndustries = industries.flatMap((i) => {
    const lower = i.toLowerCase();
    if (lower.includes("saas") || lower.includes("logiciel") || lower.includes("tech"))
      return ["Software", "Information Technology", "SaaS"];
    if (lower.includes("esn") || lower.includes("ssii") || lower.includes("cabinet it"))
      return ["IT Services", "Information Technology"];
    if (lower.includes("btp") || lower.includes("construction"))
      return ["Construction", "Building Materials"];
    if (lower.includes("logistique"))
      return ["Logistics", "Supply Chain"];
    return [i];
  });

  const searches: SearchSpec[] = [];

  // 1. JOBS — recrutement keywords (signal #1 pour DigitestLab)
  if (hiringKeywords.length > 0) {
    searches.push({
      name: `${name} — Jobs ${hiringKeywords[0]}`,
      search_type: "jobs",
      filters: {
        job_country_code_or: countryCodes,
        job_title_or: hiringKeywords,
        posted_at_max_age_days: 30,
        ...(employees.gte && { min_employee_count: employees.gte }),
        ...(employees.lte && { max_employee_count: employees.lte }),
        ...(tsIndustries.length > 0 && { industry_or: tsIndustries }),
        limit: 50,
      },
    });
  }

  // 2. COMPANIES — boîtes qui matchent l'ICP
  searches.push({
    name: `${name} — Companies ICP`,
    search_type: "companies",
    filters: {
      company_country_code_or: countryCodes,
      ...(tsIndustries.length > 0 && { industry_or: tsIndustries }),
      ...(employees.gte && { min_employee_count: employees.gte }),
      ...(employees.lte && { max_employee_count: employees.lte }),
      limit: 30,
    },
  });

  // 3. JOBS — autres titles persona (CTO, etc.) — signal de re-org
  const personaTitles = icp.personaTitles ?? [];
  if (personaTitles.length > 0) {
    const expandedTitles = personaTitles.flatMap((p) => {
      if (p.toLowerCase().includes("cto")) return ["CTO", "Chief Technology Officer", "VP Engineering"];
      if (p.toLowerCase().includes("ceo") || p.toLowerCase().includes("directeur général"))
        return ["CEO", "Chief Executive Officer", "Managing Director"];
      if (p.toLowerCase().includes("fondateur") || p.toLowerCase().includes("founder"))
        return ["Founder", "Co-Founder"];
      return [p];
    });
    searches.push({
      name: `${name} — Jobs personas (re-orgs)`,
      search_type: "jobs",
      filters: {
        job_country_code_or: countryCodes,
        job_title_or: expandedTitles,
        posted_at_max_age_days: 30,
        ...(employees.gte && { min_employee_count: employees.gte }),
        ...(employees.lte && { max_employee_count: employees.lte }),
        ...(tsIndustries.length > 0 && { industry_or: tsIndustries }),
        limit: 30,
      },
    });
  }

  return searches;
}

// ──────────────────────────────────────────────────────────────────────
// Provisionning
// ──────────────────────────────────────────────────────────────────────

/**
 * NOTE Phase 3.B : l'API saved_searches TheirStack rejette certains champs
 * filtres (min_employee_count, industry_or, etc.) dans le
 * body avec un format spécifique. Au lieu de persister des saved_searches,
 * on utilise les filtres directement via searchJobs/searchCompanies en
 * appels ad-hoc depuis le poller du bot. Ce helper retourne les filtres
 * pour qu'ils soient stockés côté Trigger Engine et rejoués en cron.
 */
export async function provisionTheirstackForClient(
  clientId: string,
  options: { dryRun?: boolean } = {},
): Promise<TheirStackProvisionResult> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, slug: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  const icp = client.icp as ClientIcpExtended;
  const searches = buildSearches({ name: client.name, icp });

  const result: TheirStackProvisionResult = {
    clientId,
    searchesCreated: [],
    searchesSkipped: [],
    errors: [],
  };

  // Skip si une saved_search avec le même nom existe déjà côté TheirStack
  let existingNames = new Set<string>();
  if (!options.dryRun) {
    try {
      const existing = await listSavedSearches();
      existingNames = new Set(existing.map((s) => s.name));
    } catch {
      // Si liste indispo, on continue quand même
    }
  }

  for (const spec of searches) {
    if (existingNames.has(spec.name)) {
      result.searchesSkipped.push({
        name: spec.name,
        reason: "saved_search avec ce nom existe déjà",
      });
      continue;
    }

    if (options.dryRun) {
      result.searchesCreated.push({
        id: `dryrun_${Date.now()}`,
        name: spec.name,
        search_type: spec.search_type,
        filters: spec.filters,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      continue;
    }

    try {
      const created = await createSavedSearch({
        name: spec.name,
        search_type: spec.search_type,
        filters: spec.filters,
      });
      result.searchesCreated.push(created);
    } catch (e) {
      result.errors.push({
        name: spec.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

export async function previewTheirstackProvisioning(
  clientId: string,
): Promise<{
  client: { id: string; name: string };
  searches: SearchSpec[];
}> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  const icp = client.icp as ClientIcpExtended;
  return {
    client: { id: client.id, name: client.name },
    searches: buildSearches({ name: client.name, icp }),
  };
}
