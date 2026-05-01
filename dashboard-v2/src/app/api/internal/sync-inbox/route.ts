import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { syncInboxAllMailboxes } from "@/lib/sync-inbox";

/**
 * POST /api/internal/sync-inbox
 *
 * Poll IMAP sur toutes les mailboxes Primeforge configurées (MAILBOX_*).
 * Pour chaque message reçu qui a un inReplyTo correspondant à un de nos
 * EmailActivity SENT, crée une Reply liée au lead.
 *
 * Cron : `*\/5 * * * * /opt/moltbot/scripts/sync-inbox-cron.sh`
 * Fenêtre : 1h glissante (overshoot vs cron 5 min pour absorber lag).
 *
 * Auth : header `x-cron-secret`.
 */

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const windowMin = parseInt(url.searchParams.get("windowMinutes") ?? "60", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  const startedAt = Date.now();
  const result = await syncInboxAllMailboxes({
    windowMs: windowMin * 60 * 1000,
    limit,
  });

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...result,
  });
}
