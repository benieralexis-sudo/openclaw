import { type NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/server/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  // Charge le client associé (pour client/editor/viewer)
  let client = null;
  if (s.user.clientId) {
    client = await db.client.findUnique({
      where: { id: s.user.clientId },
      select: { id: true, slug: true, name: true, plan: true, status: true },
    });
  }

  return NextResponse.json({
    id: s.user.id,
    email: s.user.email,
    name: s.user.name,
    role: s.user.role,
    clientId: s.user.clientId,
    client,
    scopeClientIds: s.user.scopeClientIds ?? [],
    onboardingDone: s.user.onboardingDone,
  });
}
