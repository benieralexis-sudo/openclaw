import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichLeadsViaKasprDirect } from "@/lib/enrich-via-kaspr-direct";

/**
 * POST /api/internal/enrich-kaspr-direct?clientId=xxx&limit=15
 * Auth: x-cron-secret
 * Lance enrichLeadsViaKasprDirect pour rattraper les leads avec LinkedIn
 * jamais enrichis Kaspr.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const limit = Number(url.searchParams.get("limit") ?? 15);

  const clients = clientId
    ? await db.client.findMany({ where: { id: clientId, deletedAt: null }, select: { id: true, name: true } })
    : await db.client.findMany({
        where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } },
        select: { id: true, name: true },
      });

  const results: Array<{ clientId: string; clientName: string; result: unknown; error?: string }> = [];
  for (const c of clients) {
    try {
      const r = await enrichLeadsViaKasprDirect(c.id, { limit });
      results.push({ clientId: c.id, clientName: c.name, result: r });
    } catch (e) {
      results.push({
        clientId: c.id,
        clientName: c.name,
        result: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret" });
}
