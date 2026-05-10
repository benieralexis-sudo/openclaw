import "server-only";

/**
 * Sprint 3 (10/05/2026) — Realtime alert sender.
 *
 * Envoie une alerte instantanee (email + Telegram) quand un trigger atteint
 * le seuil de pepite (defaut score >= 9).
 *
 * Appel : depuis qualify-trigger.ts AU MOMENT de la creation/scoring
 * (fire-and-forget, non bloquant).
 *
 * Idempotence : 1 alerte max par triggerId (check AuditLog).
 * Rate-limit : maxPerDay par client (anti-flood).
 */

import { db } from "@/lib/db";
import { parseDeliveryConfig } from "@/lib/delivery-config";
import { sendEmailViaResend, sendTelegramMessage } from "@/lib/delivery-sender";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "https://app-v2.ifind.fr";

export interface RealtimeAlertResult {
  triggerId: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  channels: { email?: boolean; telegram?: boolean };
}

export async function sendRealtimeAlertForTrigger(
  triggerId: string,
): Promise<RealtimeAlertResult> {
  const trigger = await db.trigger.findUnique({
    where: { id: triggerId },
    select: {
      id: true,
      clientId: true,
      companyName: true,
      companyNaf: true,
      size: true,
      sourceCode: true,
      score: true,
      scoreReason: true,
      briefV2Json: true,
      client: {
        select: {
          name: true,
          status: true,
          deletedAt: true,
          deliveryConfig: true,
        },
      },
    },
  });
  if (!trigger || !trigger.client) {
    return { triggerId, status: "skipped", reason: "trigger or client not found", channels: {} };
  }
  if (trigger.client.deletedAt || trigger.client.status !== "ACTIVE") {
    return { triggerId, status: "skipped", reason: "client not active", channels: {} };
  }

  const cfg = parseDeliveryConfig(trigger.client.deliveryConfig);
  if (!cfg.realtimeAlert.enabled) {
    return { triggerId, status: "skipped", reason: "realtime alert disabled", channels: {} };
  }
  if (trigger.score < cfg.realtimeAlert.minScore) {
    return {
      triggerId,
      status: "skipped",
      reason: `score ${trigger.score} < threshold ${cfg.realtimeAlert.minScore}`,
      channels: {},
    };
  }

  // Anti-doublon : 1 alerte max par triggerId
  const existing = await db.auditLog.findFirst({
    where: {
      clientId: trigger.clientId,
      action: "delivery.realtime_alert_sent",
      entityId: triggerId,
    },
    select: { id: true },
  });
  if (existing) {
    return { triggerId, status: "skipped", reason: "already alerted for this trigger", channels: {} };
  }

  // Rate-limit quotidien
  const since = new Date(Date.now() - 86_400_000);
  const todayCount = await db.auditLog.count({
    where: {
      clientId: trigger.clientId,
      action: "delivery.realtime_alert_sent",
      createdAt: { gte: since },
    },
  });
  if (todayCount >= cfg.realtimeAlert.maxPerDay) {
    return {
      triggerId,
      status: "skipped",
      reason: `rate-limit reached (${todayCount}/${cfg.realtimeAlert.maxPerDay} today)`,
      channels: {},
    };
  }

  const briefV2 = trigger.briefV2Json as { verdict?: string; confidence?: number; thesis?: string; opener?: string } | null;
  const thesis = briefV2?.thesis?.slice(0, 300) ?? trigger.scoreReason?.slice(0, 300) ?? "";
  const dashLink = `${DASHBOARD_URL}/triggers/${trigger.id}`;
  // Refactor V2-only Session 2 finalisation — affichage verdict V2 natif
  // dans alerts (email + Telegram). Fallback score si V2 absent.
  const verdictBadge = briefV2?.verdict
    ? `${briefV2.verdict} ${briefV2.confidence ?? "?"}%`
    : `score ${trigger.score}/10`;
  const subject = `🔥 ${cfg.brand.senderName} — Pepite: ${trigger.companyName} (${verdictBadge})`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:20px auto;padding:24px;background:#fff;border:2px solid ${cfg.brand.primaryColor};border-radius:8px">
  <div style="background:#FEE2E2;color:#991B1B;padding:6px 12px;border-radius:4px;display:inline-block;font-size:12px;font-weight:600">🔥 PEPITE • ${verdictBadge}</div>
  <h2 style="margin:16px 0 8px;color:#111827">${trigger.companyName}</h2>
  <div style="color:#6B7280;font-size:14px">${[trigger.companyNaf, trigger.size].filter(Boolean).join(" • ")} • Source: ${trigger.sourceCode}</div>
  <div style="margin-top:16px;padding:14px;background:#F9FAFB;border-left:3px solid ${cfg.brand.primaryColor};font-size:14px;line-height:1.6">${thesis}</div>
  <a href="${dashLink}" style="display:inline-block;margin-top:16px;background:${cfg.brand.primaryColor};color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500">Voir le brief complet →</a>
</div>
`;
  const text = `🔥 PEPITE — ${trigger.companyName} (${verdictBadge})
${[trigger.companyNaf, trigger.size].filter(Boolean).join(" • ")}
Source: ${trigger.sourceCode}

${thesis}

→ ${dashLink}`;

  const channels: { email?: boolean; telegram?: boolean } = {};
  let anySuccess = false;

  // Email
  if (cfg.realtimeAlert.email) {
    const emailRes = await sendEmailViaResend({
      to: cfg.realtimeAlert.email,
      subject,
      html,
      text,
      fromEmail: cfg.brand.senderEmail ?? undefined,
      fromName: cfg.brand.senderName,
    });
    channels.email = emailRes.ok;
    if (emailRes.ok) anySuccess = true;
  }

  // Telegram
  if (cfg.realtimeAlert.telegramChatId) {
    const tgRes = await sendTelegramMessage({
      chatId: cfg.realtimeAlert.telegramChatId,
      text: `🔥 *PEPITE* — *${trigger.companyName}* (${verdictBadge})\n\n${thesis}\n\n[Voir brief](${dashLink})`,
      parseMode: "Markdown",
    });
    channels.telegram = tgRes.ok;
    if (tgRes.ok) anySuccess = true;
  }

  if (!anySuccess) {
    return { triggerId, status: "failed", reason: "all channels failed", channels };
  }

  await db.auditLog.create({
    data: {
      clientId: trigger.clientId,
      action: "delivery.realtime_alert_sent",
      entityType: "Trigger",
      entityId: trigger.id,
      metadata: {
        score: trigger.score,
        companyName: trigger.companyName,
        channels,
      },
    },
  });

  console.log(`[realtime-alert] sent for ${trigger.companyName} (score=${trigger.score}) channels=${JSON.stringify(channels)}`);
  return { triggerId, status: "sent", channels };
}
