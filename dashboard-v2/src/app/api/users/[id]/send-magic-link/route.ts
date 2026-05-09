import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";
import { auth } from "@/server/auth";

// Sprint 8 (10/05/2026) — Envoi magic-link a un user existant.
//
// Permission :
//   - ADMIN : peut envoyer pour n'importe quel user
//   - EDITOR : peut envoyer pour les users de son tenant uniquement
//
// Usage cote frontend :
//   POST /api/users/{id}/send-magic-link
//   { callbackURL?: "/preview-v2/dashboard" }
//
// Better Auth genere un token unique stocke en DB (table verification),
// expire 30 min (cf server/auth.ts). Le user clique le lien -> session
// creee automatiquement, redirection sur callbackURL.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, clientId: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Permission
  if (s.user.role === "ADMIN") {
    // OK
  } else if (s.user.role === "EDITOR") {
    if (!s.user.clientId || target.clientId !== s.user.clientId) {
      return NextResponse.json({ error: "Permission insuffisante" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Permission insuffisante" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { callbackURL?: string };
  const callbackURL = body.callbackURL ?? "/preview-v2/dashboard";

  try {
    await auth.api.signInMagicLink({
      body: { email: target.email, callbackURL },
      headers: req.headers,
    });
    return NextResponse.json({
      ok: true,
      sentTo: target.email,
      expiresInMinutes: 30,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
