import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollTheirstackForClient, enrichRecentTriggersWithSirene } from "@/lib/theirstack-poller";
import { pollApifyForClient } from "@/lib/apify-poller";
import { qualifyPendingTriggers } from "@/lib/qualify-trigger";
import { detectCombosForClient } from "@/lib/combo-detector";

/**
 * Route cron interne — déclenche TheirStack + Apify pour tous les clients actifs
 * avec ICP. Protégée par header `x-cron-secret` (env CRON_SECRET).
 *
 * Appelée par le bot trigger-engine (gateway/telegram-router) toutes les 6h.
 *
 * Query params :
 *   - source=theirstack|apify|all (défaut: all)
 *   - clientId=xxx (défaut: tous les clients actifs avec ICP)
 *   - dryRun=true|false
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "all";
  const targetClientId = url.searchParams.get("clientId");
  const dryRun = url.searchParams.get("dryRun") === "true";

  const clients = targetClientId
    ? await db.client.findMany({ where: { id: targetClientId, deletedAt: null }, select: { id: true, name: true, icp: true } })
    : await db.client.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } }, select: { id: true, name: true, icp: true } });

  const summary: Array<{ client: string; theirstack?: unknown; apify?: unknown; sireneEnriched?: number; opusQualified?: number; error?: string; skipped?: string }> = [];

  for (const c of clients) {
    const entry: { client: string; theirstack?: unknown; apify?: unknown; sireneEnriched?: number; opusQualified?: number; error?: string; skipped?: string } = { client: c.name };
    if (!c.icp) {
      entry.skipped = "no icp";
      summary.push(entry);
      continue;
    }
    try {
      if (source === "all" || source === "theirstack") {
        entry.theirstack = await pollTheirstackForClient(c.id, { dryRun, jobsLimit: 30, companiesLimit: 15 });
        const sirene = await enrichRecentTriggersWithSirene(c.id, { limit: 30 });
        entry.sireneEnriched = sirene.enriched;
      }
      if (source === "all" || source === "apify") {
        entry.apify = await pollApifyForClient(c.id, { dryRun, useFranceJobs: true, useLinkedin: false });
      }
      // Qualify Opus tous les Triggers du client sans scoreReason (limite 30/run pour budget tokens).
      if (!dryRun) {
        const q = await qualifyPendingTriggers(c.id, { limit: 30 });
        entry.opusQualified = q.qualified;
        // Combo detector : flag isCombo=true sur les boîtes avec 2+ sources
        const combo = await detectCombosForClient(c.id);
        (entry as { combos?: unknown }).combos = combo;
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    summary.push(entry);
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), summary });
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" });
}
