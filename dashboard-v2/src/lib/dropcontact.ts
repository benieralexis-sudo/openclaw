import "server-only";

// ═══════════════════════════════════════════════════════════════════
// Dropcontact API wrapper
// Docs: https://docs.dropcontact.com/api
// Plan: Growth 35€/mois, 500 crédits, RGPD-friendly (extraction signature email)
// ═══════════════════════════════════════════════════════════════════

const API_BASE = "https://api.dropcontact.io";

type DropcontactInput = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  website?: string;
  company?: string;
  num_siren?: string;
};

type DropcontactEnriched = {
  email?: Array<{ email: string; qualification?: string }>;
  phone?: string;
  mobile_phone?: string;
  linkedin?: string;
  job?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  website?: string;
  company?: string;
  num_siren?: string;
  num_tva?: string;
};

type BatchResponse =
  | { error: false; success: true; request_id: string; credits_left: number }
  | { error: true; reason: string };

type StatusResponse =
  | { success: true; data: DropcontactEnriched[] }
  | { success: false; reason?: string; error?: boolean };

function getApiKey(): string {
  const key = process.env.DROPCONTACT_API_KEY;
  if (!key) throw new Error("DROPCONTACT_API_KEY missing");
  return key;
}

export async function submitBatch(rows: DropcontactInput[]): Promise<{ requestId: string; creditsLeft: number }> {
  const res = await fetch(`${API_BASE}/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Access-Token": getApiKey(),
    },
    body: JSON.stringify({ data: rows, siren: true, language: "fr" }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as BatchResponse;
  if ("error" in json && json.error) {
    throw new Error(`Dropcontact submitBatch: ${json.reason}`);
  }
  return { requestId: json.request_id, creditsLeft: json.credits_left };
}

export async function pollBatchResult(requestId: string, maxWaitMs = 60_000): Promise<DropcontactEnriched[]> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < maxWaitMs) {
    attempt++;
    // backoff: 3s → 5s → 8s → 12s
    const wait = Math.min(3000 + attempt * 2000, 12_000);
    await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(`${API_BASE}/batch/${requestId}`, {
      method: "GET",
      headers: { "X-Access-Token": getApiKey() },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { data?: DropcontactEnriched[]; reason?: string; error?: boolean };
    if (Array.isArray(json.data)) {
      return json.data;
    }
    // pas encore prêt → continue
  }
  throw new Error(`Dropcontact pollBatchResult: timeout after ${maxWaitMs}ms`);
}

export async function getCreditsLeft(): Promise<number> {
  // Hack : envoie un batch vide-ish pour récupérer credits_left dans la response
  // Note : Dropcontact ne fournit pas d'endpoint /credits dédié sur Growth.
  const probe = await fetch(`${API_BASE}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Access-Token": getApiKey() },
    body: JSON.stringify({ data: [], language: "fr" }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await probe.json()) as { credits_left?: number };
  return json.credits_left ?? -1;
}

export type { DropcontactEnriched, DropcontactInput };
