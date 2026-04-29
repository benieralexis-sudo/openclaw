import "server-only";

/**
 * FullEnrich API client (waterfall enrichment 20+ providers)
 * ──────────────────────────────────────────────────────────
 *
 * Compte créé 29/04/2026 (1c3ca82e-...), 50 credits free trial puis
 * Starter 29€/mo (500 credits) ou Pro 55€/mo (1000 credits).
 *
 * Pricing :
 *   - Work email      : 1 credit (~0.058€ Starter, ~0.055€ Pro)
 *   - Mobile phone    : 10 credits (~0.55€ Starter)
 *   - Personal email  : 3 credits
 *   - Reverse lookup  : 1 credit
 *   - Person/Company  : gratuit en bonus, 0.25 credit en standalone
 *
 * Modèle "credits déduits SEULEMENT si succès" — pas de gaspillage.
 *
 * Architecture : waterfall sur 20+ providers (Dropcontact + Hunter +
 * Apollo + Anymail Finder + Findymail + Kaspr + Datagma + Lusha + ...)
 * → si un provider échoue, le suivant tente. Chargé seulement à la fin.
 *
 * Doc : docs.fullenrich.com (POST /contact/enrich/bulk + GET pour polling).
 *
 * Conformité RGPD : société française basée en SF/FR, providers audités
 * pour CCPA/GDPR. Pas de DB de contacts stockée chez eux (pass-through).
 */

const BASE_URL = process.env.FULLENRICH_API_BASE ?? "https://app.fullenrich.com/api/v1";

function getApiKey(): string {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key) throw new Error("FULLENRICH_API_KEY non configuré");
  return key;
}

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type EnrichField = "contact.emails" | "contact.work_emails" | "contact.personal_emails" | "contact.phones";

export interface FullEnrichInput {
  firstname?: string;
  lastname?: string;
  company_name?: string;
  /** LinkedIn URL profile (optionnel mais améliore beaucoup le hit rate) */
  linkedin_url?: string;
  /** Domain entreprise (pour fallback email pattern) */
  domain?: string;
  /** Champs à enrichir — par défaut emails + phones */
  enrich_fields?: EnrichField[];
  /** Contexte custom passé en clair pour debug (custom field) */
  custom?: { leadId?: string };
}

export type EnrichmentStatus =
  | "PENDING"
  | "PROCESSING"
  | "FINISHED"
  | "FAILED"
  | "CREDITS_INSUFFICIENT";

export interface ContactEmailEntry {
  email: string;
  status?: "VALID" | "INVALID" | "RISKY" | "UNKNOWN" | string;
  source?: string;
  is_catch_all?: boolean;
}

export interface ContactPhoneEntry {
  phone: string;
  source?: string;
  is_mobile?: boolean;
  country?: string;
}

export interface FullEnrichContact {
  firstname?: string;
  lastname?: string;
  domain?: string;
  most_probable_email?: string;
  most_probable_email_status?: string;
  most_probable_personal_email?: string;
  most_probable_personal_email_status?: string;
  most_probable_phone?: string;
  emails?: ContactEmailEntry[];
  personal_emails?: ContactEmailEntry[];
  phones?: ContactPhoneEntry[];
  social_medias?: Array<{ type?: string; url?: string }>;
}

export interface FullEnrichDataItem {
  contact?: FullEnrichContact;
  /** L'input renvoyé tel quel + custom context */
  custom?: { leadId?: string };
}

export interface FullEnrichBulkResult {
  id: string;
  name?: string;
  status: EnrichmentStatus;
  datas: FullEnrichDataItem[];
  cost?: { credits: number };
}

export class FullEnrichError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "FullEnrichError";
  }
}

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

async function feFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const key = getApiKey();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const code = (body as { code?: string })?.code ?? `HTTP_${res.status}`;
    const msg = (body as { message?: string })?.message ?? text.slice(0, 200);
    throw new FullEnrichError(res.status, code, msg);
  }
  return body as T;
}

// ──────────────────────────────────────────────────────────────────────
// Bulk enrichment
// ──────────────────────────────────────────────────────────────────────

/**
 * Lance un bulk enrichment FullEnrich. Retourne l'ID à poller.
 * Capacité recommandée : 1-100 contacts par bulk.
 */
export async function enrichBulk(args: {
  name?: string;
  /** Webhook URL — si fourni, FullEnrich POSTera le résultat dès dispo */
  webhook_url?: string;
  datas: FullEnrichInput[];
}): Promise<{ enrichment_id: string }> {
  // Normalise enrich_fields par défaut
  const datas = args.datas.map((d) => ({
    ...d,
    enrich_fields: d.enrich_fields ?? ["contact.emails", "contact.phones"],
  }));
  return feFetch<{ enrichment_id: string }>("/contact/enrich/bulk", {
    method: "POST",
    body: JSON.stringify({
      name: args.name,
      ...(args.webhook_url ? { webhook_url: args.webhook_url } : {}),
      datas,
    }),
  });
}

/**
 * Récupère le résultat d'un bulk enrichment.
 * Statuts : PENDING / PROCESSING / FINISHED / FAILED / CREDITS_INSUFFICIENT.
 */
export async function getBulkResult(id: string): Promise<FullEnrichBulkResult> {
  return feFetch<FullEnrichBulkResult>(`/contact/enrich/bulk/${id}`);
}

/**
 * Polling pratique : attend que le bulk soit FINISHED ou statut terminal.
 * Timeout par défaut : 90s (typiquement 5-30s en pratique).
 */
export async function waitForBulk(
  id: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<FullEnrichBulkResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollIntervalMs ?? 3_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const r = await getBulkResult(id);
    if (r.status === "FINISHED" || r.status === "FAILED" || r.status === "CREDITS_INSUFFICIENT") {
      return r;
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
  throw new FullEnrichError(0, "POLL_TIMEOUT", `Bulk ${id} pas FINISHED après ${timeoutMs}ms`);
}

// ──────────────────────────────────────────────────────────────────────
// Helpers extraction du meilleur email/phone d'un résultat
// ──────────────────────────────────────────────────────────────────────

export function pickBestEmail(c: FullEnrichContact | undefined): string | null {
  if (!c) return null;
  // Priorité : most_probable VALID > emails[] VALID > most_probable autre
  if (c.most_probable_email && /^valid$/i.test(c.most_probable_email_status ?? "")) {
    return c.most_probable_email;
  }
  const validEmail = c.emails?.find((e) => /^valid$/i.test(e.status ?? ""));
  if (validEmail) return validEmail.email;
  if (c.most_probable_email) return c.most_probable_email;
  return c.emails?.[0]?.email ?? null;
}

export function pickBestPhone(c: FullEnrichContact | undefined): string | null {
  if (!c) return null;
  // Priorité : most_probable > phones[] mobile FR > phones[] autre
  if (c.most_probable_phone) return c.most_probable_phone;
  const frMobile = c.phones?.find((p) => p.is_mobile && (p.country === "FR" || p.phone?.startsWith("+33")));
  if (frMobile) return frMobile.phone;
  return c.phones?.[0]?.phone ?? null;
}

export function pickBestPersonalEmail(c: FullEnrichContact | undefined): string | null {
  if (!c) return null;
  if (c.most_probable_personal_email && /^valid$/i.test(c.most_probable_personal_email_status ?? "")) {
    return c.most_probable_personal_email;
  }
  return c.personal_emails?.find((e) => /^valid$/i.test(e.status ?? ""))?.email
    ?? c.most_probable_personal_email
    ?? c.personal_emails?.[0]?.email
    ?? null;
}
