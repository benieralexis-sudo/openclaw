import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { generateDynamicFewShots } from "@/lib/dynamic-few-shots";
import { notifyAdmin } from "@/lib/telegram-alert";

/**
 * Bonus D (05/05/2026) — Cron weekly few-shot dynamique refresh.
 *
 * Endpoint POST x-cron-secret. À appeler 1×/semaine par crontab :
 *   0 8 * * 1 curl -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     http://127.0.0.1:3100/api/internal/refresh-dynamic-few-shots
 *
 * Pour chaque client actif, calcule top 5 boosters + top 5 rejected
 * via Sprint 7 LeadActivity (DASHBOARD_INTERACTION + MEETING_BOOKED) et
 * écrit le résultat dans Client.icp.dynamicFewShots JSON.
 *
 * Fallback automatique : si 0 boosters + 0 rejected (data sparse), le
 * judge tournera sur les 9 few-shots hardcodés statiques uniquement.
 *
 * Kill switch : Client.icp.dynamicFewShotsEnabled = false → skip ce client.
 *
 * Audit : log dans Telegram quel client refreshé + count bumpé.
 *
 * Mode preview : ?dryRun=true retourne le résultat sans écrire en DB.
 */

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const targetClientId = url.searchParams.get("clientId");
  const windowDays = url.searchParams.get("windowDays")
    ? parseInt(url.searchParams.get("windowDays")!, 10)
    : 42;

  const clients = targetClientId
    ? await db.client.findMany({
        where: { id: targetClientId, deletedAt: null },
        select: { id: true, name: true, icp: true },
      })
    : await db.client.findMany({
        where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } },
        select: { id: true, name: true, icp: true },
      });

  const summary: Array<{
    client: string;
    boosters: number;
    rejected: number;
    skipped?: string;
    error?: string;
  }> = [];

  for (const c of clients) {
    const icp = (c.icp ?? {}) as Record<string, unknown>;
    if (icp.dynamicFewShotsEnabled === false) {
      summary.push({ client: c.name, boosters: 0, rejected: 0, skipped: "kill-switch" });
      continue;
    }
    try {
      const fewShots = await generateDynamicFewShots(c.id, windowDays);
      if (!dryRun) {
        // Merge dans icp existant — préserve les autres champs
        const newIcp = {
          ...icp,
          dynamicFewShots: fewShots,
        };
        await db.client.update({
          where: { id: c.id },
          data: { icp: newIcp as unknown as Prisma.InputJsonValue },
        });
      }
      summary.push({
        client: c.name,
        boosters: fewShots.boosters.length,
        rejected: fewShots.rejected.length,
      });
    } catch (e) {
      summary.push({
        client: c.name,
        boosters: 0,
        rejected: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!dryRun) {
    const totalShots = summary.reduce((acc, s) => acc + s.boosters + s.rejected, 0);
    const lines = [
      `Few-shots dynamiques rafraîchis : ${summary.length} client(s)`,
      ...summary.map(
        (s) =>
          `${s.client} : ${s.boosters} boosters / ${s.rejected} rejected${
            s.skipped ? ` (skip: ${s.skipped})` : s.error ? ` (err: ${s.error.slice(0, 60)})` : ""
          }`,
      ),
      `Total : ${totalShots} few-shots actifs`,
    ];
    await notifyAdmin(lines.join("\n"), {
      urgency: totalShots === 0 ? "warn" : "ok",
      title: "Bonus D - Few-shots dynamiques",
      dedupKey: `refresh-few-shots-${new Date().toISOString().slice(0, 10)}`,
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    refreshedAt: new Date().toISOString(),
    windowDays,
    summary,
  });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required with x-cron-secret header",
    description:
      "Refresh dynamic few-shots from Sprint 7 outcomes. Add ?dryRun=true to preview.",
  });
}
