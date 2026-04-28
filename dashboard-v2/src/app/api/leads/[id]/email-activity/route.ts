import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

// ──────────────────────────────────────────────────────────────────────
// GET /api/leads/[id]/email-activity — historique SENT + RECEIVED
// ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const limit = Math.min(
    Number(new URL(req.url).searchParams.get("limit") ?? 20),
    100,
  );

  const [activity, events] = await Promise.all([
    db.emailActivity.findMany({
      where: { leadId: id },
      orderBy: { sentAt: "desc" },
      take: limit,
      select: {
        id: true,
        direction: true,
        fromMailbox: true,
        toEmail: true,
        subject: true,
        bodyText: true,
        messageId: true,
        inReplyTo: true,
        sentAt: true,
        sentByUserId: true,
        template: true,
        replyClassification: true,
      },
    }),
    db.emailEvent.findMany({
      where: { leadId: id },
      orderBy: { occurredAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        occurredAt: true,
        emailId: true,
      },
    }),
  ]);

  // Stats agrégées EmailEvent
  const eventCounts = {
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    unsubscribed: 0,
  };
  for (const e of events) {
    const k = e.type.toLowerCase() as keyof typeof eventCounts;
    if (k in eventCounts) eventCounts[k]++;
  }

  return NextResponse.json({
    activity,
    events,
    eventCounts,
    isWarm: eventCounts.opened >= 3 || eventCounts.clicked >= 1,
  });
}
