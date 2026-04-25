import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// TODO Phase 1.4 — protéger + scoping par rôle (commercial restreint à scopeClientIds)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const filter = searchParams.get("filter"); // hot | combo | new | all
  const search = searchParams.get("q");

  const where: Prisma.TriggerWhereInput = { deletedAt: null };
  if (clientId) where.clientId = clientId;
  if (filter === "hot") where.isHot = true;
  else if (filter === "combo") where.isCombo = true;
  else if (filter === "new") where.status = "NEW";
  if (search) {
    where.OR = [
      { companyName: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
      { industry: { contains: search, mode: "insensitive" } },
    ];
  }

  const triggers = await db.trigger.findMany({
    where,
    orderBy: [{ isHot: "desc" }, { score: "desc" }, { capturedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      companyName: true,
      industry: true,
      region: true,
      size: true,
      type: true,
      title: true,
      detail: true,
      score: true,
      isHot: true,
      isCombo: true,
      status: true,
      capturedAt: true,
      sourceCode: false, // ne pas exposer la source au client (moat)
    },
  });

  return NextResponse.json(triggers);
}
