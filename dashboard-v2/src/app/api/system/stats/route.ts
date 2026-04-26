import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";
import { requireAdmin } from "@/server/admin";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const adm = requireAdmin(s.user);
  if (!adm.ok) return adm.response;

  const since7d = new Date();
  since7d.setDate(since7d.getDate() - 7);
  const since24h = new Date();
  since24h.setHours(since24h.getHours() - 24);

  const [
    triggers,
    triggers24h,
    triggers7d,
    leads,
    opportunities,
    opportunitiesOpen,
    opportunitiesWon,
    replies,
    repliesUnread,
    users,
    clientsActive,
    clientsProspect,
  ] = await Promise.all([
    db.trigger.count({ where: { deletedAt: null } }),
    db.trigger.count({ where: { deletedAt: null, capturedAt: { gte: since24h } } }),
    db.trigger.count({ where: { deletedAt: null, capturedAt: { gte: since7d } } }),
    db.lead.count({ where: { deletedAt: null } }),
    db.opportunity.count({ where: { deletedAt: null } }),
    db.opportunity.count({
      where: { deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
    }),
    db.opportunity.count({ where: { deletedAt: null, stage: "WON" } }),
    db.reply.count({ where: { deletedAt: null } }),
    db.reply.count({ where: { deletedAt: null, status: "UNREAD" } }),
    db.user.count({ where: { deletedAt: null } }),
    db.client.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    db.client.count({ where: { deletedAt: null, status: "PROSPECT" } }),
  ]);

  return NextResponse.json({
    triggers: { total: triggers, last24h: triggers24h, last7d: triggers7d },
    leads: { total: leads },
    opportunities: { total: opportunities, open: opportunitiesOpen, won: opportunitiesWon },
    replies: { total: replies, unread: repliesUnread },
    users: { total: users },
    clients: { active: clientsActive, prospect: clientsProspect },
  });
}
