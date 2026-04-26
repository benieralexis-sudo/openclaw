import "server-only";

/**
 * Client typé pour l'API Datagma (https://gateway.datagma.net).
 *
 * Auth : apiId en query string (DATAGMA_API_KEY, format court ~8 chars).
 * Doc : https://datagmaapi.readme.io/reference/
 *
 * Phase 3.A — branché pour enrichissement mobile direct sur les pépites
 * ≥9 du brief Opus (tab "Script call").
 *
 * ⚠️ Au moment du provisionning, le compte a besoin d'une activation
 * manuelle du module phone par le support Datagma. Sans ça, les calls
 * `phoneFull=true` retournent 400/500 "no access".
 */

const BASE_URL = process.env.DATAGMA_API_BASE ?? "https://gateway.datagma.net";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface DatagmaPhone {
  number?: string;
  type?: "mobile" | "landline" | "unknown";
  whatsapp?: boolean;
  source?: string;
  score?: number;
}

export interface DatagmaEmail {
  email: string;
  status?: "valid" | "risky" | "invalid" | "unverified";
  score?: number;
}

export interface DatagmaPerson {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  email?: string;
  emailVerified?: string;
  phone?: string;
  phoneFull?: DatagmaPhone[];
  companyName?: string;
  companyDomain?: string;
}

export interface DatagmaCompany {
  name?: string;
  domain?: string;
  description?: string;
  industry?: string;
  size?: string;
  employeeCount?: number;
  revenue?: string;
  founded?: number;
  country?: string;
  city?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
}

export interface DatagmaFullResponse {
  phone: string | null;
  email: string | null;
  person: DatagmaPerson | null;
  company: DatagmaCompany | null;
  emailV2: DatagmaEmail | null;
  phoneFull: DatagmaPhone[] | null;
  creditBurn: string;
  personFullRealTime: DatagmaPerson | null;
  correlationId: string;
}

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

class DatagmaError extends Error {
  constructor(public status: number, public code: number | string, message: string, public detail?: unknown) {
    super(message);
    this.name = "DatagmaError";
  }
}

async function dgFetch<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const apiId = process.env.DATAGMA_API_KEY;
  if (!apiId) throw new Error("DATAGMA_API_KEY non configuré dans .env");

  const qs = new URLSearchParams({ apiId });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }

  const res = await fetch(`${BASE_URL}${path}?${qs.toString()}`);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = body as { code?: number; message?: string };
    throw new DatagmaError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? `HTTP ${res.status}`,
      body,
    );
  }
  return body as T;
}

// ──────────────────────────────────────────────────────────────────────
// Endpoint principal — /api/ingress/v2/full
// ──────────────────────────────────────────────────────────────────────

/**
 * Codes "data" possibles pour le param `data=` :
 *   - M = include person Match
 *   - A = include person Avatar (LinkedIn URL etc.)
 *   - Y = include company info
 *   - D = include person Description (job title etc.)
 *
 * Combinaison MAYD = personne complète + entreprise.
 */
export type DatagmaDataField = "M" | "A" | "Y" | "D";

export interface FullEnrichmentInput {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  /** Composer les flags ex. ["M","A","Y","D"] → "MAYD" */
  data?: DatagmaDataField[];
  phoneFull?: boolean;
  whatsappCheck?: boolean;
}

export async function enrichPersonFull(
  input: FullEnrichmentInput,
): Promise<DatagmaFullResponse> {
  const dataCode = (input.data ?? ["M", "A", "Y", "D"]).join("");
  return dgFetch<DatagmaFullResponse>("/api/ingress/v2/full", {
    data: dataCode,
    fullName: input.fullName,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    username: input.linkedinUrl, // Datagma appelle ça "username" pour LinkedIn
    companyName: input.companyName,
    domain: input.companyDomain,
    phoneFull: input.phoneFull ? "true" : undefined,
    whatsappCheck: input.whatsappCheck ? "true" : undefined,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Endpoint phone search via email/LinkedIn (route v1/search)
// ──────────────────────────────────────────────────────────────────────

export interface PhoneSearchInput {
  email?: string;
  linkedinUrl?: string;
  minimumMatch?: number;
  whatsappCheck?: boolean;
}

export async function searchPhone(input: PhoneSearchInput): Promise<DatagmaFullResponse> {
  if (!input.email && !input.linkedinUrl) {
    throw new Error("searchPhone : email ou linkedinUrl requis");
  }
  return dgFetch<DatagmaFullResponse>("/api/ingress/v1/search", {
    email: input.email,
    username: input.linkedinUrl,
    minimumMatch: input.minimumMatch ?? 1,
    whatsappCheck: input.whatsappCheck ? "true" : undefined,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Helper : extraire le mobile direct du payload Datagma
// ──────────────────────────────────────────────────────────────────────

export function extractMobile(response: DatagmaFullResponse): string | null {
  if (response.phoneFull?.length) {
    const mobile = response.phoneFull.find((p) => p.type === "mobile") ?? response.phoneFull[0];
    return mobile?.number ?? null;
  }
  if (response.phone) return response.phone;
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Credits monitoring
// ──────────────────────────────────────────────────────────────────────

export async function checkCredits(): Promise<unknown> {
  // Endpoint /credits/check répond 200 mais body vide actuellement.
  // À adapter quand le compte est entièrement provisionné.
  return dgFetch("/credits/check");
}

export { DatagmaError };
