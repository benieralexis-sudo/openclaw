import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";
import { requireAdmin } from "@/server/admin";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const adm = requireAdmin(s.user);
  if (!adm.ok) return adm.response;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const clientId = searchParams.get("clientId");
  const limit = Math.min(200, Number(searchParams.get("limit") ?? 50));

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = action;
  if (clientId) where.clientId = clientId;

  const [entries, distinctActions] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  // Enrichissement light : email user + nom client
  const userIds = Array.from(new Set(entries.map((e) => e.userId).filter(Boolean))) as string[];
  const clientIds = Array.from(
    new Set(entries.map((e) => e.clientId).filter(Boolean)),
  ) as string[];

  const [users, clients] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true, role: true },
    }),
    db.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, slug: true, name: true },
    }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const clientMap = new Map(clients.map((c) => [c.id, c]));

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
      user: e.userId ? userMap.get(e.userId) ?? null : null,
      client: e.clientId ? clientMap.get(e.clientId) ?? null : null,
    })),
    distinctActions: distinctActions.map((d) => d.action),
  });
}
