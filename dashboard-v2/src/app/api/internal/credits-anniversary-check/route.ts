import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { resetClientsDueForAnniversary } from "@/lib/credits";
import { notifyAdmin } from "@/lib/telegram-alert";

/**
 * V1 18/05/2026 — Daily check pour reset 30j anniversaire par client.
 *
 * Cron quotidien : tous les jours à 00:05 UTC.
 *   5 0 * * * /opt/moltbot/scripts/credits-anniversary-check-cron.sh
 *
 * Pour chaque client ACTIVE, vérifie si maintenant >= creditsLastResetAt + 30j
 * (fallback activatedAt si jamais reset). Si oui, déclenche le reset (quota
 * crédité, pepitesThisMonth=0, creditsLastResetAt=now).
 *
 * Remplace le cron mensuel 1er du mois (resetMonthlyCreditsAllClients gardé
 * pour rétro-compat mais plus utilisé). Décision utilisateur 18/05 : reset
 * 30j après date de souscription, pas calendaire.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await resetClientsDueForAnniversary();

    // Alerte Telegram uniquement quand un reset s'est produit (la plupart des
    // jours, 0 client triggered — pas la peine de spammer).
    if (result.resetCount > 0) {
      const names = result.details
        .filter((d) => d.triggered)
        .map((d) => `${d.clientName} (J+${d.daysSinceLastReset})`)
        .join(", ");
      const message =
        `Anniversaire credits : ${result.resetCount} client(s) reset (sur ${result.scanned} scannés).\n` +
        `Garantie Pépite déclenchée : ${result.guaranteeTriggeredCount} client(s).\n` +
        `Détails : ${names}`;
      await notifyAdmin(message, {
        urgency: result.guaranteeTriggeredCount > 0 ? "warn" : "info",
        title: "iFIND credits anniversary reset",
      }).catch(() => {});
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
