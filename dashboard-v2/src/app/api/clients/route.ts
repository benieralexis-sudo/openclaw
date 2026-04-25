import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/server/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const u = s.user;
  let where: import("@prisma/client").Prisma.ClientWhereInput = { deletedAt: null };

  switch (u.role) {
    case "CLIENT":
    case "EDITOR":
    case "VIEWER":
      // Voit uniquement son propre client
      if (!u.clientId) return NextResponse.json([]);
      where = { ...where, id: u.clientId };
      break;
    case "COMMERCIAL":
      // Voit les clients de son scope
      where = { ...where, id: { in: u.scopeClientIds ?? [] } };
      break;
    case "ADMIN":
      // Voit tous les clients
      break;
  }

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
