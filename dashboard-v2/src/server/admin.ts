import "server-only";
import { NextResponse } from "next/server";
import type { SessionUser } from "./session";

/** Garde-fou pour les routes admin-only. */
export function requireAdmin(user: SessionUser):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  if (user.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Réservé aux administrateurs" },
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}
