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

  const where: Prisma.OpportunityWhereInput = { deletedAt: null };
  if (scope.clientId) where.clientId = scope.clientId;

  const opportunities = await db.opportunity.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
    select: {
      id: true,
      clientId: true,
      stage: true,
      meetingDate: true,
      meetingNotes: true,
      dealValueEur: true,
      wonAt: true,
      lostAt: true,
      lostReason: true,
      createdAt: true,
      updatedAt: true,
      lead: {
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          email: true,
          companyName: true,
        },
      },
      trigger: {
        select: {
          id: true,
          title: true,
          score: true,
          isHot: true,
          isCombo: true,
          industry: true,
          region: true,
          // sourceCode reste hidden — moat
        },
      },
    },
  });

  // Sérialiser Decimal en number pour le client
  const serialized = opportunities.map((o) => ({
    ...o,
    dealValueEur: o.dealValueEur ? Number(o.dealValueEur) : null,
  }));

  return NextResponse.json(serialized);
}
