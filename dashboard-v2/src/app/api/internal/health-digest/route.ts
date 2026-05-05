import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyAdmin } from "@/lib/telegram-alert";

/**
 * Sprint 10 (05/05/2026) — Daily health digest.
 *
 * Endpoint cron-friendly (POST x-cron-secret) qui résume les 24 dernières
 * heures et poste un digest sur Telegram. À déclencher 1×/jour (ex: 7h UTC
 * via crontab) pour avoir un état du bot chaque matin.
 *
 * Métriques agrégées (par client actif) :
 *   - Triggers créés / qualifiés / IGNORED / NEW
 *   - Leads créés / enrichis (LinkedIn profile / Pappers riche)
 *   - Recovery sweeps (revived count)
 *   - Combos détectés
 *   - DASHBOARD_INTERACTION outcomes capturés (Sprint 7)
 *   - Top 3 sources les plus actives
 *
 * Coût : 1 query DB par section, ~10 queries totales. <500ms total.
 *
 * Acceptance : digest reçu chaque matin via Telegram, lisible en 30s.
 */

interface DigestSection {
  clientName: string;
  triggers: { created: number; ignored: number; new: number };
  leads: { created: number; withLinkedinProfile: number; withPappersRich: number };
  judgeRevisions: { recoveredFromIgnored: number };
  combos: number;
  outcomes: { dashboardInteractions: number; meetingBooked: number };
  topSources: Array<{ source: string; count: number }>;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const sinceMs = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - sinceMs);

  const clients = await db.client.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } },
    select: { id: true, name: true },
  });

  const sections: DigestSection[] = [];
  for (const c of clients) {
    const [
      triggersCreated,
      triggersIgnored,
      triggersNew,
      leadsCreated,
      leadsWithProfile,
      leadsWithPappers,
      recovered,
      combos,
      dashboardInteractions,
      meetingBooked,
      topSourcesRaw,
    ] = await Promise.all([
      db.trigger.count({
        where: { clientId: c.id, createdAt: { gte: since } },
      }),
      db.trigger.count({
        where: { clientId: c.id, status: "IGNORED", createdAt: { gte: since } },
      }),
      db.trigger.count({
        where: { clientId: c.id, status: "NEW", createdAt: { gte: since } },
      }),
      db.lead.count({
        where: { clientId: c.id, createdAt: { gte: since }, deletedAt: null },
      }),
      db.lead.count({
        where: {
          clientId: c.id,
          deletedAt: null,
          linkedinProfileEnrichedAt: { gte: since },
        },
      }),
      db.lead.count({
        where: {
          clientId: c.id,
          deletedAt: null,
          enrichedAt: { gte: since },
          companyEtabsCount: { not: null },
        },
      }),
      // Recovery : Triggers passés de IGNORED → NEW (annotation [RE-JUDGED v2 ... RECOVERED])
      db.trigger.count({
        where: {
          clientId: c.id,
          updatedAt: { gte: since },
          status: "NEW",
          scoreReason: { contains: "RECOVERED" },
        },
      }),
      // Combos détectés (isCombo posé sur 24h)
      db.trigger.count({
        where: {
          clientId: c.id,
          isCombo: true,
          updatedAt: { gte: since },
        },
      }),
      db.leadActivity.count({
        where: {
          clientId: c.id,
          type: "DASHBOARD_INTERACTION",
          occurredAt: { gte: since },
        },
      }),
      db.leadActivity.count({
        where: {
          clientId: c.id,
          type: "MEETING_BOOKED",
          occurredAt: { gte: since },
        },
      }),
      db.trigger.groupBy({
        by: ["sourceCode"],
        where: {
          clientId: c.id,
          createdAt: { gte: since },
          deletedAt: null,
        },
        _count: { _all: true },
        orderBy: { _count: { sourceCode: "desc" } },
        take: 3,
      }),
    ]);

    sections.push({
      clientName: c.name,
      triggers: {
        created: triggersCreated,
        ignored: triggersIgnored,
        new: triggersNew,
      },
      leads: {
        created: leadsCreated,
        withLinkedinProfile: leadsWithProfile,
        withPappersRich: leadsWithPappers,
      },
      judgeRevisions: { recoveredFromIgnored: recovered },
      combos,
      outcomes: { dashboardInteractions, meetingBooked },
      topSources: topSourcesRaw.map((s) => ({
        source: s.sourceCode,
        count: s._count._all,
      })),
    });
  }

  // Format Telegram digest
  const lines: string[] = [];
  lines.push(`Digest 24h — ${sections.length} client(s) actif(s)`);
  for (const s of sections) {
    lines.push("");
    lines.push(`${s.clientName} :`);
    lines.push(
      `  Triggers : ${s.triggers.created} (NEW=${s.triggers.new}, IGNORED=${s.triggers.ignored})`,
    );
    lines.push(
      `  Leads : ${s.leads.created} créés (LinkedIn=${s.leads.withLinkedinProfile}, Pappers=${s.leads.withPappersRich})`,
    );
    if (s.judgeRevisions.recoveredFromIgnored > 0) {
      lines.push(`  Recovery : ${s.judgeRevisions.recoveredFromIgnored} re-jugés RECOVERED`);
    }
    if (s.combos > 0) {
      lines.push(`  Combos : ${s.combos}`);
    }
    const outcomes = s.outcomes.dashboardInteractions + s.outcomes.meetingBooked;
    if (outcomes > 0) {
      lines.push(
        `  Outcomes : ${s.outcomes.dashboardInteractions} interactions, ${s.outcomes.meetingBooked} RDV bookés`,
      );
    }
    if (s.topSources.length > 0) {
      const top = s.topSources.map((t) => `${t.source}=${t.count}`).join(", ");
      lines.push(`  Top sources : ${top}`);
    }
  }

  const message = lines.join("\n");

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, message, sections });
  }

  // Pas de dédup nécessaire — 1 envoi/jour piloté par cron, message
  // contient des stats variables.
  await notifyAdmin(message, {
    urgency: "info",
    title: "iFIND - Digest 24h",
    dedupKey: `health-digest-${new Date().toISOString().slice(0, 10)}`,
  });

  return NextResponse.json({ ok: true, sentAt: new Date().toISOString(), sections });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required with x-cron-secret header",
    description:
      "Daily health digest. Add ?dryRun=true to preview without sending Telegram.",
  });
}
