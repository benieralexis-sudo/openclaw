import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiSession } from "@/server/session";
import { db } from "@/lib/db";

const PLAN_MRR_EUR: Record<string, number> = {
  LEADS_DATA: 199,
  FULL_SERVICE: 890,
  CUSTOM: 0,
};

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const enriched = searchParams.get("enriched") === "true";

  const u = s.user;
  let where: Prisma.ClientWhereInput = { deletedAt: null };

  switch (u.role) {
    case "CLIENT":
    case "EDITOR":
    case "VIEWER":
      if (!u.clientId) return NextResponse.json([]);
      where = { ...where, id: u.clientId };
      break;
    case "COMMERCIAL":
      where = { ...where, id: { in: u.scopeClientIds ?? [] } };
      break;
    case "ADMIN":
      break;
  }

  if (!enriched) {
    const clients = await db.client.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        industry: true,
        region: true,
        size: true,
        status: true,
        plan: true,
        activatedAt: true,
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(clients);
  }

  // Vue enrichie : counts triggers/opps/replies + last activity
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const clients = await db.client.findMany({
    where,
    select: {
      id: true,
      slug: true,
      name: true,
      legalName: true,
      industry: true,
      region: true,
      size: true,
      status: true,
      plan: true,
      contactEmail: true,
      primaryColor: true,
      activatedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          triggers: { where: { deletedAt: null, capturedAt: { gte: sevenDaysAgo } } },
          opportunities: {
            where: { deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
          },
          replies: { where: { deletedAt: null, status: "UNREAD" } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const enrichedList = clients.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    legalName: c.legalName,
    industry: c.industry,
    region: c.region,
    size: c.size,
    status: c.status,
    plan: c.plan,
    contactEmail: c.contactEmail,
    primaryColor: c.primaryColor,
    activatedAt: c.activatedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    triggersLast7d: c._count.triggers,
    openOpportunities: c._count.opportunities,
    unreadReplies: c._count.replies,
    mrrEur: c.status === "ACTIVE" ? (PLAN_MRR_EUR[c.plan] ?? 0) : 0,
  }));

  return NextResponse.json(enrichedList);
}
