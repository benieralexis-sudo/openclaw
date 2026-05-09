import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { DeliveryConfigSchema, parseDeliveryConfig } from "@/lib/delivery-config";

/**
 * GET /api/clients/[id]/delivery
 * Lit la config delivery du client.
 *
 * PATCH /api/clients/[id]/delivery
 * Update la config delivery (validation Zod).
 *
 * Auth : session ADMIN OU EDITOR/CLIENT du client cible.
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

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, deliveryConfig: true },
  });
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const config = parseDeliveryConfig(client.deliveryConfig);
  return NextResponse.json({ clientId, config });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const scope = resolveClientScope(s.user, clientId);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
  // Restriction edition : ADMIN ou EDITOR ou CLIENT
  if (!["ADMIN", "EDITOR", "CLIENT"].includes(s.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  // Validation Zod stricte
  const parsed = DeliveryConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid config",
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const updated = await db.client.update({
    where: { id: clientId },
    data: { deliveryConfig: parsed.data },
    select: { id: true, deliveryConfig: true },
  });

  await db.auditLog.create({
    data: {
      clientId,
      userId: s.user.id,
      action: "client.delivery_config_updated",
      entityType: "Client",
      entityId: clientId,
      metadata: {
        weeklyDigestEnabled: parsed.data.weeklyDigest.enabled,
        realtimeAlertEnabled: parsed.data.realtimeAlert.enabled,
      },
    },
  });

  return NextResponse.json({ clientId: updated.id, config: parseDeliveryConfig(updated.deliveryConfig) });
}
