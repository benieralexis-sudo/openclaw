import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getPillarHealth } from "@/lib/cold-signal-monitor";

/**
 * V1 17/05/2026 — GET /api/clients/[id]/pillar-health
 *
 * Retourne la santé des 3 piliers actifs du client :
 *   - ok    : dernier lead < 3j
 *   - tepid : 3-6j sans lead (warning)
 *   - cold  : 7j+ sans lead (alerte)
 *
 * Utilisé par la bannière "Santé de tes signaux" sur le dashboard /triggers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const scope = resolveClientScope(s.user, clientId);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const report = await getPillarHealth(clientId);
  return NextResponse.json(report);
}
