import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getActivityStatsForClient } from "@/lib/lead-activity";

// ──────────────────────────────────────────────────────────────────────
// GET /api/activities/stats?clientId=&from=&to=&userId=
// Stats agrégées pour dashboard : totaux + par type + par commercial.
// ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const url = new URL(req.url);
  const requestedClientId = url.searchParams.get("clientId");
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const userId = url.searchParams.get("userId") ?? undefined;

  const scope = resolveClientScope(s.user, requestedClientId);
  if (!scope.ok) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  // ADMIN sans clientId fourni → on agrège tous les clients (renvoie tous)
  // sinon on filtre sur le scope résolu.
  const clientId = scope.clientId;
  if (!clientId) {
    return NextResponse.json(
      { error: "clientId requis (ADMIN doit préciser ?clientId=)" },
      { status: 400 },
    );
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : now;

  const stats = await getActivityStatsForClient({ clientId, from, to, userId });
  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    ...stats,
  });
}
