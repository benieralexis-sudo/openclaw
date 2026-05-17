import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

/**
 * Sprint catalogue P3.1 (17/05/2026) — GET /api/clients/[id]/signals
 *
 * Retourne le catalogue universel des 16 signaux + l'état pour ce client
 * (enabled / isPillar / parameters depuis ClientSignalConfig).
 *
 * Permissions :
 *   - ADMIN voit tout
 *   - CLIENT/EDITOR/VIEWER ne voit que son propre clientId
 *
 * Réponse :
 *   {
 *     clientId,
 *     signals: [
 *       {
 *         code, name, description, category, predictivityPct, implemented,
 *         sourceCodes, paramsTemplate,
 *         state: { enabled, isPillar, parameters, isDefault }
 *       },
 *       ...
 *     ],
 *     pillarCount: number,
 *     maxPillars: 3,
 *   }
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

  const [catalog, configs] = await Promise.all([
    db.signalCatalog.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ category: "asc" }, { code: "asc" }],
    }),
    db.clientSignalConfig.findMany({
      where: { clientId },
      select: {
        signalId: true,
        enabled: true,
        isPillar: true,
        parameters: true,
      },
    }),
  ]);

  const configBySignalId = new Map(configs.map((c) => [c.signalId, c]));

  const signals = catalog.map((sig) => {
    const cfg = configBySignalId.get(sig.id);
    return {
      code: sig.code,
      name: sig.name,
      description: sig.description,
      category: sig.category,
      predictivityPct: sig.predictivityPct,
      implemented: sig.implemented,
      sourceCodes: sig.sourceCodes,
      paramsTemplate: sig.parameters,
      state: {
        enabled: cfg?.enabled ?? true,
        isPillar: cfg?.isPillar ?? false,
        parameters: cfg?.parameters ?? {},
        isDefault: !cfg,
      },
    };
  });

  const pillarCount = signals.filter((s) => s.state.isPillar && s.state.enabled).length;

  return NextResponse.json({
    clientId,
    signals,
    pillarCount,
    maxPillars: 3,
  });
}
