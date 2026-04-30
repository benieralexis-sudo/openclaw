import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/internal/coverage-report
 *
 * Diagnostic du waterfall d'enrichissement, par bucket de score :
 *   - Pépite (>=8) | Qualifié (6-7) | Marginal (4-5) | Faible (<4)
 *
 * Pour chaque bucket : coverage Persona / LinkedIn / Email / Phone + sources.
 *
 * Query params :
 *   - clientId=... (défaut : tous les clients)
 *
 * Auth : header `x-cron-secret`.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;

  // Récup tous les leads + score Trigger
  const leads = await db.lead.findMany({
    where: {
      deletedAt: null,
      ...(clientId ? { clientId } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      linkedinUrl: true,
      linkedinSource: true,
      email: true,
      phone: true,
      kasprPhone: true,
      kasprWorkEmail: true,
      emailDropcontact: true,
      emailRodz: true,
      emailFullenrich: true,
      phoneFullenrich: true,
      personaSource: true,
      trigger: { select: { score: true } },
    },
  });

  type Bucket = "pepite" | "qualifie" | "marginal" | "faible" | "no_score";

  function bucketOf(score: number | null | undefined): Bucket {
    if (score === null || score === undefined) return "no_score";
    if (score >= 8) return "pepite";
    if (score >= 6) return "qualifie";
    if (score >= 4) return "marginal";
    return "faible";
  }

  type Counts = {
    total: number;
    persona: number;
    linkedin: number;
    email: number;
    phone: number;
    fullStack: number;
    sources: {
      linkedin: Record<string, number>;
      email: Record<string, number>;
      phone: Record<string, number>;
      persona: Record<string, number>;
    };
  };

  const init = (): Counts => ({
    total: 0,
    persona: 0,
    linkedin: 0,
    email: 0,
    phone: 0,
    fullStack: 0,
    sources: { linkedin: {}, email: {}, phone: {}, persona: {} },
  });

  const buckets: Record<Bucket, Counts> = {
    pepite: init(),
    qualifie: init(),
    marginal: init(),
    faible: init(),
    no_score: init(),
  };
  const overall = init();

  function inc(map: Record<string, number>, key: string | null | undefined) {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
  }

  for (const l of leads) {
    const b = bucketOf(l.trigger?.score);
    const hasPersona = !!(l.firstName || l.fullName);
    const hasLI = !!l.linkedinUrl;
    const hasEmail = !!l.email;
    const hasPhone = !!(l.phone || l.kasprPhone || l.phoneFullenrich);
    const fullStack = hasPersona && hasLI && hasEmail && hasPhone;

    for (const c of [buckets[b], overall]) {
      c.total++;
      if (hasPersona) c.persona++;
      if (hasLI) c.linkedin++;
      if (hasEmail) c.email++;
      if (hasPhone) c.phone++;
      if (fullStack) c.fullStack++;
      // Sources
      if (hasLI) inc(c.sources.linkedin, l.linkedinSource ?? "unknown");
      if (hasPersona) inc(c.sources.persona, l.personaSource ?? "unknown");
      if (hasEmail) {
        // email source priorité : Kaspr > FullEnrich > Rodz > Dropcontact
        const src = l.kasprWorkEmail
          ? "kaspr"
          : l.emailFullenrich
          ? "fullenrich"
          : l.emailRodz
          ? "rodz"
          : l.emailDropcontact
          ? "dropcontact"
          : "unknown";
        inc(c.sources.email, src);
      }
      if (hasPhone) {
        const src = l.kasprPhone
          ? "kaspr"
          : l.phoneFullenrich
          ? "fullenrich"
          : l.phone
          ? "dropcontact_or_legacy"
          : "unknown";
        inc(c.sources.phone, src);
      }
    }
  }

  function pct(n: number, total: number): string {
    if (!total) return "0%";
    return `${Math.round((n / total) * 100)}%`;
  }

  function fmt(c: Counts) {
    return {
      total: c.total,
      persona: { n: c.persona, pct: pct(c.persona, c.total), bySource: c.sources.persona },
      linkedin: { n: c.linkedin, pct: pct(c.linkedin, c.total), bySource: c.sources.linkedin },
      email: { n: c.email, pct: pct(c.email, c.total), bySource: c.sources.email },
      phone: { n: c.phone, pct: pct(c.phone, c.total), bySource: c.sources.phone },
      fullStack: { n: c.fullStack, pct: pct(c.fullStack, c.total) },
    };
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    clientId: clientId ?? "all",
    overall: fmt(overall),
    byBucket: {
      pepite_ge_8: fmt(buckets.pepite),
      qualifie_6_7: fmt(buckets.qualifie),
      marginal_4_5: fmt(buckets.marginal),
      faible_lt_4: fmt(buckets.faible),
      no_score: fmt(buckets.no_score),
    },
  });
}
