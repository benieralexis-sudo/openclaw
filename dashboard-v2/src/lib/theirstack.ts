import "server-only";

/**
 * Client typé pour l'API TheirStack v1 (https://api.theirstack.com).
 *
 * Auth : Bearer token (THEIRSTACK_API_TOKEN, JWT ~325 chars).
 * Doc : https://api.theirstack.com/openapi.json
 *
 * Phase A — intégration générique. 3 produits exposés :
 *  1. Jobs API   → POST /v1/jobs/search
 *  2. Companies  → POST /v1/companies/search
 *  3. Buying intents → POST /v1/companies/buying_intents
 *  4. Technographics → POST /v1/companies/technologies
 *
 * Coûts crédits :
 *  - 1 credit par job retourné
 *  - 3 credits par company retournée
 */

const BASE_URL = process.env.THEIRSTACK_API_BASE ?? "https://api.theirstack.com";

// ──────────────────────────────────────────────────────────────────────
// Types — Jobs
// ──────────────────────────────────────────────────────────────────────

export interface JobSearchFilters {
  // Identifiants
  job_id_or?: number[];
  // Titre
  job_title_or?: string[];
  job_title_not?: string[];
  job_title_pattern_or?: string[];
  job_title_pattern_and?: string[];
  job_title_pattern_not?: string[];
  // Pays
  job_country_code_or?: string[];
  job_country_code_not?: string[];
  // Date — au moins UN de ces filtres est OBLIGATOIRE
  posted_at_max_age_days?: number;
  posted_at_gte?: string;
  posted_at_lte?: string;
  discovered_at_max_age_days?: number;
  discovered_at_min_age_days?: number;
  discovered_at_gte?: string;
  discovered_at_lte?: string;
  // Description (full-text)
  job_description_pattern_or?: string[];
  job_description_pattern_and?: string[];
  job_description_pattern_not?: string[];
  job_description_contains_or?: string[];
  // Localisation
  job_location_pattern_or?: string[];
  remote?: boolean;
  hybrid?: boolean;
  // Salaire
  min_salary_usd?: number;
  max_salary_usd?: number;
  // Seniority
  job_seniority_or?: Array<"c_level" | "vp" | "director" | "manager" | "senior" | "mid" | "junior" | "intern">;
  // Entreprise (pour scoper)
  company_name_or?: string[];
  company_name_case_insensitive_or?: string[];
  company_name_partial_match_or?: string[];
  company_domain_or?: string[];
  company_linkedin_url_or?: string[];
  company_country_code_or?: string[];
  // ⚠️ TheirStack utilise industry_or (pas company_industry_or) + min/max_employee_count
  industry_or?: string[];
  industry_not?: string[];
  industry_id_or?: number[];
  min_employee_count?: number;
  max_employee_count?: number;
  // Tech stack (slugs TheirStack — différent de simple noms)
  company_technology_slug_or?: string[];
  company_technology_slug_and?: string[];
  company_technology_slug_not?: string[];
  // Pagination + tri
  limit?: number;
  offset?: number;
  page?: number;
  cursor?: string;
  order_by?: Array<{ field: string; desc?: boolean }>;
  // Résultats
  include_total_results?: boolean;
}

export interface JobResult {
  id: number;
  job_title: string;
  url: string;
  source_url?: string;
  date_posted: string;
  discovered_at: string;
  company: string;
  company_domain?: string | null;
  company_country_code?: string;
  location: string;
  short_location?: string;
  long_location?: string;
  country: string;
  country_code: string;
  remote: boolean;
  hybrid: boolean;
  seniority?: string;
  salary_string?: string | null;
  min_annual_salary_usd?: number | null;
  max_annual_salary_usd?: number | null;
  avg_annual_salary_usd?: number | null;
  employment_statuses?: string[];
  reposted?: boolean;
  date_reposted?: string | null;
  hiring_team?: Array<{ name: string; linkedin_url?: string; title?: string }>;
}

export interface JobSearchResponse {
  metadata: {
    total_results: number | null;
    truncated_results: number;
    truncated_companies: number;
    total_companies: number | null;
  };
  data: JobResult[];
}

// ──────────────────────────────────────────────────────────────────────
// Types — Companies
// ──────────────────────────────────────────────────────────────────────

export interface CompanySearchFilters {
  company_id_or?: number[];
  company_name_or?: string[];
  company_name_partial_match_or?: string[];
  company_domain_or?: string[];
  company_linkedin_url_or?: string[];
  company_country_code_or?: string[];
  company_industry_or?: string[];
  // ⚠️ noms exacts API TheirStack
  min_employee_count?: number;
  max_employee_count?: number;
  industry_or?: string[];
  industry_not?: string[];
  company_technology_slug_or?: string[];
  company_buying_intent_slug_or?: string[];
  // Pagination
  limit?: number;
  offset?: number;
  page?: number;
  cursor?: string;
  include_total_results?: boolean;
}

export interface CompanyResult {
  id: number;
  name: string;
  domain?: string | null;
  linkedin_url?: string | null;
  country?: string;
  country_code?: string;
  industry?: string;
  employee_count?: number | null;
  revenue_usd?: number | null;
  founded?: number | null;
  description?: string | null;
  technologies?: string[];
}

