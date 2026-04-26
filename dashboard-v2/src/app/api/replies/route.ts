import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Prisma, ReplyIntent, ReplyStatus } from "@prisma/client";
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

  const intent = searchParams.get("intent") as ReplyIntent | null;
  const status = searchParams.get("status") as ReplyStatus | null;
  const search = searchParams.get("q");
  const countOnly = searchParams.get("count") === "true";

  const where: Prisma.ReplyWhereInput = { deletedAt: null };
  if (scope.clientId) where.clientId = scope.clientId;
  if (intent && intent in ReplyIntent) where.intent = intent;
  if (status && status in ReplyStatus) where.status = status;
  if (search) {
    where.OR = [
      { fromName: { contains: search, mode: "insensitive" } },
      { fromEmail: { contains: search, mode: "insensitive" } },
      { subject: { contains: search, mode: "insensitive" } },
      { body: { contains: search, mode: "insensitive" } },
    ];
  }

  if (countOnly) {
    const count = await db.reply.count({ where });
    return NextResponse.json({ count });
  }

  const replies = await db.reply.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      clientId: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      body: true,
      receivedAt: true,
      intent: true,
      intentConfidence: true,
      status: true,
      respondedAt: true,
      createdAt: true,
      lead: {
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          companyName: true,
          email: true,
        },
      },
    },
  });

  const serialized = replies.map((r) => ({
    ...r,
    intentConfidence: r.intentConfidence ? Number(r.intentConfidence) : null,
  }));

  return NextResponse.json(serialized);
}
