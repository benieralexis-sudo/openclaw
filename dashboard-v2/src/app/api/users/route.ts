import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";
import { hashPassword } from "@better-auth/utils/password";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { requireApiSession } from "@/server/session";

// ──────────────────────────────────────────────────────────────────────
// GET /api/users — liste équipe
// ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const requestedClientId = searchParams.get("clientId");

  let where: Prisma.UserWhereInput = { deletedAt: null };

  if (s.user.role === "ADMIN") {
    if (requestedClientId) where.clientId = requestedClientId;
  } else if (s.user.role === "COMMERCIAL") {
    const scope = s.user.scopeClientIds ?? [];
    where.clientId = requestedClientId && scope.includes(requestedClientId)
      ? requestedClientId
      : { in: scope };
  } else {
    if (!s.user.clientId) return NextResponse.json([]);
    where.clientId = s.user.clientId;
  }

  const users = await db.user.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      clientId: true,
      lastLoginAt: true,
      createdAt: true,
      onboardingDone: true,
    },
  });

  return NextResponse.json(users);
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/users — invite (avec mot de passe temporaire)
// ──────────────────────────────────────────────────────────────────────

const InviteSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
  role: z.nativeEnum(UserRole),
  clientId: z.string().min(1).optional().nullable(),
});

const TENANT_SAFE_ROLES: ReadonlyArray<UserRole> = [
  UserRole.EDITOR,
  UserRole.VIEWER,
];

function makeTempPassword(): string {
  // 14 chars : 9 hex + 5 mix → assez fort pour temp
  return randomBytes(7).toString("hex") + "Aa9";
}

export async function POST(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const body = await req.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, name, role } = parsed.data;
  let { clientId } = parsed.data;

  // Garde-fous selon rôle
  if (s.user.role === "ADMIN") {
    // ADMIN peut inviter n'importe quel rôle sur n'importe quel tenant
    if (!clientId && (role === "CLIENT" || role === "EDITOR" || role === "VIEWER")) {
      return NextResponse.json(
        { error: "clientId requis pour ce rôle" },
        { status: 400 },
      );
    }
  } else if (s.user.role === "EDITOR" || s.user.role === "CLIENT") {
    if (!s.user.clientId) {
      return NextResponse.json({ error: "Aucun client associé" }, { status: 403 });
    }
    if (!TENANT_SAFE_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "Rôle non autorisé pour votre profil" },
        { status: 403 },
      );
    }
    clientId = s.user.clientId;
  } else {
    return NextResponse.json({ error: "Permission insuffisante" }, { status: 403 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email déjà utilisé" }, { status: 409 });
  }

  const tempPassword = makeTempPassword();
  const hashed = await hashPassword(tempPassword);

  const created = await db.user.create({
    data: {
      email,
      name,
      role,
      emailVerified: true,
      onboardingDone: true,
      ...(clientId && { clientId }),
      accounts: {
        create: {
          providerId: "credential",
          accountId: email,
          password: hashed,
        },
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      clientId: true,
      createdAt: true,
    },
  });

  // ⚠️ Le mot de passe temporaire est renvoyé UNE SEULE FOIS
  return NextResponse.json({ ...created, tempPassword }, { status: 201 });
}
