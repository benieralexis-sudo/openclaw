import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateSignal } from "@/lib/rodz";
import { buildSignals, type SignalSpec } from "@/lib/rodz-provision";
import type { Prisma } from "@prisma/client";

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  preferredSignals?: string[];
  antiPersonas?: string[];
  personaTitles?: string[];
  keywordsHiring?: string[];
}

/**
 * Re-synchronise les signaux Rodz existants d'un client avec son ICP courant.
 * Utile après modif des régions / sizes / keywordsHiring : pousse la nouvelle
 * config vers Rodz via PATCH /api/v1/signals/{id} et met à jour DB locale.
 *
 * Protégé par x-cron-secret.
 *
 * Body / Query :
 *   - clientId=xxx (requis)
 *   - dryRun=true|false
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const dryRun = url.searchParams.get("dryRun") === "true";

  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const client = await db.client.findUnique({
    where: { id: clientId, deletedAt: null },
    select: { id: true, name: true, icp: true },
  });
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });
  if (!client.icp) return NextResponse.json({ error: "no icp" }, { status: 400 });

  const icp = client.icp as ClientIcpExtended;
  const expectedSignals = buildSignals({ name: client.name, icp });
  const expectedByType = new Map<string, SignalSpec>(expectedSignals.map((s) => [s.type, s]));

  const existing = await db.rodzSignal.findMany({
    where: { clientId, deletedAt: null },
    select: { id: true, rodzSignalId: true, signalType: true, name: true, status: true },
  });

  const summary: Array<{
    type: string;
    name: string;
    rodzSignalId: string;
    action: "updated" | "no-spec" | "error" | "dry-run";
    error?: string;
  }> = [];

  for (const sig of existing) {
    const spec = expectedByType.get(sig.signalType);
    if (!spec) {
      summary.push({ type: sig.signalType, name: sig.name, rodzSignalId: sig.rodzSignalId, action: "no-spec" });
      continue;
    }
    if (dryRun) {
      summary.push({ type: sig.signalType, name: sig.name, rodzSignalId: sig.rodzSignalId, action: "dry-run" });
      continue;
    }
    try {
      await updateSignal(sig.rodzSignalId, {
        config: spec.config,
        ...(spec.dailyLeadLimit && { dailyLeadLimit: spec.dailyLeadLimit }),
      });
      await db.rodzSignal.update({
        where: { id: sig.id },
        data: {
          config: spec.config as unknown as Prisma.InputJsonValue,
          dailyLeadLimit: spec.dailyLeadLimit ?? null,
          updatedAt: new Date(),
        },
      });
      summary.push({ type: sig.signalType, name: sig.name, rodzSignalId: sig.rodzSignalId, action: "updated" });
    } catch (e) {
      summary.push({
        type: sig.signalType,
        name: sig.name,
        rodzSignalId: sig.rodzSignalId,
        action: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    client: client.name,
    icpRegions: icp.regions,
    summary,
  });
}

export async function GET() {
  return NextResponse.json({ method: "POST required, query ?clientId=xxx[&dryRun=true]" });
}
