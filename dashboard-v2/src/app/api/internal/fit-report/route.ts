import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recomputeFitScoresForClient } from "@/lib/persona-fit-runner";

/**
 * GET /api/internal/fit-report?clientId=X&recompute=true
 *
 * Compare top 20 par personaTier vs top 20 par fitScore (chantier #2b).
 * Métrique de succès : valider intuitivement que le réordering est correct
 * — un Pépite Tier 1 frais avec ESN+SaaS background doit être en haut.
 *
 * Auth : x-cron-secret.
 */

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId requis" }, { status: 400 });
  }
  const recompute = url.searchParams.get("recompute") === "true";

  let runResult = null;
  if (recompute) {
    runResult = await recomputeFitScoresForClient(clientId);
  }

  // Top 20 par fitScore (nouveau classement)
  const topByFit = await db.lead.findMany({
    where: { clientId, deletedAt: null, fitScore: { not: null } },
    orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
    take: 20,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      companyName: true,
      personaTier: true,
      fitScore: true,
      fitScoreBreakdown: true,
      linkedinProfileJson: true,
    },
  });

  // Top 20 par personaTier ASC + createdAt (legacy)
  const topByTier = await db.lead.findMany({
    where: { clientId, deletedAt: null, personaTier: { not: null } },
    orderBy: [{ personaTier: "asc" }, { createdAt: "desc" }],
    take: 20,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      companyName: true,
      personaTier: true,
      fitScore: true,
    },
  });

  const idsByTier = topByTier.map((l) => l.id);
  const idsByFit = topByFit.map((l) => l.id);
  const movedIn = topByFit
    .filter((l) => !idsByTier.includes(l.id))
    .map((l) => ({
      name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      companyName: l.companyName,
      fitScore: l.fitScore,
      tier: l.personaTier,
    }));
  const movedOut = topByTier
    .filter((l) => !idsByFit.includes(l.id))
    .map((l) => ({
      name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      companyName: l.companyName,
      fitScore: l.fitScore,
      tier: l.personaTier,
    }));

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    clientId,
    runResult,
    summary: {
      changeCount: movedIn.length,
      movedIn,
      movedOut,
    },
    topByFit: topByFit.map((l) => ({
      name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      jobTitle: l.jobTitle,
      companyName: l.companyName,
      personaTier: l.personaTier,
      fitScore: l.fitScore,
      breakdown: l.fitScoreBreakdown,
      hasLinkedinProfile: !!l.linkedinProfileJson,
    })),
    topByTier: topByTier.map((l) => ({
      name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      jobTitle: l.jobTitle,
      companyName: l.companyName,
      personaTier: l.personaTier,
      fitScore: l.fitScore,
    })),
  });
}
