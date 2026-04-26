import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";

export async function POST(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const updated = await db.user.update({
    where: { id: s.user.id },
    data: { onboardingDone: true },
    select: { id: true, onboardingDone: true },
  });

  return NextResponse.json(updated);
}
