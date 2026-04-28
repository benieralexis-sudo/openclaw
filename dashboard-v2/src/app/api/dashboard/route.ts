import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("clientId");
  const scope = resolveClientScope(s.user, requested);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const where = scope.clientId
    ? { clientId: scope.clientId, deletedAt: null }
    : { deletedAt: null };

  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const sinceWeek = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const since48h = new Date(Date.now() - 48 * 60 * 60_000);

  const [
    triggers24h,
    triggersPrev24h,
    pepites,
    pepitesPrev,
    bookedThisWeek,
    bookedPrevWeek,
    pipeline,
    recentTriggers,
    delaySamples,
  ] = await Promise.all([
    db.trigger.count({ where: { ...where, capturedAt: { gte: since24h } } }),
    db.trigger.count({
      where: { ...where, capturedAt: { gte: since48h, lt: since24h } },
    }),
    db.trigger.count({ where: { ...where, isHot: true, capturedAt: { gte: since24h } } }),
    db.trigger.count({
      where: { ...where, isHot: true, capturedAt: { gte: since48h, lt: since24h } },
    }),
    db.trigger.count({
      where: { ...where, status: "BOOKED", updatedAt: { gte: sinceWeek } },
    }),
    db.trigger.count({
      where: {
        ...where,
        status: "BOOKED",
        updatedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60_000), lt: sinceWeek },
      },
    }),
    db.trigger.groupBy({ by: ["status"], where, _count: true }),
    db.trigger.findMany({
      where: { ...where, isHot: true },
      orderBy: [{ score: "desc" }, { capturedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        companyName: true,
        industry: true,
        region: true,
        title: true,
        detail: true,
        score: true,
        isCombo: true,
        capturedAt: true,
      },
    }),
    // Échantillon pour calculer le délai signal → vous (capturedAt → publishedAt)
    db.trigger.findMany({
      where: {
        ...where,
        capturedAt: { gte: since24h },
        publishedAt: { not: null },
      },
      select: { capturedAt: true, publishedAt: true },
      take: 100,
    }),
  ]);

  // Calcul avgDelayMin : moyenne (capturedAt - publishedAt) en minutes
  let avgDelayMin = 0;
  if (delaySamples.length > 0) {
    const deltas = delaySamples
      .map((t) => {
        if (!t.publishedAt) return null;
        const delta = (t.capturedAt.getTime() - t.publishedAt.getTime()) / 60_000;
        return delta > 0 ? delta : null;
      })
      .filter((d): d is number => d !== null);
    if (deltas.length > 0) {
      avgDelayMin = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    }
  }

  const pipelineCounts = pipeline.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = p._count;
    return acc;
  }, {});

  const totalQualified =
    (pipelineCounts.NEW ?? 0) +
    (pipelineCounts.CONTACTED ?? 0) +
    (pipelineCounts.REPLIED ?? 0) +
    (pipelineCounts.BOOKED ?? 0);
  const contacted =
    (pipelineCounts.CONTACTED ?? 0) +
    (pipelineCounts.REPLIED ?? 0) +
    (pipelineCounts.BOOKED ?? 0);
  const replied = (pipelineCounts.REPLIED ?? 0) + (pipelineCounts.BOOKED ?? 0);
  const booked = pipelineCounts.BOOKED ?? 0;

  return NextResponse.json({
    kpis: {
      signals24h: { value: triggers24h, delta: triggers24h - triggersPrev24h },
      hotPepites: { value: pepites, delta: pepites - pepitesPrev },
      bookedWeek: { value: bookedThisWeek, delta: bookedThisWeek - bookedPrevWeek },
      avgDelayMin: { value: avgDelayMin },
    },
    pipeline: [
      { label: "Signaux qualifiés", value: totalQualified, color: "bg-brand-500" },
      { label: "Contactés", value: contacted, color: "bg-cyan-500" },
      { label: "Réponses positives", value: replied, color: "bg-amber-500" },
      { label: "RDV bookés", value: booked, color: "bg-emerald-500" },
    ],
    recentTriggers,
  });
}
