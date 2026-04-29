import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/server/session";
import { listMailboxes } from "@/lib/mailbox";
import { db } from "@/lib/db";

// ──────────────────────────────────────────────────────────────────────
// GET /api/mailboxes — liste des mailboxes Primeforge actives
// ──────────────────────────────────────────────────────────────────────
// Renvoie { id, user, label, sentToday, dailyCap } — JAMAIS l'app password.
// Auth requise (toute role authenticated peut voir la liste).
// sentToday = compte d'emails SENT dans les dernières 24h pour cette mailbox
// → permet à l'UI d'afficher "X/30 envoyés" AVANT clic envoyer (UX-2 fix).

const DAILY_CAP = (() => {
  const raw = process.env.MAILBOX_DAILY_CAP;
  const n = raw ? parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const mailboxes = listMailboxes();
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  // Aggregate sentToday per mailbox.user. 1 query group-by, pas N queries.
  const grouped = await db.emailActivity.groupBy({
    by: ["fromMailbox"],
    where: { direction: "SENT", sentAt: { gte: since } },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const g of grouped) {
    counts.set(g.fromMailbox, g._count._all);
  }

  const enriched = mailboxes.map((mb) => ({
    ...mb,
    sentToday: counts.get(mb.user) ?? 0,
    dailyCap: DAILY_CAP,
  }));

  return NextResponse.json({ mailboxes: enriched, dailyCap: DAILY_CAP });
}
