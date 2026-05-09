import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { resetMonthlyCreditsAllClients } from "@/lib/credits";
import { notifyAdmin } from "@/lib/telegram-alert";

// Sprint Saint Graal (10/05/2026) — Reset mensuel credits + check garantie Pepite.
//
// Cron : 1er du mois 00:05 UTC (apres reset-quotas a 00:01).
//   5 0 1 * * /opt/moltbot/scripts/reset-monthly-credits-cron.sh
//
// Logique pour chaque client ACTIVE :
//   1. Check pepitesThisMonth (mois sortant) vs pepitesGuaranteed
//   2. Si garantie ratee → quota courant double (guaranteeBonusActive=true)
//   3. Reset pepitesThisMonth = 0
//   4. Credite le nouveau quota dans creditsBalance
//   5. Update creditsLastResetAt
//
// Alerte Telegram avec recap garantie declenche / OK.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await resetMonthlyCreditsAllClients();

    // Alerte Telegram
    const guaranteeNames = result.details
      .filter((d) => d.result.guaranteeTriggered)
      .map((d) => `${d.clientName} (${d.result.pepitesPreviousMonth}/${d.result.quotaCredited / 2})`)
      .join(", ");
    const message =
      `Reset mensuel credits : ${result.processedCount} clients traites.\n` +
      `Garantie Pepite declenchee : ${result.guaranteeTriggeredCount} clients.\n` +
      (guaranteeNames ? `Details : ${guaranteeNames}` : "");
    await notifyAdmin(message, {
      urgency: result.guaranteeTriggeredCount > 0 ? "warn" : "info",
      title: "iFIND credits monthly reset",
    }).catch(() => {});

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
