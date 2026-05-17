import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { invalidateSignalConfigCache } from "@/lib/signal-config";

/**
 * Sprint catalogue P3.2 (17/05/2026) — PATCH /api/clients/[id]/signals/[code]
 *
 * Update enabled / isPillar / parameters d'un signal du catalogue pour ce client.
 *
 * Contraintes :
 *   - 3 piliers max actifs (vérifié si isPillar=true demandé)
 *   - Seuls les signaux PILLAR peuvent être marqués isPillar=true
 *   - Parameters validés (objet JSON, pas array, pas null)
 *
 * Permissions :
 *   - ADMIN, EDITOR ou CLIENT du client (propriétaire)
 *   - VIEWER refusé
 */

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  isPillar: z.boolean().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  const { id: clientId, code } = await params;
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const scope = resolveClientScope(s.user, clientId);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
  if (s.user.role === "VIEWER") {
    return NextResponse.json({ error: "VIEWER role cannot edit" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid body",
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const { enabled, isPillar, parameters } = parsed.data;

  // Vérif signal existe
  const signal = await db.signalCatalog.findUnique({
    where: { code },
    select: { id: true, code: true, category: true, implemented: true },
  });
  if (!signal) {
    return NextResponse.json({ error: `signal ${code} not found in catalog` }, { status: 404 });
  }

  // Contrainte : seuls les piliers peuvent être marqués isPillar=true
  if (isPillar === true && signal.category !== "PILLAR") {
    return NextResponse.json(
      { error: `signal ${code} category=${signal.category} cannot be marked as pillar` },
      { status: 400 },
    );
  }

  // Contrainte : 3 piliers max actifs (sauf si on désactive un pillar)
  if (isPillar === true) {
    const currentPillars = await db.clientSignalConfig.findMany({
      where: { clientId, isPillar: true, enabled: true, signalId: { not: signal.id } },
      select: { signalId: true },
    });
    const willBeEnabled = enabled !== false;
    if (willBeEnabled && currentPillars.length >= 3) {
      return NextResponse.json(
        {
          error: "max 3 pillars enabled at once",
          currentPillars: currentPillars.length,
        },
        { status: 400 },
      );
    }
  }

  // Upsert
  const updated = await db.clientSignalConfig.upsert({
    where: { clientId_signalId: { clientId, signalId: signal.id } },
    update: {
      ...(enabled !== undefined && { enabled }),
      ...(isPillar !== undefined && { isPillar }),
      ...(parameters !== undefined && {
        parameters: parameters as Prisma.InputJsonValue,
      }),
    },
    create: {
      clientId,
      signalId: signal.id,
      enabled: enabled ?? true,
      isPillar: isPillar ?? false,
      parameters: (parameters ?? {}) as Prisma.InputJsonValue,
    },
  });

  // Invalidate cache pour ce client
  invalidateSignalConfigCache(clientId);

  return NextResponse.json({
    code,
    state: {
      enabled: updated.enabled,
      isPillar: updated.isPillar,
      parameters: updated.parameters,
    },
  });
}
