import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  const trigger = await db.trigger.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      companyName: true,
      companySiret: true,
      industry: true,
      region: true,
      size: true,
      type: true,
      title: true,
      detail: true,
      score: true,
      scoreReason: true,
      isHot: true,
      isCombo: true,
      status: true,
      capturedAt: true,
      publishedAt: true,
      // sourceCode reste hidden — moat
    },
  });
  if (!trigger) {
    return NextResponse.json({ error: "Trigger introuvable" }, { status: 404 });
  }

  const scope = resolveClientScope(s.user, trigger.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== trigger.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  // Lead associé (1:1 via triggerId @unique)
  const lead = await db.lead.findUnique({
    where: { triggerId: id },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      linkedinUrl: true,
      email: true,
      emailStatus: true,
      phone: true,
      companyName: true,
      status: true,
      enrichedAt: true,
      briefJson: true,
      briefGeneratedAt: true,
      // Kaspr enrichment
      kasprEnrichedAt: true,
      kasprWorkEmail: true,
      kasprPersonalEmail: true,
      kasprPhone: true,
      kasprTitle: true,
    },
  });

  const client = await db.client.findUnique({
    where: { id: trigger.clientId },
    select: {
      id: true,
      slug: true,
      name: true,
      industry: true,
      icp: true,
    },
  });

  // Opportunity associée si elle existe
  const opportunity = await db.opportunity.findUnique({
    where: { triggerId: id },
    select: {
      id: true,
      stage: true,
      meetingDate: true,
      meetingNotes: true,
      dealValueEur: true,
      wonAt: true,
      lostAt: true,
    },
  });

  return NextResponse.json({
    trigger,
    lead,
    client,
    opportunity: opportunity
      ? {
          ...opportunity,
          dealValueEur: opportunity.dealValueEur ? Number(opportunity.dealValueEur) : null,
        }
      : null,
  });
}
