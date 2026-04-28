import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import {
  getActivityCountsForLead,
  getActivityTimelineForLead,
  logActivity,
} from "@/lib/lead-activity";
import type { ActivityType } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────
// GET  /api/leads/[id]/activities — counters + timeline reverse-chrono
// POST /api/leads/[id]/activities — log manuel (commercial coche/log)
// ──────────────────────────────────────────────────────────────────────

const MANUAL_TYPES: ActivityType[] = [
  "EMAIL_SENT",
  "LINKEDIN_DM_SENT",
  "LINKEDIN_VIEW_PROFILE",
  "LINKEDIN_CONNECT",
  "CALL_OUTBOUND",
  "VOICEMAIL_LEFT",
  "MEETING_HELD",
  "MEETING_NO_SHOW",
  "NOTE",
];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { id } = await ctx.params;
  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const [counts, timeline] = await Promise.all([
    getActivityCountsForLead(id),
    getActivityTimelineForLead(id, { limit: 50 }),
  ]);

  return NextResponse.json({ counts, timeline });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { id } = await ctx.params;
  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    note?: string;
    direction?: "OUTBOUND" | "INBOUND";
    occurredAt?: string;
    payload?: Record<string, unknown>;
  };

  if (!body.type || !MANUAL_TYPES.includes(body.type as ActivityType)) {
    return NextResponse.json(
      { error: "invalid_type", allowed: MANUAL_TYPES },
      { status: 400 },
    );
  }

  const result = await logActivity({
    leadId: id,
    type: body.type as ActivityType,
    source: "MANUAL",
    direction: body.direction ?? "OUTBOUND",
    userId: s.user.id,
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    payload: {
      note: body.note ?? null,
      ...(body.payload ?? {}),
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
