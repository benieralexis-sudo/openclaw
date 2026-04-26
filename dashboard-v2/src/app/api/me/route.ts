import { type NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/server/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  // Lecture fraîche depuis la DB (la session Better Auth ne refresh
  // pas onboardingDone après update — on resync ici)
  const fresh = await db.user.findUnique({
    where: { id: s.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      clientId: true,
      scopeClientIds: true,
      onboardingDone: true,
    },
  });
  if (!fresh) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  let client = null;
  if (fresh.clientId) {
    client = await db.client.findUnique({
      where: { id: fresh.clientId },
      select: { id: true, slug: true, name: true, plan: true, status: true },
    });
  }

  return NextResponse.json({
    id: fresh.id,
    email: fresh.email,
    name: fresh.name,
    role: fresh.role,
    clientId: fresh.clientId,
    client,
    scopeClientIds: fresh.scopeClientIds ?? [],
    onboardingDone: fresh.onboardingDone,
  });
}
