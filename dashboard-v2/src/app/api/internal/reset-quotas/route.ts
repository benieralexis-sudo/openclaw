import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { resetMonthlyQuotas } from "@/lib/quota-checker";

// Sprint 8 (10/05/2026) — Reset compteurs quota mensuels (currentSpendUsd = 0)
// pour tous les clients ACTIVE. A appeler le 1er du mois 00:01 UTC via cron.
//
// Voir scripts/reset-quotas-cron.sh + crontab :
//   1 0 1 * * /opt/moltbot/scripts/reset-quotas-cron.sh
//
// Protege par CRON_SECRET (meme header que run-pollers).
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await resetMonthlyQuotas();
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      resetCount: result.resetCount,
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
