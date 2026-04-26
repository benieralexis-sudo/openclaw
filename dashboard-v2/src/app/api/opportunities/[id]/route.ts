import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { OpportunityStage } from "@prisma/client";
import { requireApiSession, resolveClientScope } from "@/server/session";

const PatchSchema = z.object({
  stage: z.nativeEnum(OpportunityStage).optional(),
  dealValueEur: z.number().nonnegative().nullable().optional(),
  meetingDate: z.string().datetime().nullable().optional(),
  meetingNotes: z.string().max(2000).nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { id } = await params;

  // Vérifier l'existence + scope
  const existing = await db.opportunity.findUnique({
    where: { id },
    select: { id: true, clientId: true, stage: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Opportunité introuvable" }, { status: 404 });
  }
  const scope = resolveClientScope(s.user, existing.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== existing.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  const now = new Date();

  if (parsed.data.stage && parsed.data.stage !== existing.stage) {
    data.stage = parsed.data.stage;
    if (parsed.data.stage === "WON") {
      data.wonAt = now;
      data.closedAt = now;
      data.lostAt = null;
      data.lostReason = null;
    } else if (parsed.data.stage === "LOST") {
      data.lostAt = now;
      data.closedAt = now;
      data.wonAt = null;
    } else {
      data.wonAt = null;
      data.lostAt = null;
      data.closedAt = null;
    }
  }

  if (parsed.data.dealValueEur !== undefined) data.dealValueEur = parsed.data.dealValueEur;
  if (parsed.data.meetingDate !== undefined)
    data.meetingDate = parsed.data.meetingDate ? new Date(parsed.data.meetingDate) : null;
  if (parsed.data.meetingNotes !== undefined) data.meetingNotes = parsed.data.meetingNotes;
  if (parsed.data.lostReason !== undefined) data.lostReason = parsed.data.lostReason;

  const updated = await db.opportunity.update({
    where: { id },
    data,
    select: {
      id: true,
      stage: true,
      dealValueEur: true,
      meetingDate: true,
      meetingNotes: true,
      lostReason: true,
      wonAt: true,
      lostAt: true,
      closedAt: true,
    },
  });

  return NextResponse.json({
    ...updated,
    dealValueEur: updated.dealValueEur ? Number(updated.dealValueEur) : null,
  });
}
