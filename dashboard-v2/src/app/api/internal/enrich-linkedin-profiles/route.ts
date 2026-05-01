import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { enrichLinkedInProfilesForClient } from "@/lib/enrich-linkedin-profile-runner";

/**
 * POST /api/internal/enrich-linkedin-profiles?clientId=X&limit=N&force=true
 *
 * Enrichit les profils LinkedIn complets via HarvestAPI Profile Full pour les
 * leads Pépites/Qualifiés du client. Coût ~$0.005/profil.
 *
 * Auth : x-cron-secret.
 */

export const maxDuration = 600; // batches de 10 + pauses 2s
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId requis" }, { status: 400 });
  }
  const limit = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const force = url.searchParams.get("force") === "true";

  const startedAt = Date.now();
  const result = await enrichLinkedInProfilesForClient(clientId, { limit, force });

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...result,
  });
}
