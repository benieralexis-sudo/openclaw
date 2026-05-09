import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";
import { resolveClientScope as _resolveClientScope, type ClientScopeUser, type Role as _Role } from "@/lib/client-scope";

export type Role = _Role;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  clientId: string | null;
  scopeClientIds: string[];
  onboardingDone: boolean;
}

/** Récupère la session courante depuis les cookies (usage server components / actions). */
export async function getSession() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

/** Garde-fou pour Server Components — redirige /login si pas de session. */
export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Pour les routes API : retourne 401 si pas authentifié, sinon résout l'utilisateur enrichi. */
export async function requireApiSession(req: NextRequest) {
  const s = await auth.api.getSession({ headers: req.headers });
  if (!s) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
    };
  }
  const u = s.user as unknown as SessionUser;
  return { ok: true as const, user: u };
}

/**
 * Résout le clientId effectif pour la requête en respectant le rôle.
 * Sprint 4 (10/05/2026) — Logique extraite dans @/lib/client-scope (pure
 * function testable sans server-only).
 */
export function resolveClientScope(
  user: SessionUser,
  requestedClientId: string | null,
) {
  return _resolveClientScope(user as ClientScopeUser, requestedClientId);
}
