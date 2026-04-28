import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

// GET /api/leads/[id]/email-events
// Retourne les events Resend (DELIVERED/OPENED/CLICKED/BOUNCED/...) du lead.
// Permet d'identifier les "warm leads" : 3+ opens = signal d'intérêt.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt) {
    return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });
  }

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const events = await db.emailEvent.findMany({
    where: { leadId: id },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      occurredAt: true,
      recipient: true,
      emailId: true,
      metadata: true,
    },
  });

  // Stats agrégées pour affichage rapide (compteur opens, clicks, etc.)
  const counts = {
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    unsubscribed: 0,
    failed: 0,
  };
  for (const e of events) {
    const k = e.type.toLowerCase() as keyof typeof counts;
    if (k in counts) counts[k]++;
  }

  return NextResponse.json({
    leadId: id,
    counts,
    isWarm: counts.opened >= 3 || counts.clicked >= 1,
    events,
  });
}
