import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Debug endpoint : reproduit la query /api/triggers SANS auth pour identifier
// si le bug "0 leads dans le dashboard" vient du SQL ou du sérialiseur.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;

  // EXACTE même query que /api/triggers
  const where = {
    deletedAt: null,
    ...(clientId ? { clientId } : {}),
    score: { gte: 6 },
    lead: { isNot: null as null },
  };

  try {
    const triggers = await db.trigger.findMany({
      where,
      orderBy: [
        { isHot: "desc" as const },
        { score: "desc" as const },
        { capturedAt: "desc" as const },
        { lead: { dataQuality: "desc" as const } },
      ],
      take: 10,
      select: {
        id: true,
        companyName: true,
        score: true,
        isHot: true,
        capturedAt: true,
        lead: {
          select: {
            id: true,
            dataQuality: true,
            emailConfidence: true,
            emailSourceCount: true,
            email: true,
            kasprPhone: true,
            phoneFullenrich: true,
            phone: true,
            linkedinUrl: true,
            linkedinSource: true,
            personaTier: true,
            personaSource: true,
            bouncedAt: true,
            doNotContact: true,
            doNotContactReason: true,
            pitchJson: true,
            callBriefJson: true,
            linkedinDmJson: true,
          },
        },
      },
    });
    return NextResponse.json({
      ok: true,
      count: triggers.length,
      sample: triggers.slice(0, 3).map((t) => ({
        id: t.id,
        companyName: t.companyName,
        score: t.score,
        leadId: t.lead?.id,
        hasLead: !!t.lead,
      })),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
    }, { status: 500 });
  }
}
