import "server-only";
import { db } from "@/lib/db";
import type { ActivityDirection, ActivitySource, ActivityType, Prisma } from "@prisma/client";

// ═══════════════════════════════════════════════════════════════════
// Lead Activity logger — point d'entrée unique pour tracer toute action
// commerciale (email/LinkedIn/appel/RDV/note) depuis n'importe quel endroit
// du code (webhook, endpoint manuel, poller IMAP, bot).
//
// Usage :
//   await logActivity({
//     leadId, type: "EMAIL_SENT", source: "MANUAL", direction: "OUTBOUND",
//     userId, payload: { subject, fromMailbox, toEmail }
//   });
//
// Le clientId est résolu automatiquement depuis le Lead.
// ═══════════════════════════════════════════════════════════════════

export interface LogActivityArgs {
  leadId: string;
  type: ActivityType;
  source: ActivitySource;
  direction: ActivityDirection;
  occurredAt?: Date;
  userId?: string | null;
  emailActivityId?: string | null;
  emailEventId?: string | null;
  opportunityId?: string | null;
  payload?: Prisma.InputJsonValue;
}

export async function logActivity(args: LogActivityArgs): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const lead = await db.lead.findUnique({
    where: { id: args.leadId },
    select: { clientId: true, deletedAt: true },
  });
  if (!lead) return { ok: false, reason: "lead not found" };
  if (lead.deletedAt) return { ok: false, reason: "lead deleted" };

  const created = await db.leadActivity.create({
    data: {
      leadId: args.leadId,
      clientId: lead.clientId,
      type: args.type,
      source: args.source,
      direction: args.direction,
      occurredAt: args.occurredAt ?? new Date(),
      userId: args.userId ?? null,
      emailActivityId: args.emailActivityId ?? null,
      emailEventId: args.emailEventId ?? null,
      opportunityId: args.opportunityId ?? null,
      payload: args.payload,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

// Sync : rattrape les EmailActivity (RECEIVED notamment, écrites par le bot
// IMAP poller hors dashboard) qui n'ont pas encore de LeadActivity miroir.
// Idempotent — sécurise contre une double trace via emailActivityId déjà utilisé.
export async function syncEmailActivitiesToLeadActivity(opts: { since?: Date; limit?: number } = {}) {
  const since = opts.since ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const limit = opts.limit ?? 200;

  // EmailActivity sans LeadActivity miroir (anti-doublon par emailActivityId).
  const candidates = await db.emailActivity.findMany({
    where: { sentAt: { gte: since } },
    select: {
      id: true,
      leadId: true,
      direction: true,
      sentAt: true,
      sentByUserId: true,
      subject: true,
      fromMailbox: true,
      toEmail: true,
      template: true,
      replyClassification: true,
    },
    take: limit,
    orderBy: { sentAt: "asc" },
  });
  const existingIds = new Set(
    (
      await db.leadActivity.findMany({
        where: { emailActivityId: { in: candidates.map((c) => c.id) } },
        select: { emailActivityId: true },
      })
    ).map((r) => r.emailActivityId),
  );
  const orphans = candidates.filter((c) => !existingIds.has(c.id));

  let created = 0;
  for (const ea of orphans) {
    const result = await logActivity({
      leadId: ea.leadId,
      type: ea.direction === "SENT" ? "EMAIL_SENT" : "EMAIL_REPLY",
      source: "WEBHOOK",
      direction: ea.direction === "SENT" ? "OUTBOUND" : "INBOUND",
      occurredAt: ea.sentAt,
      userId: ea.sentByUserId,
      emailActivityId: ea.id,
      payload: {
        subject: ea.subject,
        fromMailbox: ea.fromMailbox,
        toEmail: ea.toEmail,
        template: ea.template,
        replyClassification: ea.replyClassification,
      },
    });
    if (result.ok) created += 1;
  }
  return { scanned: orphans.length, created };
}

// Helper : compteurs agrégés par type pour un lead (UI fiche).
export async function getActivityCountsForLead(leadId: string): Promise<Record<string, number>> {
  const grouped = await db.leadActivity.groupBy({
    by: ["type"],
    where: { leadId },
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((g) => [g.type, g._count._all]));
}

// Helper : timeline reverse-chrono d'un lead (UI fiche), avec user enrichi.
export async function getActivityTimelineForLead(leadId: string, opts: { limit?: number } = {}) {
  return db.leadActivity.findMany({
    where: { leadId },
    orderBy: { occurredAt: "desc" },
    take: opts.limit ?? 50,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

// Helper : stats agrégées par client + plage de dates (dashboard).
export async function getActivityStatsForClient(args: {
  clientId: string;
  from: Date;
  to: Date;
  userId?: string;
}): Promise<{
  total: number;
  byType: Record<string, number>;
  byUser: Array<{ userId: string | null; userName: string | null; count: number; byType: Record<string, number> }>;
}> {
  const where: Prisma.LeadActivityWhereInput = {
    clientId: args.clientId,
    occurredAt: { gte: args.from, lte: args.to },
    ...(args.userId ? { userId: args.userId } : {}),
  };

  const [byType, byUserRaw] = await Promise.all([
    db.leadActivity.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
    }),
    db.leadActivity.groupBy({
      by: ["userId", "type"],
      where,
      _count: { _all: true },
    }),
  ]);

  // Hydrate user names
  const userIds = [...new Set(byUserRaw.map((r) => r.userId).filter((u): u is string => !!u))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const userBucket = new Map<
    string,
    { userId: string | null; userName: string | null; count: number; byType: Record<string, number> }
  >();
  for (const row of byUserRaw) {
    const key = row.userId ?? "_null_";
    if (!userBucket.has(key)) {
      userBucket.set(key, {
        userId: row.userId,
        userName: row.userId ? userMap.get(row.userId) ?? null : null,
        count: 0,
        byType: {},
      });
    }
    const bucket = userBucket.get(key)!;
    bucket.count += row._count._all;
    bucket.byType[row.type] = row._count._all;
  }

  return {
    total: byType.reduce((acc, r) => acc + r._count._all, 0),
    byType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    byUser: Array.from(userBucket.values()).sort((a, b) => b.count - a.count),
  };
}
