import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recomputePriorityScoresForClient } from "@/lib/priority-scoring-runner";

/**
 * GET /api/internal/priority-report?clientId=X&recompute=true
 *
 * Compare le top 20 par score brut vs top 20 par priorityScore.
 * Métrique de succès du chantier #1 : valider intuitivement que le
 * réordering est correct (les leads à appeler en premier remontent au top).
 *
 * `?recompute=true` force un recompute avant la lecture (utile pour
 * tester les changements de formule).
 *
 * Auth : x-cron-secret.
 */

export const maxDuration = 30;
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

  // dedupByCompany=true : ne garde que le meilleur trigger par société
  // (utile pour la todo commerciale finale qui veut 1 ligne par boîte).
  // Mode par défaut (false) : utile pour debug — voir la dynamique multi-trigger.
  const dedupByCompany = url.searchParams.get("dedupByCompany") === "true";

  let runResult = null;
  if (recompute) {
    runResult = await recomputePriorityScoresForClient(clientId);
  }

  const selectFields = {
    id: true,
    companyName: true,
    companySiret: true,
    title: true,
    score: true,
    sourceCode: true,
    capturedAt: true,
    freshnessScore: true,
    multiSourceBoost: true,
    priorityScore: true,
  };

  // Helper dédup par société (siret > companyName fallback) — garde le top
  // priority de chaque société.
  type TriggerRow = {
    id: string;
    companyName: string;
    companySiret: string | null;
    [k: string]: unknown;
  };
  function dedupByCompanyKey<T extends TriggerRow>(rows: T[]): T[] {
    const seen = new Map<string, T>();
    for (const r of rows) {
      const key = ((r.companySiret ?? r.companyName) || "").trim().toLowerCase();
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, r);
    }
    return Array.from(seen.values());
  }

  // Top 20 par score brut (legacy). Si dedupByCompany, on overshoot puis dédup.
  const fetchSize = dedupByCompany ? 60 : 20;
  const rawByScore = await db.trigger.findMany({
    where: { clientId, deletedAt: null },
    orderBy: [{ score: "desc" }, { capturedAt: "desc" }],
    take: fetchSize,
    select: selectFields,
  });
  const topByScore = (dedupByCompany ? dedupByCompanyKey(rawByScore) : rawByScore).slice(0, 20);

  // Top 20 par priorityScore (nouveau)
  const rawByPriority = await db.trigger.findMany({
    where: { clientId, deletedAt: null, priorityScore: { not: null } },
    orderBy: [{ priorityScore: "desc" }, { capturedAt: "desc" }],
    take: fetchSize,
    select: selectFields,
  });
  const topByPriority = (dedupByCompany ? dedupByCompanyKey(rawByPriority) : rawByPriority).slice(0, 20);

  // Identifier les leads qui changent de position
  const idsByScore = topByScore.map((t) => t.id);
  const idsByPriority = topByPriority.map((t) => t.id);
  const movedIn = topByPriority
    .filter((t) => !idsByScore.includes(t.id))
    .map((t) => ({ id: t.id, companyName: t.companyName, priorityScore: t.priorityScore }));
  const movedOut = topByScore
    .filter((t) => !idsByPriority.includes(t.id))
    .map((t) => ({ id: t.id, companyName: t.companyName, score: t.score }));

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
    topByScore: topByScore.map((t) => ({
      ...t,
      ageDays: Math.round((Date.now() - t.capturedAt.getTime()) / 86400_000),
    })),
    topByPriority: topByPriority.map((t) => ({
      ...t,
      ageDays: Math.round((Date.now() - t.capturedAt.getTime()) / 86400_000),
    })),
  });
}
