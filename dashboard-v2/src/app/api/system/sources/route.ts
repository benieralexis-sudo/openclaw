import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";
import { requireAdmin } from "@/server/admin";

// 9 sources FR du Trigger Engine — référence interne (moat)
const KNOWN_SOURCES = [
  { code: "PAPPERS_BODACC", label: "Pappers / BODACC", category: "Open data FR", paid: true },
  { code: "bodacc.levee_serie_a", label: "BODACC — Levée Série A", category: "Open data FR", paid: false },
  { code: "bodacc.levee_serie_b", label: "BODACC — Levée Série B", category: "Open data FR", paid: false },
  { code: "bodacc.changement_dirigeant", label: "BODACC — Dirigeant", category: "Open data FR", paid: false },
  { code: "inpi.marque_produit", label: "INPI — Marques", category: "Open data FR", paid: false },
  { code: "francetravail.cfo", label: "France Travail — CFO", category: "Hiring", paid: false },
  { code: "francetravail.head_of_sales", label: "France Travail — Head of Sales", category: "Hiring", paid: false },
  { code: "meta.ad_campaign", label: "Meta Ad Library", category: "Pub", paid: false },
  { code: "rodz.signals", label: "Rodz signals (14 triggers)", category: "Premium", paid: true },
];

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const adm = requireAdmin(s.user);
  if (!adm.ok) return adm.response;

  const since24h = new Date();
  since24h.setHours(since24h.getHours() - 24);
  const since7d = new Date();
  since7d.setDate(since7d.getDate() - 7);

  // Aggrégats sourceCode (depuis Trigger)
  const stats = await db.trigger.groupBy({
    by: ["sourceCode"],
    where: { deletedAt: null },
    _count: { _all: true },
    _max: { capturedAt: true },
  });

  const stats24h = await db.trigger.groupBy({
    by: ["sourceCode"],
    where: { deletedAt: null, capturedAt: { gte: since24h } },
    _count: { _all: true },
  });
  const counts24h = new Map(stats24h.map((s) => [s.sourceCode, s._count._all]));

  const stats7d = await db.trigger.groupBy({
    by: ["sourceCode"],
    where: { deletedAt: null, capturedAt: { gte: since7d } },
    _count: { _all: true },
  });
  const counts7d = new Map(stats7d.map((s) => [s.sourceCode, s._count._all]));

  const byCode = new Map(stats.map((s) => [s.sourceCode, s]));

  const result = KNOWN_SOURCES.map((src) => {
    const stat = byCode.get(src.code);
    const lastCaptureAt = stat?._max.capturedAt ?? null;
    const ageHours = lastCaptureAt
      ? (Date.now() - new Date(lastCaptureAt).getTime()) / (60 * 60 * 1000)
      : null;
    const status: "live" | "stale" | "idle" =
      ageHours === null
        ? "idle"
        : ageHours <= 24
          ? "live"
          : ageHours <= 24 * 7
            ? "stale"
            : "idle";
    return {
      ...src,
      totalTriggers: stat?._count._all ?? 0,
      last24hTriggers: counts24h.get(src.code) ?? 0,
      last7dTriggers: counts7d.get(src.code) ?? 0,
      lastCaptureAt,
      ageHours,
      status,
    };
  });

  return NextResponse.json(result);
}
