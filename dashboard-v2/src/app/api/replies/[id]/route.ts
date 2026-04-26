import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ReplyIntent, ReplyStatus } from "@prisma/client";
import { requireApiSession, resolveClientScope } from "@/server/session";

const PatchSchema = z.object({
  status: z.nativeEnum(ReplyStatus).optional(),
  intent: z.nativeEnum(ReplyIntent).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { id } = await params;

  const existing = await db.reply.findUnique({
    where: { id },
    select: { id: true, clientId: true, status: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Reply introuvable" }, { status: 404 });
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
  if (parsed.data.status && parsed.data.status !== existing.status) {
    data.status = parsed.data.status;
    if (parsed.data.status === "ANSWERED") {
      data.respondedAt = new Date();
    }
  }
  if (parsed.data.intent) data.intent = parsed.data.intent;

  const updated = await db.reply.update({
    where: { id },
    data,
    select: {
      id: true,
      status: true,
      intent: true,
      respondedAt: true,
    },
  });
  return NextResponse.json(updated);
}
