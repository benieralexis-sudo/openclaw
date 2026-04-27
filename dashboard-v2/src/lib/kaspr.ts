// ═══════════════════════════════════════════════════════════════════
// Kaspr — LinkedIn enrichment (email pro + email perso + tel + titre)
// ═══════════════════════════════════════════════════════════════════
// Docs: https://docs.developers.kaspr.io/
// Auth: "authorization: Bearer <KEY>"  (B majuscule obligatoire)
// Base: https://api.developers.kaspr.io
//
// Use case dashboard v2 : un commercial colle une URL LinkedIn dans la fiche
// d'un lead (CTO/DG/Head of QA), Kaspr retourne email pro + tel mobile + titre.
//
// Wrapper TS natif équivalent à /opt/moltbot/skills/trigger-engine/sources/kaspr.js
// (réécrit en TS pour éviter d'importer du CJS depuis Next.js).
// ═══════════════════════════════════════════════════════════════════

const BASE = process.env.KASPR_API_BASE || "https://api.developers.kaspr.io";
const KEY = process.env.KASPR_API_KEY || "";

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "accept-version": "v2.0",
  };
}

// ──────────────────────────────────────────────────────────────────────
// Types Kaspr
// ──────────────────────────────────────────────────────────────────────

export type KasprDataField = "workEmail" | "directEmail" | "phone";

export interface KasprProfile {
  id?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  company?: {
    name?: string;
    domain?: string;
    linkedinId?: string;
  };
  workEmail?: string | { email: string; status?: string };
  workEmails?: Array<string | { email: string; status?: string }>;
  directEmail?: string | { email: string; status?: string };
  directEmails?: Array<string | { email: string; status?: string }>;
  phone?: string | { number: string; type?: string };
  phones?: Array<string | { number: string; type?: string }>;
  linkedinUrl?: string;
  [k: string]: unknown;
}

export interface KasprCreditsHeaders {
  workEmail: string | null;
  directEmail: string | null;
  phone: string | null;
  export: string | null;
}

export interface KasprRemainingCredits {
  workEmailCredits?: number;
  personalEmailCredits?: number;
  phoneCredits?: number;
  exportCredits?: number;
  [k: string]: unknown;
}

export interface KasprEnrichResult {
  ok: boolean;
  profile?: KasprProfile;
  credits?: KasprCreditsHeaders;
  error?: string;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Extrait le LinkedIn ID depuis une URL ou un ID brut.
 * Ex: "https://www.linkedin.com/in/williamhgates/" → "williamhgates"
 *     "williamhgates" → "williamhgates"
 */
export function extractLinkedInId(idOrUrl: string | null | undefined): string | null {
  if (!idOrUrl) return null;
  const s = String(idOrUrl).trim();
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m && m[1] ? m[1] : s.replace(/\/+$/, "") || null;
}

/** Validation côté serveur : URL doit matcher un slug LinkedIn /in/<id> */
export function isValidLinkedInUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return /linkedin\.com\/in\/[^/?#]+/i.test(String(s));
}

/**
 * Normalise une valeur email Kaspr (string ou object) → string | null
 */
export function pickEmail(
  value:
    | string
    | { email: string; status?: string }
    | Array<string | { email: string; status?: string }>
    | null
    | undefined,
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return pickEmail(value[0] ?? null);
  }
  if (typeof value === "string") return value || null;
  if (typeof value === "object" && "email" in value) return value.email || null;
  return null;
}

/**
 * Normalise une valeur phone Kaspr → string | null
 */
export function pickPhone(
  value:
    | string
    | { number: string; type?: string }
    | Array<string | { number: string; type?: string }>
    | null
    | undefined,
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return pickPhone(value[0] ?? null);
  }
  if (typeof value === "string") return value || null;
  if (typeof value === "object" && "number" in value) return value.number || null;
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// API
// ──────────────────────────────────────────────────────────────────────

/**
 * Vérifie que la clé API est valide. Retourne la réponse Kaspr (user) ou null.
 */
export async function verifyKey(): Promise<unknown | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/keys/verifyKey`, { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Récupère le solde des crédits restants (work, personal, phone, export).
 */
export async function getRemainingCredits(): Promise<KasprRemainingCredits | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/keys/remainingCredits`, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as KasprRemainingCredits;
  } catch {
    return null;
  }
}

/**
 * Récupère les rate limits (60/min, 500/h, 500/j par défaut).
 */
export async function getRateLimits(): Promise<unknown | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/keys/rateLimits`, { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Enrichit un profil LinkedIn — coeur du module.
 *
 * @param args.id - LinkedIn ID ou URL complète (ex: "marc-dupont" ou "https://linkedin.com/in/marc-dupont")
 * @param args.name - Nom complet (requis par l'API)
 * @param args.dataToGet - Subset de ['workEmail','directEmail','phone']. Default = tous.
 * @param args.requiredData - Si fourni, l'API ne renvoie un résultat que si ces champs sont présents.
 */
export async function enrichLinkedInProfile(args: {
  id: string;
  name: string;
  dataToGet?: KasprDataField[];
  requiredData?: KasprDataField[];
}): Promise<KasprEnrichResult> {
  if (!KEY) return { ok: false, error: "KASPR_API_KEY missing" };
  if (!args.id || !args.name) return { ok: false, error: "id and name are required" };

  const cleanId = extractLinkedInId(args.id);
  if (!cleanId) return { ok: false, error: "invalid linkedin id" };

  const body: Record<string, unknown> = { id: cleanId, name: args.name };
  if (Array.isArray(args.dataToGet) && args.dataToGet.length) body.dataToGet = args.dataToGet;
  if (Array.isArray(args.requiredData) && args.requiredData.length)
    body.requiredData = args.requiredData;

  let res: Response;
  try {
    res = await fetch(`${BASE}/profile/linkedin`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `network_error: ${(err as Error).message ?? String(err)}`,
    };
  }

  const credits: KasprCreditsHeaders = {
    workEmail: res.headers.get("Remaining-Work-Email-Credits"),
    directEmail: res.headers.get("Remaining-Direct-Email-Credits"),
    phone: res.headers.get("Remaining-Phone-Credits"),
    export: res.headers.get("Remaining-Export-Credits"),
  };

  if (res.status === 402) return { ok: false, error: "no_credits_left", credits };
  if (res.status === 429) return { ok: false, error: "rate_limit_exceeded", credits };
  if (res.status === 404) return { ok: false, error: "profile_not_found", credits };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `http_${res.status}: ${txt.slice(0, 200)}`, credits };
  }

  const data = (await res.json().catch(() => null)) as
    | { profile?: KasprProfile }
    | null;
  if (!data || !data.profile) {
    return { ok: false, error: "profile_not_found", credits };
  }
  return { ok: true, profile: data.profile, credits };
}
