import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { QuotaConfigSchema, parseQuotaConfig, DEFAULT_QUOTAS_BY_PLAN } from "@/lib/quota-config";

/**
 * Sprint 7 (10/05/2026) — GET/PATCH /api/clients/[id]/quota
 *
 * GET : retourne config quotas + defaults selon plan client (suggestions UI)
 * PATCH : update config quotas (Zod-validated, ADMIN/EDITOR seulement)
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
    select: { id: true, plan: true, quotaConfig: true },
  });
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const config = parseQuotaConfig(client.quotaConfig);
  const defaults = DEFAULT_QUOTAS_BY_PLAN[client.plan] ?? DEFAULT_QUOTAS_BY_PLAN.LEADS_DATA;

  return NextResponse.json({ clientId, plan: client.plan, config, defaults });
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
  if (!["ADMIN", "EDITOR"].includes(s.user.role)) {
    return NextResponse.json({ error: "ADMIN or EDITOR required" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const parsed = QuotaConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid quota config",
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
    data: { quotaConfig: parsed.data as unknown as object },
    select: { id: true, quotaConfig: true },
  });

  await db.auditLog.create({
    data: {
      clientId,
      userId: s.user.id,
      action: "client.quota_config_updated",
      entityType: "Client",
      entityId: clientId,
      metadata: {
        anthropicHardCap: parsed.data.anthropic.hardCapUsd,
        apifyHardCap: parsed.data.apify.hardCapUsd,
        theirstackHardCap: parsed.data.theirstack.hardCapUsd,
      } as unknown as object,
    },
  });

  return NextResponse.json({ clientId: updated.id, config: parseQuotaConfig(updated.quotaConfig) });
}
