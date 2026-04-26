import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  if (id === s.user.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas supprimer votre propre compte" },
      { status: 400 },
    );
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, clientId: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Garde-fou : pas le dernier admin
  if (target.role === "ADMIN") {
    const adminCount = await db.user.count({
      where: { role: "ADMIN", deletedAt: null },
    });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Impossible de retirer le dernier administrateur" },
        { status: 400 },
      );
    }
  }

  // Permissions
  if (s.user.role === "ADMIN") {
    // OK
  } else if (s.user.role === "EDITOR" || s.user.role === "CLIENT") {
    if (!s.user.clientId || target.clientId !== s.user.clientId) {
      return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
    }
    if (target.role === "ADMIN" || target.role === "COMMERCIAL") {
      return NextResponse.json(
        { error: "Vous ne pouvez pas retirer ce profil" },
        { status: 403 },
      );
    }
  } else {
    return NextResponse.json({ error: "Permission insuffisante" }, { status: 403 });
  }

  // Soft delete
  await db.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await db.session.deleteMany({ where: { userId: id } });

  return NextResponse.json({ ok: true });
}
