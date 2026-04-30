import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { mergeDuplicatePersonaLeads } from "@/lib/dedup-persona-leads";

/**
 * POST /api/internal/dedup-leads
 *
 * Détecte et fusionne les doublons (firstName + lastName + companySiret)
 * en propageant les enrichissements vers un winner et soft-deletant les autres.
 *
 * Query params :
 *   - clientId=...  (défaut : tous les clients)
 *   - dryRun=true   (audit sans modification)
 *
 * Auth : header `x-cron-secret`.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = Date.now();
  const result = await mergeDuplicatePersonaLeads({ clientId, dryRun });
  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    dryRun,
    ...result,
  });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required",
    usage: [
      "POST /api/internal/dedup-leads (cleanup global)",
      "POST /api/internal/dedup-leads?clientId=... (cleanup pour un client)",
      "POST /api/internal/dedup-leads?dryRun=true (audit sans modification)",
    ],
  });
}
