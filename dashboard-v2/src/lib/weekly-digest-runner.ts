import "server-only";

/**
 * Sprint 3 (10/05/2026) — Weekly digest runner.
 *
 * Pour 1 client : fetch leads NEW score >= seuil sur 7j → build HTML email
 * → send via Resend → log AuditLog.
 *
 * Idempotence : check AuditLog si on a deja envoye un digest cette semaine ISO.
 * Skip si oui (anti-doublon en cas de re-trigger cron).
 */

import { db } from "@/lib/db";
import { parseDeliveryConfig } from "@/lib/delivery-config";
import { buildWeeklyDigest, type DigestLead } from "@/lib/lead-digest-builder";
import { sendEmailViaResend } from "@/lib/delivery-sender";

export interface WeeklyDigestRunResult {
  clientId: string;
  status: "sent" | "skipped" | "failed" | "no-config" | "no-leads-no-mail" | "duplicate-this-week";
  reason?: string;
  emailId?: string;
  leadsCount?: number;
  pepitesCount?: number;
}

function isoWeek(d: Date): string {
  // YYYY-Www format ISO 8601
  const y = d.getUTCFullYear();
  const tmp = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const dayOfYear = Math.ceil(((tmp.getTime() - Date.UTC(y, 0, 1)) / 86_400_000) + 1);
  const wk = Math.ceil((dayOfYear + new Date(Date.UTC(y, 0, 1)).getUTCDay()) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

export async function runWeeklyDigestForClient(
  clientId: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<WeeklyDigestRunResult> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      deletedAt: true,
      deliveryConfig: true,
    },
  });
  if (!client || client.deletedAt || client.status !== "ACTIVE") {
    return { clientId, status: "skipped", reason: "client not active" };
  }

  const cfg = parseDeliveryConfig(client.deliveryConfig);
  if (!cfg.weeklyDigest.enabled) {
    return { clientId, status: "no-config", reason: "weekly digest disabled" };
  }
  if (!cfg.weeklyDigest.email) {
    return { clientId, status: "no-config", reason: "weekly digest enabled but no email configured" };
  }

  // Check anti-duplicate (1 envoi max par semaine ISO sauf force)
  const weekKey = isoWeek(new Date());
  if (!opts.force) {
    const alreadySent = await db.auditLog.findFirst({
      where: {
        clientId,
        action: "delivery.weekly_digest_sent",
        metadata: { path: ["weekKey"], equals: weekKey },
      },
      select: { id: true, createdAt: true },
    });
    if (alreadySent) {
      return {
        clientId,
        status: "duplicate-this-week",
        reason: `already sent ${alreadySent.createdAt.toISOString()} for week ${weekKey}`,
      };
    }
  }

  // Fetch leads : NEW + score >= minScore + capturedAt 7j
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 7 * 86_400_000);

  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: "NEW",
      score: { gte: cfg.weeklyDigest.minScore },
      capturedAt: { gte: periodStart, lte: periodEnd },
    },
    orderBy: { score: "desc" },
    take: cfg.weeklyDigest.maxLeads,
    select: {
      id: true,
      companyName: true,
      companyNaf: true,
      size: true,
      region: true,
      sourceCode: true,
      score: true,
      scoreReason: true,
      capturedAt: true,
      briefV2Json: true,
      lead: {
        select: {
          fullName: true,
          email: true,
          phone: true,
          linkedinUrl: true,
        },
      },
    },
  });

  // Map vers DigestLead format
  const leads: DigestLead[] = triggers.map((t) => {
    const briefV2 = t.briefV2Json as { verdict?: string; confidence?: number; thesis?: string; opener?: string } | null;
    return {
      triggerId: t.id,
      companyName: t.companyName,
      companyNaf: t.companyNaf,
      size: t.size,
      region: t.region,
      sourceCode: t.sourceCode,
      score: t.score,
      scoreReason: t.scoreReason,
      capturedAt: t.capturedAt,
      briefV2: briefV2 && (briefV2.verdict === "OUI" || briefV2.verdict === "NON" || briefV2.verdict === "ENRICH")
        ? {
            verdict: briefV2.verdict,
            confidence: briefV2.confidence ?? 0,
            thesis: briefV2.thesis ?? "",
            opener: briefV2.opener ?? "",
          }
        : null,
      lead: t.lead
        ? {
            fullName: t.lead.fullName,
            email: t.lead.email,
            phone: t.lead.phone,
            linkedinUrl: t.lead.linkedinUrl,
          }
        : null,
    };
  });

  if (leads.length === 0 && !opts.force) {
    // Pas envoi de digest vide sauf si force (eviter spam quand 0 lead)
    return { clientId, status: "no-leads-no-mail", leadsCount: 0 };
  }

  const built = buildWeeklyDigest({
    clientName: client.name,
    leads,
    periodStart,
    periodEnd,
    brand: cfg.brand,
  });

  if (opts.dryRun) {
    return {
      clientId,
      status: "sent",
      reason: "dry-run",
      leadsCount: built.stats.total,
      pepitesCount: built.stats.pepites,
    };
  }

  const sendRes = await sendEmailViaResend({
    to: cfg.weeklyDigest.email,
    subject: built.subject,
    html: built.html,
    text: built.text,
    fromEmail: cfg.brand.senderEmail ?? undefined,
    fromName: cfg.brand.senderName,
  });

  if (!sendRes.ok) {
    await db.auditLog.create({
      data: {
        clientId,
        action: "delivery.weekly_digest_failed",
        entityType: "Client",
        entityId: clientId,
        metadata: {
          weekKey,
          email: cfg.weeklyDigest.email,
          error: sendRes.error,
          leadsCount: built.stats.total,
        },
      },
    });
    return { clientId, status: "failed", reason: sendRes.error, leadsCount: built.stats.total };
  }

  await db.auditLog.create({
    data: {
      clientId,
      action: "delivery.weekly_digest_sent",
      entityType: "Client",
      entityId: clientId,
      metadata: {
        weekKey,
        email: cfg.weeklyDigest.email,
        emailId: sendRes.emailId,
        leadsCount: built.stats.total,
        pepitesCount: built.stats.pepites,
        avgScore: built.stats.avg_score,
        durationMs: sendRes.durationMs,
      },
    },
  });

  console.log(
    `[weekly-digest] ${clientId}: sent to ${cfg.weeklyDigest.email} (${built.stats.total} leads, ${built.stats.pepites} pepites, emailId=${sendRes.emailId})`,
  );

  return {
    clientId,
    status: "sent",
    emailId: sendRes.emailId,
    leadsCount: built.stats.total,
    pepitesCount: built.stats.pepites,
  };
}

/**
 * Boucle sur tous les clients ACTIVE avec deliveryConfig.weeklyDigest.enabled.
 * Retourne stats agreges. Appelle depuis cron systemd hebdo.
 */
export async function runWeeklyDigestForAllClients(opts: { dryRun?: boolean } = {}): Promise<{
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  details: WeeklyDigestRunResult[];
}> {
  const clients = await db.client.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  const details: WeeklyDigestRunResult[] = [];
  let sent = 0, skipped = 0, failed = 0;
  for (const c of clients) {
    const res = await runWeeklyDigestForClient(c.id, opts);
    details.push(res);
    if (res.status === "sent") sent += 1;
    else if (res.status === "failed") failed += 1;
    else skipped += 1;
  }
  return { total: clients.length, sent, skipped, failed, details };
}
