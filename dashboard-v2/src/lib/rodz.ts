import "server-only";

/**
 * Client typé pour l'API Rodz (https://api.rodz.io).
 *
 * Auth : Bearer token (RODZ_API_KEY, format USR_xxx).
 * Doc OpenAPI : https://api.rodz.io/openapi.json
 *
 * Phase A — intégration générique. Les signaux sont créés par client
 * via createSignal() avec la webhookUrl pointant vers
 * /api/webhooks/rodz?signalId={rodzSignalId}.
 */

const BASE_URL = process.env.RODZ_API_BASE ?? "https://api.rodz.io";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type RodzSignalType =
  | "fundraising"
  | "mergers-acquisitions"
  | "job-changes"
  | "job-offers"
  | "republished-job-offers"
  | "recruitment-campaign"
  | "company-followers"
  | "company-page-engagement"
  | "social-mentions"
  | "social-reactions"
  | "influencer-engagement"
  | "competitor-relationships"
  | "company-registration"
  | "public-tenders";

export type RodzStatus = "draft" | "active" | "paused";

export interface RodzCredits {
  credits: number;
  companyName: string | null;
}

export interface RodzSignalSummary {
  id: string;
  name: string;
  signalType: RodzSignalType;
  status: RodzStatus;
  webhookUrl: string;
  dailyLeadLimit?: number | null;
  createdAt: string;
  config: Record<string, unknown>;
}

export interface RodzCreateSignalInput {
  name: string;
  webhookUrl: string;
  config: Record<string, unknown>;
  dailyLeadLimit?: number;
  status?: RodzStatus;
}

export interface RodzUpdateSignalInput {
  name?: string;
  webhookUrl?: string;
  config?: Record<string, unknown>;
  dailyLeadLimit?: number | null;
  status?: RodzStatus;
}

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

class RodzApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "RodzApiError";
  }
}

async function rodzFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiKey = process.env.RODZ_API_KEY;
  if (!apiKey || apiKey.startsWith("USR_TODO")) {
    throw new Error("RODZ_API_KEY non configurée dans .env");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const errorObj =
      typeof body === "object" && body && "detail" in body
        ? (body as { detail?: { error?: { code?: string; message?: string } } }).detail?.error
        : null;
    throw new RodzApiError(
      res.status,
      errorObj?.code ?? "UNKNOWN",
      errorObj?.message ?? `HTTP ${res.status}`,
      body,
    );
  }
  return body as T;
}

// ──────────────────────────────────────────────────────────────────────
// Account
// ──────────────────────────────────────────────────────────────────────

export async function getCredits(): Promise<RodzCredits> {
  return rodzFetch<RodzCredits>("/api/v1/account/credits");
}

// ──────────────────────────────────────────────────────────────────────
// Signaux — CRUD
// ──────────────────────────────────────────────────────────────────────

export async function listSignals(): Promise<{
  signals: RodzSignalSummary[];
  total: number;
}> {
  return rodzFetch("/api/v1/signals");
}

export async function getSignal(id: string): Promise<RodzSignalSummary> {
  return rodzFetch(`/api/v1/signals/${id}`);
}

export async function createSignal(
  type: RodzSignalType,
  input: RodzCreateSignalInput,
): Promise<RodzSignalSummary> {
  return rodzFetch(`/api/v1/signals/${type}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSignal(
  id: string,
  input: RodzUpdateSignalInput,
): Promise<RodzSignalSummary> {
  return rodzFetch(`/api/v1/signals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteSignal(id: string): Promise<void> {
  await rodzFetch(`/api/v1/signals/${id}`, { method: "DELETE" });
}

// ──────────────────────────────────────────────────────────────────────
// Personas + enrichissement
// ──────────────────────────────────────────────────────────────────────

export async function listPersonas(): Promise<unknown> {
  return rodzFetch("/api/v1/personas");
}

export async function enrichSirene(siret: string): Promise<unknown> {
  return rodzFetch(
    `/api/v1/enrichment/french-sirene?siret=${encodeURIComponent(siret)}`,
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rodz enrichContact — LE endpoint qui débloque tout
// ──────────────────────────────────────────────────────────────────────
//
// Donne firstName + lastName + companyName → retourne :
//  - linkedInUrl + linkedInId
//  - headline (ex "CTO @ Audion") = jobTitle riche
//  - activeCompany (vrai employeur actuel, pas le RCS Pappers !)
//  - location, country, region, city
//  - skillsList, yearsOfExperience, extractedRole, extractedSeniority
//  - formerCompaniesList, education
//  - companyWebsite (utile pour Hunter pattern email)
//  - extractedGender, isPremium, etc.
//
// C'est l'outil d'enrichissement le plus complet de notre stack — déjà
// payé via abonnement Rodz, jamais branché jusqu'à fin avril 2026.
//
// Cas d'usage : Pappers donne le dirigeant légal (nom RCS) → enrichContact
// résout son LinkedIn + employeur actuel + headline → débloque Kaspr
// downstream et donne aussi l'email pro via le mostProbableEmail.

export interface RodzEnrichedContact {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  name?: string;
  linkedInUrl?: string;
  linkedInId?: string;
  headline?: string;
  activeCompany?: string;
  numberOfCurrentCompanies?: string;
  location?: string;
  country?: string;
  region?: string;
  county?: string;
  city?: string;
  timezone?: string;
  personalWebsite?: string;
  twitter?: string;
  followers?: string;
  isCreator?: boolean;
  isJobSeeker?: boolean;
  isOpenLink?: boolean;
  isRetired?: boolean;
  isPremium?: boolean;
  isVerified?: boolean;
  languages?: string;
  skillsList?: string;
  yearsOfExperience?: string;
  extractedRole?: string;
  extractedSeniority?: string;
  linkedinSummary?: string;
  companyWebsite?: string;
  linkedinSalesLink?: string;
  extractedGender?: string;
  status?: string;
  formerCompaniesList?: string;
  education?: unknown;
}

export interface RodzEnrichContactResponse {
  data?: {
    person?: RodzEnrichedContact;
  };
}

export async function enrichContact(params: {
  linkedinUrl?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}): Promise<RodzEnrichContactResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  return rodzFetch<RodzEnrichContactResponse>(
    `/api/v1/enrichment/contact?${qs.toString()}`,
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rodz findEmail — résolution email avec validation SMTP
// ──────────────────────────────────────────────────────────────────────

export interface RodzFindEmailResponse {
  data?: {
    email?: string | null;
    emailDomain?: string;
    status?: "Valid" | "NotFound" | "Invalid" | "Risky" | string;
    patterns?: string[];
    mxfound?: boolean | null;
    smtpCheck?: boolean | null;
    cachAll?: boolean | null;
    mostProbableEmail?: string[];
    flags?: string[];
    explanation?: string;
    smtpProvider?: string;
    mxRecord?: string;
  };
  requestId?: string;
}

export async function findEmail(params: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<RodzFindEmailResponse> {
  const qs = new URLSearchParams(params as Record<string, string>);
  return rodzFetch<RodzFindEmailResponse>(
    `/api/v1/enrichment/find-email?${qs.toString()}`,
  );
}

export async function enrichFirmographic(domain: string): Promise<unknown> {
  return rodzFetch(
    `/api/v1/enrichment/firmographic?domain=${encodeURIComponent(domain)}`,
  );
}

export { RodzApiError };
