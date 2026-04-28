import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { sendEmail, getMailbox } from "@/lib/mailbox";
import { logActivity } from "@/lib/lead-activity";

export const maxDuration = 30;

// ──────────────────────────────────────────────────────────────────────
// POST /api/leads/[id]/send-email — envoi cold email manuel
// ──────────────────────────────────────────────────────────────────────
// - Auth ADMIN ou COMMERCIAL uniquement
// - Vérifie le scope client du lead
// - Rate limit applicatif : MAILBOX_DAILY_CAP (défaut 30) emails/24h/mailbox
// - Insère EmailActivity{direction: SENT}
// - Update Lead.status = CONTACTED
// - Notif Telegram bot via le router HTTP
// ──────────────────────────────────────────────────────────────────────

interface SendEmailBody {
  fromMailboxId: string;
  toEmail?: string;
  subject: string;
  body: string;
  html?: string;
  template?: "pitch" | "linkedin-dm" | "call-brief" | "manual";
  inReplyTo?: string;
}

const DAILY_CAP = (() => {
  const raw = process.env.MAILBOX_DAILY_CAP;
  const n = raw ? parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

async function notifyTelegram(text: string): Promise<void> {
  // Route via gateway/telegram-router (port 9090) côté docker-compose.
  const url = process.env.ROUTER_URL || "http://127.0.0.1:9090";
  const adminChatId = process.env.ADMIN_CHAT_ID || "1409505520";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  } catch {
    // ignore — non critique
  }
  // Note: on n'utilise pas ROUTER_URL ici car le bot expose pas de notify endpoint dispo
  // Direct Telegram API est plus simple et fiable.
  void url;
}

function escMd(s: string): string {
  return (s || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&").substring(0, 500);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  if (s.user.role !== "ADMIN" && s.user.role !== "COMMERCIAL") {
    return NextResponse.json(
      { error: "Réservé aux rôles ADMIN ou COMMERCIAL" },
      { status: 403 },
    );
  }

  const { id } = await params;
  let body: SendEmailBody;
  try {
    body = (await req.json()) as SendEmailBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!body.fromMailboxId || !body.subject || !body.body) {
    return NextResponse.json(
      { error: "Champs requis : fromMailboxId, subject, body" },
      { status: 400 },
    );
  }

  const mb = getMailbox(body.fromMailboxId);
  if (!mb) {
    return NextResponse.json(
      { error: `Mailbox ${body.fromMailboxId} introuvable` },
      { status: 400 },
    );
  }

  const lead = await db.lead.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      email: true,
      fullName: true,
      companyName: true,
      status: true,
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const toEmail = (body.toEmail || lead.email || "").trim();
  if (!toEmail) {
    return NextResponse.json(
      { error: "Pas d'email destinataire (ni override ni Lead.email)" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return NextResponse.json({ error: "Email destinataire invalide" }, { status: 400 });
  }

  // Rate limit applicatif : N envois/24h/mailbox
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const sentCount = await db.emailActivity.count({
    where: { fromMailbox: mb.user, direction: "SENT", sentAt: { gte: since } },
  });
  if (sentCount >= DAILY_CAP) {
    return NextResponse.json(
      {
        error: `Quota journalier atteint (${sentCount}/${DAILY_CAP}) sur ${mb.user}. Réessayez demain.`,
      },
      { status: 429 },
    );
  }

  // Send via SMTP
  const result = await sendEmail({
    fromMailboxId: body.fromMailboxId,
    to: toEmail,
    subject: body.subject,
    body: body.body,
    html: body.html,
    inReplyTo: body.inReplyTo,
    replyToName: process.env.SENDER_FULL_NAME || mb.label,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Envoi SMTP échoué", detail: result.error },
      { status: 502 },
    );
  }

  // Insert EmailActivity (direction SENT)
  const activity = await db.emailActivity.create({
    data: {
      leadId: lead.id,
      direction: "SENT",
      fromMailbox: mb.user,
      toEmail,
      subject: body.subject,
      bodyText: body.body,
      bodyHtml: body.html,
      messageId: result.messageId,
      inReplyTo: body.inReplyTo,
      sentAt: new Date(),
      sentByUserId: s.user.id,
      template: body.template ?? "manual",
    },
  });

  // Trace dans LeadActivity (timeline temps réel multi-canal)
  await logActivity({
    leadId: lead.id,
    type: "EMAIL_SENT",
    source: "MANUAL",
    direction: "OUTBOUND",
    userId: s.user.id,
    emailActivityId: activity.id,
    payload: {
      subject: body.subject,
      fromMailbox: mb.user,
      toEmail,
      template: body.template ?? "manual",
    },
  });

  // Update lead status si NEW/ENRICHED/CONTACTABLE
  if (
    lead.status === "NEW" ||
    lead.status === "ENRICHED" ||
    lead.status === "CONTACTABLE"
  ) {
    await db.lead.update({
      where: { id: lead.id },
      data: { status: "CONTACTED" },
    });
  }

  // Telegram notification (admin + commercial)
  const notif = [
    "📤 *Email envoyé*",
    "",
    `👤 *Lead :* ${escMd(lead.fullName || "—")} — ${escMd(lead.companyName || "—")}`,
    `📧 *To :* ${escMd(toEmail)}`,
    `📥 *From :* ${escMd(mb.user)}`,
    `📋 *Sujet :* ${escMd(body.subject)}`,
    `🧑 *Par :* ${escMd(s.user.name || s.user.email)}`,
    body.template ? `🏷️ *Template :* ${escMd(body.template)}` : "",
    "",
    `_${sentCount + 1}/${DAILY_CAP} envoyés aujourd'hui sur cette mailbox._`,
  ]
    .filter(Boolean)
    .join("\n");
  void notifyTelegram(notif);

  return NextResponse.json({
    ok: true,
    activityId: activity.id,
    messageId: result.messageId,
    sentAt: activity.sentAt.toISOString(),
    dailyCount: sentCount + 1,
    dailyCap: DAILY_CAP,
  });
}
