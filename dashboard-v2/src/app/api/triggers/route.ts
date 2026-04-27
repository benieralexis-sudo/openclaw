import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireApiSession, resolveClientScope } from "@/server/session";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("clientId");
  const scope = resolveClientScope(s.user, requested);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const filter = searchParams.get("filter");
  const search = searchParams.get("q");
  // Quality filter : "all" (tout), "qualified" (≥6, défaut), "pepites" (≥8)
  const quality = searchParams.get("quality") ?? "qualified";

  const where: Prisma.TriggerWhereInput = { deletedAt: null };
  if (scope.clientId) where.clientId = scope.clientId;
  if (filter === "hot") where.isHot = true;
  else if (filter === "combo") where.isCombo = true;
  else if (filter === "new") where.status = "NEW";
  if (quality === "qualified") where.score = { gte: 6 };
  else if (quality === "pepites") where.score = { gte: 8 };
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
      // sourceCode reste invisible — moat
    },
  });

  return NextResponse.json(triggers);
}
