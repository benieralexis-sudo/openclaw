import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

// DELETE /api/leads/[id]/activities/[activityId]
// Suppression d'une LeadActivity. Restrictions :
// - source MANUAL uniquement (les AUTO/WEBHOOK reflètent un événement réel
//   qu'on ne doit pas falsifier)
// - créateur (userId) ou ADMIN

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; activityId: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { id, activityId } = await ctx.params;
  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const activity = await db.leadActivity.findUnique({
    where: { id: activityId },
    select: { id: true, leadId: true, source: true, userId: true },
  });
  if (!activity || activity.leadId !== id) {
    return NextResponse.json({ error: "activity_not_found" }, { status: 404 });
  }

  if (activity.source !== "MANUAL") {
    return NextResponse.json(
      {
        error: "Suppression réservée aux entrées manuelles. Les événements automatiques (webhooks email/Cal.com) reflètent une réalité non modifiable.",
      },
      { status: 403 },
    );
  }

  if (s.user.role !== "ADMIN" && activity.userId !== s.user.id) {
    return NextResponse.json(
      { error: "Seul le créateur ou un admin peut supprimer cette entrée." },
      { status: 403 },
    );
  }

  await db.leadActivity.delete({ where: { id: activityId } });
  return NextResponse.json({ ok: true });
}
