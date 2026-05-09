// Sprint 4 (10/05/2026) — Pure function resolveClientScope (extraite de
// session.ts pour permettre tests Vitest sans imports server-only).
//
// Decide si un user (par son role + clientId/scopeClientIds) peut acceder
// au client demande (requestedClientId).
//
// CRITIQUE pour multi-tenant : appelee par chaque route API qui touche un
// client. Si bug ici → fuite de donnees cross-client.

export type Role = "ADMIN" | "COMMERCIAL" | "CLIENT" | "EDITOR" | "VIEWER";

export interface ClientScopeUser {
  id: string;
  role: Role;
  clientId: string | null;
  scopeClientIds: string[];
}

export type ClientScopeResult =
  | { ok: true; clientId: string | null }
  | { ok: false; status: number; error: string };

export function resolveClientScope(
  user: ClientScopeUser,
  requestedClientId: string | null,
): ClientScopeResult {
  switch (user.role) {
    case "CLIENT":
    case "EDITOR":
    case "VIEWER":
      if (!user.clientId) {
        return {
          ok: false,
          status: 403,
          error: "Aucun client associé à votre compte",
        };
      }
      // Force toujours leur clientId, ignore le param (anti-fuite)
      return { ok: true, clientId: user.clientId };

    case "COMMERCIAL": {
      const scope = user.scopeClientIds ?? [];
      if (requestedClientId && scope.includes(requestedClientId)) {
        return { ok: true, clientId: requestedClientId };
      }
      if (requestedClientId && !scope.includes(requestedClientId)) {
        return {
          ok: false,
          status: 403,
          error: "Ce client n'est pas dans votre périmètre",
        };
      }
      return { ok: true, clientId: scope[0] ?? null };
    }

    case "ADMIN":
      return { ok: true, clientId: requestedClientId };

    default:
      return { ok: false, status: 403, error: "Rôle inconnu" };
  }
}
