import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// TODO Phase 1.4 — protéger avec Better Auth + scoping par rôle
export async function GET() {
  const clients = await db.client.findMany({
    where: { deletedAt: null },
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
