import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";

export type Role = "ADMIN" | "COMMERCIAL" | "CLIENT" | "EDITOR" | "VIEWER";

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
 * Résout le clientId effectif pour la requête en respectant le rôle :
 * - ADMIN : peut consulter n'importe quel ?clientId, sinon null (vue globale)
 * - COMMERCIAL : doit fournir un ?clientId qui appartient à scopeClientIds
 *                (sinon défaut sur le 1er du scope, sinon null)
 * - CLIENT/EDITOR/VIEWER : forcé sur leur clientId, ?clientId ignoré
 */
export function resolveClientScope(
  user: SessionUser,
  requestedClientId: string | null,
):
  | { ok: true; clientId: string | null }
  | { ok: false; status: number; error: string } {
  switch (user.role) {
    case "CLIENT":
    case "EDITOR":
    case "VIEWER":
      if (!user.clientId) {
        return { ok: false, status: 403, error: "Aucun client associé à votre compte" };
      }
      return { ok: true, clientId: user.clientId };

    case "COMMERCIAL": {
      const scope = user.scopeClientIds ?? [];
      if (requestedClientId && scope.includes(requestedClientId)) {
        return { ok: true, clientId: requestedClientId };
      }
      if (requestedClientId && !scope.includes(requestedClientId)) {
        return { ok: false, status: 403, error: "Ce client n'est pas dans votre périmètre" };
      }
      return { ok: true, clientId: scope[0] ?? null };
    }

    case "ADMIN":
      return { ok: true, clientId: requestedClientId };

    default:
      return { ok: false, status: 403, error: "Rôle inconnu" };
  }
}
