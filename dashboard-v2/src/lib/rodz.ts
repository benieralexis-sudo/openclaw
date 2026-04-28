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

export async function enrichContact(params: {
  linkedinUrl?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  return rodzFetch(`/api/v1/enrichment/contact?${qs.toString()}`);
}

export async function findEmail(params: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<unknown> {
  const qs = new URLSearchParams(params as Record<string, string>);
  return rodzFetch(`/api/v1/enrichment/find-email?${qs.toString()}`);
}

export async function enrichFirmographic(domain: string): Promise<unknown> {
  return rodzFetch(
    `/api/v1/enrichment/firmographic?domain=${encodeURIComponent(domain)}`,
  );
}

export { RodzApiError };
