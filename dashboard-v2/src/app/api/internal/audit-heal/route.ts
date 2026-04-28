import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditAndHeal } from "@/lib/audit-heal";
import { mergeLeadsBySiret } from "@/lib/lead-cross-source";

// POST /api/internal/audit-heal — déclenchable à la main pour rattrapage
// massif. Protégé par CRON_SECRET. Idempotent : safe à relancer.
//
// Lance, pour chaque client (ou un seul si clientId fourni) :
//   1. auditAndHeal() — backfill Lead depuis Trigger.rawPayload (poster Apify,
//      hiring_team TheirStack, decision_makers, contact Rodz)
//   2. mergeLeadsBySiret() — propage LinkedIn/email/phone/firstName/lastName
//      entre Leads de la même boîte issus de sources différentes
//
// Query params :
//   - clientId=xxx (optionnel, sinon tous clients actifs)
//   - skipMerge=true (skip mergeLeadsBySiret, ne fait que auditAndHeal)

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const skipMerge = url.searchParams.get("skipMerge") === "true";

  const heal = await auditAndHeal({ clientId });

  let mergedPerClient: Array<{ clientId: string; clientName: string; merged: unknown }> = [];
  if (!skipMerge) {
    const clients = clientId
      ? await db.client.findMany({
          where: { id: clientId, deletedAt: null },
          select: { id: true, name: true },
        })
      : await db.client.findMany({
          where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } },
          select: { id: true, name: true },
        });

    for (const c of clients) {
      try {
        const merged = await mergeLeadsBySiret(c.id);
        mergedPerClient.push({ clientId: c.id, clientName: c.name, merged });
      } catch (e) {
        mergedPerClient.push({
          clientId: c.id,
          clientName: c.name,
          merged: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    heal,
    crossSourceMerge: skipMerge ? "skipped" : mergedPerClient,
  });
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" });
}
