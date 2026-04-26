import "server-only";

/**
 * Client typé pour l'API Apify v2 (https://api.apify.com/v2).
 *
 * Auth : Bearer token (APIFY_API_TOKEN, format apify_api_xxxxx).
 * Doc : https://docs.apify.com/api/v2
 *
 * Phase A — intégration générique. Utilisable depuis le dashboard ou
 * le Trigger Engine bot pour lancer n'importe quel Actor (LinkedIn
 * scraper, WTTJ jobs, etc.) à la volée.
 */

const BASE_URL = process.env.APIFY_API_BASE ?? "https://api.apify.com";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type RunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED";

export interface ApifyRun {
  id: string;
  actId: string;
  userId: string;
  status: RunStatus;
  statusMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  defaultDatasetId: string;
  defaultKeyValueStoreId: string;
  defaultRequestQueueId: string;
  buildId: string;
  exitCode: number | null;
  options: {
    build: string;
    timeoutSecs: number;
    memoryMbytes: number;
  };
  stats: {
    inputBodyLen?: number;
    runTimeSecs?: number;
    metamorph?: number;
    computeUnits?: number;
  };
  usage?: {
    ACTOR_COMPUTE_UNITS?: number;
    DATASET_READS?: number;
    DATASET_WRITES?: number;
    PROXY_RESIDENTIAL_TRANSFER_GBYTES?: number;
  };
  usageTotalUsd?: number;
}

export interface ApifyActorListItem {
  id: string;
  userId: string;
  name: string;
  username?: string;
  title?: string;
  description?: string;
  isPublic: boolean;
  createdAt: string;
  modifiedAt: string;
  stats?: {
    totalRuns?: number;
    totalUsers?: number;
  };
}

export interface ApifyUser {
  id: string;
  username: string;
  email: string;
  isPaying: boolean;
  plan: {
    id: string;
    tier: string;
    monthlyBasePriceUsd: number;
    maxActorMemoryGbytes: number;
    maxConcurrentActorRuns: number;
    maxMonthlyUsageUsd: number;
  };
}

export interface ApifyLimits {
  current: {
    monthlyUsageUsd: number;
    monthlyActorComputeUnits: number;
    activeActorJobCount: number;
  };
  limits?: Record<string, number>;
}

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

class ApifyApiError extends Error {
  constructor(
    public status: number,
    public type: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApifyApiError";
  }
}

async function apifyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token || token.startsWith("apify_api_TODO")) {
    throw new Error("APIFY_API_TOKEN non configuré dans .env");
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
        ? (body as { error?: { type?: string; message?: string } }).error
        : null;
    throw new ApifyApiError(
      res.status,
      err?.type ?? "UNKNOWN",
      err?.message ?? `HTTP ${res.status}`,
      body,
    );
  }
  // Apify retourne { data: ... } pour les réponses JSON
  return (body as { data: T }).data ?? (body as T);
}

// ──────────────────────────────────────────────────────────────────────
// Account
// ──────────────────────────────────────────────────────────────────────

export async function getUser(): Promise<ApifyUser> {
  return apifyFetch<ApifyUser>("/v2/users/me");
}

export async function getLimits(): Promise<ApifyLimits> {
  return apifyFetch<ApifyLimits>("/v2/users/me/limits");
}

// ──────────────────────────────────────────────────────────────────────
// Actors — liste + lookup
// ──────────────────────────────────────────────────────────────────────

export async function listActors(): Promise<ApifyActorListItem[]> {
  const res = await apifyFetch<{ items: ApifyActorListItem[] }>(
    "/v2/acts?my=true&limit=100",
  );
  return res.items;
}

/**
 * Convertit "username/actor-name" → "username~actor-name" (format Apify).
 * Si déjà un ID brut (pas de slash), retourne tel quel.
 */
function resolveActorId(actorIdOrName: string): string {
  if (actorIdOrName.includes("/")) {
    return actorIdOrName.replace("/", "~");
  }
  return actorIdOrName;
}

// ──────────────────────────────────────────────────────────────────────
// Runs
// ──────────────────────────────────────────────────────────────────────

export interface RunActorOptions {
  /** Timeout en secondes (par défaut : pas de timeout côté Apify) */
  timeout?: number;
  /** RAM en MB (default = setting de l'actor) */
  memory?: number;
  /** ID du build à utiliser (default = latest) */
  build?: string;
  /** Webhook pour être notifié de la fin */
  webhooks?: Array<{
    eventTypes: Array<"ACTOR.RUN.SUCCEEDED" | "ACTOR.RUN.FAILED" | "ACTOR.RUN.ABORTED">;
    requestUrl: string;
    payloadTemplate?: string;
  }>;
}