export interface CompanySearchResponse {
  metadata: { total_results: number | null };
  data: CompanyResult[];
}

// ──────────────────────────────────────────────────────────────────────
// Types — Credits
// ──────────────────────────────────────────────────────────────────────

export interface CreditsConsumptionRow {
  period_start: string; // ISO date
  api_credits_consumed: number;
  ui_credits_consumed: number;
}

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

class TheirStackError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "TheirStackError";
  }
}

async function tsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.THEIRSTACK_API_TOKEN;
  if (!token || token.startsWith("THEIRSTACK_TODO")) {
    throw new Error("THEIRSTACK_API_TOKEN non configuré dans .env");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err =
      typeof body === "object" && body && "error" in body
        ? (body as { error?: { code?: string; title?: string; description?: string } }).error
        : null;
    throw new TheirStackError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.description ?? err?.title ?? `HTTP ${res.status}`,
      body,
    );
  }
  return body as T;
}

// ──────────────────────────────────────────────────────────────────────
// Account / credits
// ──────────────────────────────────────────────────────────────────────

/**
 * Retourne la consommation de crédits jour par jour sur les 30 derniers jours.
 * Pour le solde restant : à calculer via le plan + somme api_credits_consumed.
 */
export async function getCreditsConsumption(): Promise<CreditsConsumptionRow[]> {
  return tsFetch<CreditsConsumptionRow[]>("/v0/teams/credits_consumption");
}

// ──────────────────────────────────────────────────────────────────────
// Jobs
// ──────────────────────────────────────────────────────────────────────

/**
 * Recherche d'offres d'emploi.
 *
 * ⚠️ Au moins UN filtre date est OBLIGATOIRE :
 *   posted_at_max_age_days, posted_at_gte/lte, ou un filtre identifiant
 *   (job_id_or, company_name_or, company_id_or, etc.).
 *
 * Coût : 1 credit par job retourné.
 */
export async function searchJobs(
  filters: JobSearchFilters,
): Promise<JobSearchResponse> {
  return tsFetch<JobSearchResponse>("/v1/jobs/search", {
    method: "POST",
    body: JSON.stringify(filters),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Companies
// ──────────────────────────────────────────────────────────────────────

/**
 * Recherche d'entreprises avec filtres ICP.
 * Coût : 3 credits par company retournée.
 */
export async function searchCompanies(
  filters: CompanySearchFilters,
): Promise<CompanySearchResponse> {
  return tsFetch<CompanySearchResponse>("/v1/companies/search", {
    method: "POST",
    body: JSON.stringify(filters),
  });
}

/**
 * Retourne le tech stack des entreprises données.
 * Input : array de company_id ou company_domain.
 * Coût : 3 credits par company.
 */
export async function getCompanyTechnologies(input: {
  company_id_or?: number[];
  company_domain_or?: string[];
  limit?: number;
}): Promise<{ data: Array<{ company_id: number; domain: string; technologies: string[] }> }> {
  return tsFetch("/v1/companies/technologies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Retourne les buying intents (signaux d'achat publics) sur les entreprises.
 * Coût : 3 credits par company.
 */
export async function getCompanyBuyingIntents(input: {
  company_id_or?: number[];
  company_domain_or?: string[];
  buying_intent_or?: string[];
  limit?: number;
}): Promise<{ data: Array<{ company_id: number; domain: string; buying_intents: Array<{ keyword: string; first_seen: string; last_seen: string }> }> }> {
  return tsFetch("/v1/companies/buying_intents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Catalog (gratuit, pas de crédits consommés)
// ──────────────────────────────────────────────────────────────────────

/**
 * Liste les keywords (technologies + buying intents) disponibles pour
 * filtrer dans les recherches.
 */
export async function getCatalogKeywords(): Promise<{ technologies: string[]; buying_intents: string[] }> {
  return tsFetch("/v0/catalog/keywords");
}

// ──────────────────────────────────────────────────────────────────────
// Saved searches & company lists (utiles pour persister les ICP par client)
// ──────────────────────────────────────────────────────────────────────

export interface SavedSearch {
  id: string;
  name: string;
  search_type: "jobs" | "companies";
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  return tsFetch("/v0/saved_searches");
}

export async function createSavedSearch(input: {
  name: string;
  search_type: "jobs" | "companies";
  filters: Record<string, unknown>;
  is_alert_active?: boolean;
}): Promise<SavedSearch> {
  // ⚠️ API TheirStack attend : { name, body: {filters}, type, is_alert_active }
  // (et non pas { search_type, filters })
  return tsFetch("/v0/saved_searches", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      type: input.search_type,
      body: input.filters,
      is_alert_active: input.is_alert_active ?? false,
    }),
  });
}

export interface CompanyList {
  id: string;
  name: string;
  company_count: number;
  created_at: string;
}

export async function listCompanyLists(): Promise<CompanyList[]> {
  return tsFetch("/v0/company_lists");
}

export async function createCompanyList(name: string): Promise<CompanyList> {
  return tsFetch("/v0/company_lists", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export { TheirStackError };
