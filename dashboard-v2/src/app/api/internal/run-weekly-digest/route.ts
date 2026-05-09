import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { runWeeklyDigestForAllClients, runWeeklyDigestForClient } from "@/lib/weekly-digest-runner";

/**
 * POST /api/internal/run-weekly-digest
 *
 * Sprint 3 (10/05/2026) — Cron endpoint pour envoi des digests hebdo.
 * Appele par script cron systemd /opt/moltbot/scripts/run-weekly-digest-cron.sh
 * lundi 6h UTC.
 *
 * Auth : x-cron-secret header.
 *
 * Query params :
 *   - clientId (optionnel) : limiter a 1 client (debug). Sinon all clients ACTIVE.
 *   - dryRun (optionnel) : true = build mais pas d'envoi
 *   - force (optionnel) : true = bypass anti-doublon weekKey
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";

  if (clientId) {
    const result = await runWeeklyDigestForClient(clientId, { dryRun, force });
    return NextResponse.json(result);
  }
  const result = await runWeeklyDigestForAllClients({ dryRun });
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" }, { status: 405 });
}