/**
 * Lance un actor en mode async. Retourne immédiatement avec l'ID du run.
 * À utiliser pour les gros scrapers (>30s).
 */
export async function runActor(
  actorIdOrName: string,
  input: Record<string, unknown>,
  options: RunActorOptions = {},
): Promise<ApifyRun> {
  const id = resolveActorId(actorIdOrName);
  const qs = new URLSearchParams();
  if (options.timeout) qs.set("timeout", String(options.timeout));
  if (options.memory) qs.set("memory", String(options.memory));
  if (options.build) qs.set("build", options.build);
  if (options.webhooks) {
    qs.set("webhooks", Buffer.from(JSON.stringify(options.webhooks)).toString("base64"));
  }
  return apifyFetch<ApifyRun>(`/v2/acts/${id}/runs?${qs.toString()}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Lance un actor et attend qu'il se termine. Pratique pour les petits
 * scrapers. Retourne le run avec status SUCCEEDED ou throw si FAILED.
 */
export async function runActorSync(
  actorIdOrName: string,
  input: Record<string, unknown>,
  options: RunActorOptions = {},
): Promise<ApifyRun> {
  const id = resolveActorId(actorIdOrName);
  const qs = new URLSearchParams();
  if (options.timeout) qs.set("timeout", String(options.timeout));
  if (options.memory) qs.set("memory", String(options.memory));
  if (options.build) qs.set("build", options.build);
  return apifyFetch<ApifyRun>(`/v2/acts/${id}/run-sync?${qs.toString()}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getRun(runId: string): Promise<ApifyRun> {
  return apifyFetch<ApifyRun>(`/v2/actor-runs/${runId}`);
}

export async function abortRun(runId: string): Promise<ApifyRun> {
  return apifyFetch<ApifyRun>(`/v2/actor-runs/${runId}/abort`, { method: "POST" });
}

/**
 * Helper : poll le run jusqu'à fin (succeeded/failed/aborted).
 * Useful pour des scripts ad-hoc côté CLI.
 */
export async function waitForRun(
  runId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<ApifyRun> {
  const timeout = options.timeoutMs ?? 5 * 60 * 1000;
  const poll = options.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const run = await getRun(runId);
    if (run.status !== "READY" && run.status !== "RUNNING") {
      return run;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(`Apify run ${runId} timeout après ${timeout}ms`);
}

// ──────────────────────────────────────────────────────────────────────
// Datasets — récupération des résultats
// ──────────────────────────────────────────────────────────────────────

export interface DatasetItemsOptions {
  offset?: number;
  limit?: number;
  fields?: string[];
  clean?: boolean;
}

export async function getDatasetItems<T = Record<string, unknown>>(
  datasetId: string,
  options: DatasetItemsOptions = {},
): Promise<T[]> {
  const qs = new URLSearchParams();
  qs.set("format", "json");
  if (options.offset !== undefined) qs.set("offset", String(options.offset));
  if (options.limit !== undefined) qs.set("limit", String(options.limit));
  if (options.fields?.length) qs.set("fields", options.fields.join(","));
  if (options.clean) qs.set("clean", "1");
  // Cet endpoint retourne directement un array (pas wrappé dans { data })
  const token = process.env.APIFY_API_TOKEN;
  const res = await fetch(`${BASE_URL}/v2/datasets/${datasetId}/items?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new ApifyApiError(res.status, "DATASET_ERROR", `HTTP ${res.status}`);
  }
  return (await res.json()) as T[];
}

// ──────────────────────────────────────────────────────────────────────
// Run sync + récupération directe des items (pratique pour scrapers courts)
// ──────────────────────────────────────────────────────────────────────

/**
 * Lance un actor, attend la fin, récupère les items du dataset par défaut.
 * Idéal pour des scrapers <60s qui retournent peu de résultats.
 */
export async function runAndGetItems<T = Record<string, unknown>>(
  actorIdOrName: string,
  input: Record<string, unknown>,
  options: RunActorOptions & { itemsLimit?: number } = {},
): Promise<{ run: ApifyRun; items: T[] }> {
  const run = await runActorSync(actorIdOrName, input, options);
  const items = await getDatasetItems<T>(run.defaultDatasetId, {
    limit: options.itemsLimit ?? 1000,
  });
  return { run, items };
}

export { ApifyApiError };
