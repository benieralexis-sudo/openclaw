import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pappersStats } from "@/lib/pappers";
import { promises as fs } from "fs";
import path from "path";

/**
 * GET /api/internal/health
 *
 * P24 (Vague 3 perfection 100%) — healthcheck exhaustif protege.
 *
 * Difference avec /api/health/deep (public, monitoring 5min) :
 *  - 11 composants (vs 4)
 *  - audit budget Anthropic 24h (lit /tmp/anthropic-burn-state.json)
 *  - audit briefV2 coverage + Pappers enrichment rate
 *  - audit lastBackup (filesystem)
 *  - audit configuration des 4 cles API critiques
 *  - protege par CRON_SECRET (eviter exposition publique des metriques internes)
 */

interface ComponentStatus {
  ok: boolean;
  status: "up" | "degraded" | "down";
  message?: string;
  details?: Record<string, unknown>;
}

const BACKUP_DIR = "/opt/moltbot/backups";
const ANTHROPIC_BURN_STATE = "/tmp/anthropic-burn-state.json";
const BUDGET_THRESHOLD_USD = 5;

async function checkDb(): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const ms = Date.now() - start;
    if (ms > 500) return { ok: false, status: "degraded", message: `DB ${ms}ms > 500ms`, details: { latencyMs: ms } };
    return { ok: true, status: "up", details: { latencyMs: ms } };
  } catch (e) {
    return { ok: false, status: "down", message: e instanceof Error ? e.message : String(e) };
  }
}

function checkConfig(name: string, envVar: string): ComponentStatus {
  const v = process.env[envVar];
  if (!v || v.length < 5) {
    return { ok: false, status: "down", message: `${envVar} missing or too short` };
  }
  return { ok: true, status: "up", details: { envVar, configured: true } };
}

