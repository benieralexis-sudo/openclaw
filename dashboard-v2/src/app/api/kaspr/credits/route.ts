import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/server/session";
import { getRemainingCredits, getRateLimits } from "@/lib/kaspr";

export const maxDuration = 15;

// ──────────────────────────────────────────────────────────────────────
// GET /api/kaspr/credits — solde + rate limits Kaspr (ADMIN seul)
// ──────────────────────────────────────────────────────────────────────
// Affichage admin pour monitorer le stock crédits work/personal/phone/export.
// Pas exposé aux commerciaux (info sensible budget).
// ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  if (s.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Réservé aux administrateurs" },
      { status: 403 },
    );
  }

  const [credits, limits] = await Promise.all([
    getRemainingCredits(),
    getRateLimits(),
  ]);

  if (!credits) {
    return NextResponse.json(
      { error: "Impossible de récupérer le solde Kaspr (clé invalide ou réseau)" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    credits,
    rateLimits: limits ?? null,
    fetchedAt: new Date().toISOString(),
  });
}
