import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { aggregateDailyCostsForAllClients } from "@/lib/service-cost-tracker";
import { notifyAdmin } from "@/lib/telegram-alert";

/**
 * V1 18/05/2026 — Cron quotidien d'agrégation des coûts par client × service.
 *
 * Tourne tous les jours à 01h05 UTC (après que la journée précédente est figée).
 * Agrège les volumes de la journée d'hier depuis Trigger/Lead, calcule les coûts
 * estimés et insère/upsert dans ServiceCostDaily.
 *
 * À ajouter au crontab :
 *   5 1 * * * /opt/moltbot/scripts/aggregate-daily-costs-cron.sh
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await aggregateDailyCostsForAllClients();

    // Alerte Telegram si un client dépasse $10/jour (signal de burn anormal).
    const highBurn = result.perClient.filter((c) => c.totalUsd > 10);
    if (highBurn.length > 0) {
      const lines = highBurn
        .map((c) => `${c.clientName}: $${c.totalUsd}/jour`)
        .join("\n");
      await notifyAdmin(
        `⚠️ Burn quotidien anormal détecté\n\n${lines}\n\nTotal journée : $${result.totalUsd}`,
        { urgency: "warn", title: "iFIND daily cost spike" },
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" });
}