async function checkLastCronRun(): Promise<ComponentStatus> {
  try {
    const last = await db.lead.findFirst({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    if (!last) return { ok: true, status: "up", message: "DB vide" };
    const ageMin = Math.floor((Date.now() - last.updatedAt.getTime()) / 60_000);
    if (ageMin > 180) return { ok: false, status: "down", message: `${ageMin}min sans run`, details: { ageMin } };
    if (ageMin > 90) return { ok: false, status: "degraded", message: `${ageMin}min sans run`, details: { ageMin } };
    return { ok: true, status: "up", details: { ageMin } };
  } catch (e) {
    return { ok: false, status: "down", message: e instanceof Error ? e.message : String(e) };
  }
}

async function checkLastBackup(): Promise<ComponentStatus> {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const backups = files.filter((f) => f.endsWith(".tar.gz.gpg"));
    if (backups.length === 0) return { ok: false, status: "down", message: "aucun .tar.gz.gpg" };
    let latestMtime = 0;
    let latestName = "";
    for (const f of backups) {
      const st = await fs.stat(path.join(BACKUP_DIR, f));
      if (st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latestName = f;
      }
    }
    const ageHours = Math.floor((Date.now() - latestMtime) / 3_600_000);
    if (ageHours > 25) return { ok: false, status: "down", message: `dernier backup ${ageHours}h`, details: { ageHours, latestName } };
    return { ok: true, status: "up", details: { ageHours, latestName } };
  } catch (e) {
    return { ok: false, status: "degraded", message: e instanceof Error ? e.message : String(e) };
  }
}

async function checkBriefV2Coverage(): Promise<ComponentStatus> {
  // V2 ne tourne PAS sur les pre-Opus rejects (qualifyTrigger return early
  // avant qualifyTriggerV2Shadow). Donc le denominateur correct = triggers
  // post-Opus (scoreReason ne commence pas par "[C4-C5 pre-opus-reject").
  // Sans ce filtre on aurait artificiellement un faible % et on alerterait
  // a tort.
  try {
    const rows = await db.$queryRawUnsafe<Array<{ total: bigint; with_v2: bigint }>>(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE "briefV2Json" IS NOT NULL) AS with_v2
      FROM "Trigger"
      WHERE "capturedAt" > NOW() - INTERVAL '24 hours'
        AND "deletedAt" IS NULL
        AND "scoreReason" IS NOT NULL
        AND "scoreReason" NOT LIKE '[C4-C5 pre-opus-reject%'
    `);
    const total = Number(rows[0]?.total ?? 0n);
    const withV2 = Number(rows[0]?.with_v2 ?? 0n);
    if (total === 0) return { ok: true, status: "up", message: "0 trigger post-Opus 24h", details: { total } };
    const pct = Math.round((withV2 / total) * 100);
    if (pct < 50) return { ok: false, status: "down", message: `briefV2 ${pct}% < 50%`, details: { pct, withV2, total } };
    if (pct < 80) return { ok: false, status: "degraded", message: `briefV2 ${pct}% < 80%`, details: { pct, withV2, total } };
    return { ok: true, status: "up", details: { pct, withV2, total } };
  } catch (e) {
    return { ok: false, status: "degraded", message: e instanceof Error ? e.message : String(e) };
  }
}

async function checkV2Quality(): Promise<ComponentStatus> {
  // Audit qualite V2 sur 7 derniers jours :
  //   - distribution verdicts (OUI/NON/ENRICH)
  //   - count overrides V2-NON appliques (status IGNORED + scoreReason
  //     commencant par [V2-override:NON ou [V2-NON)
  //   - last brief V2 ecrit (proxy pour "shadow-v2 tourne ?")
  // Pas de check Zod/strict pass-rate ici (necessite parser tous les briefs,
  // trop lourd pour healthcheck) — voir scripts/audit-v2-validator-NN.ts.
  try {
    const rows = await db.$queryRawUnsafe<Array<{
      verdict: string | null;
      n: bigint;
    }>>(`
      SELECT "briefV2Json"->>'verdict' AS verdict, COUNT(*) AS n
      FROM "Trigger"
      WHERE "capturedAt" > NOW() - INTERVAL '7 days'
        AND "deletedAt" IS NULL
        AND "briefV2Json" IS NOT NULL
      GROUP BY 1
    `);
    const verdicts: Record<string, number> = { OUI: 0, NON: 0, ENRICH: 0 };
    let totalV2 = 0;
    for (const r of rows) {
      const v = r.verdict ?? "?";
      const n = Number(r.n);
      if (v in verdicts) verdicts[v] = n;
      totalV2 += n;
    }

    const overrideRows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`
      SELECT COUNT(*) AS n
      FROM "Trigger"
      WHERE "capturedAt" > NOW() - INTERVAL '7 days'
        AND "deletedAt" IS NULL
        AND "scoreReason" LIKE '[V2-%'
    `);
    const overridesApplied = Number(overrideRows[0]?.n ?? 0n);

    const lastRows = await db.$queryRawUnsafe<Array<{ last_at: Date | null }>>(`
      SELECT MAX("updatedAt") AS last_at
      FROM "Trigger"
      WHERE "deletedAt" IS NULL AND "briefV2Json" IS NOT NULL
    `);
    const lastV2At = lastRows[0]?.last_at ?? null;
    const lastV2AgeHours = lastV2At ? Math.floor((Date.now() - lastV2At.getTime()) / 3_600_000) : null;

    const details = {
      totalV2_7d: totalV2,
      verdicts,
      overridesApplied,
      lastV2AgeHours,
    };

    if (totalV2 === 0) return { ok: true, status: "degraded", message: "0 brief V2 sur 7j (cron OFF ou bug shadow-v2)", details };
    return { ok: true, status: "up", details };
  } catch (e) {
    return { ok: false, status: "degraded", message: e instanceof Error ? e.message : String(e) };
  }
}

async function checkPappersEnrichmentRate(): Promise<ComponentStatus> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3_600_000);
    const total = await db.lead.count({ where: { createdAt: { gte: since }, deletedAt: null } });
    if (total === 0) return { ok: true, status: "up", message: "0 lead 7j", details: { total } };
    const enriched = await db.lead.count({
      where: { createdAt: { gte: since }, deletedAt: null, enrichedAt: { not: null } },
    });
    const pct = Math.round((enriched / total) * 100);
    if (pct < 40) return { ok: false, status: "degraded", message: `Pappers enrich ${pct}% < 40%`, details: { pct, enriched, total } };
    return { ok: true, status: "up", details: { pct, enriched, total } };
  } catch (e) {
    return { ok: false, status: "degraded", message: e instanceof Error ? e.message : String(e) };
  }
}

async function checkAnthropicBurn(): Promise<ComponentStatus> {
  try {
    const raw = await fs.readFile(ANTHROPIC_BURN_STATE, "utf-8");
    const state = JSON.parse(raw) as { total_cost_usd?: number; epoch?: number; log_size?: number };
    const totalUsd = state.total_cost_usd ?? 0;
    const ageH = state.epoch ? Math.floor((Date.now() / 1000 - state.epoch) / 3600) : -1;
    return {
      ok: true,
      status: "up",
      message: "voir /tmp/anthropic-burn-state.json",
      details: { totalCumulatedUsd: totalUsd, baselineAgeHours: ageH, threshold: BUDGET_THRESHOLD_USD },
    };
  } catch {
    return { ok: true, status: "degraded", message: "burn state pas encore initialise (cron run-pollers OFF)" };
  }
}

function checkPappersClient(): ComponentStatus {
  const success = pappersStats.apiCallsSuccess;
  const errors = pappersStats.apiCallsError;
  const total = success + errors;
  if (total === 0) return { ok: true, status: "up", message: "no calls yet", details: { success, errors } };
  const errorRate = errors / total;
  if (errorRate > 0.2) {
    return { ok: false, status: "degraded", message: `error rate ${Math.round(errorRate * 100)}%`, details: { success, errors } };
  }
  return { ok: true, status: "up", details: { success, errors, cacheHits: pappersStats.cacheHits, cacheMisses: pappersStats.cacheMisses } };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [
    database,
    lastCronRun,
    lastBackup,
    briefV2Coverage,
    v2Quality,
    pappersEnrichRate,
    anthropicBurn,
    pappersClient,
  ] = await Promise.all([
    checkDb(),
    checkLastCronRun(),
    checkLastBackup(),
    checkBriefV2Coverage(),
    checkV2Quality(),
    checkPappersEnrichmentRate(),
    checkAnthropicBurn(),
    Promise.resolve(checkPappersClient()),
  ]);

  const checks: Record<string, ComponentStatus> = {
    database,
    anthropicConfig: checkConfig("anthropic", "ANTHROPIC_API_KEY"),
    apifyConfig: checkConfig("apify", "APIFY_API_TOKEN"),
    theirstackConfig: checkConfig("theirstack", "THEIRSTACK_API_TOKEN"),
    rodzConfig: checkConfig("rodz", "RODZ_API_KEY"),
    lastCronRun,
    lastBackup,
    briefV2Coverage,
    v2Quality,
    pappersEnrichmentRate: pappersEnrichRate,
    anthropicBurn,
    pappersClient,
  };

  let overall: "green" | "yellow" | "red" = "green";
  for (const c of Object.values(checks)) {
    if (c.status === "down") {
      overall = "red";
      break;
    }
    if (c.status === "degraded" && overall === "green") overall = "yellow";
  }

  const httpStatus = overall === "red" ? 503 : 200;
  return NextResponse.json(
    { overall, generatedAt: new Date().toISOString(), checks },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST() {
  return NextResponse.json({ method: "GET required with x-cron-secret header" }, { status: 405 });
}
