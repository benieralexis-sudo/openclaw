import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logActivity } from "@/lib/lead-activity";

// ═══════════════════════════════════════════════════════════════════
// Cal.com webhook handler
// Doc : https://cal.com/docs/core-features/webhooks
// Events utiles : BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED
//
// Quand un prospect book un RDV via le lien cal.eu dans l'email cold :
//   1. on trouve le Lead via attendee.email == lead.email
//   2. on update Lead.status = "BOOKED"
//   3. on crée Opportunity avec stage=MEETING_SET + meetingDate + meetingUrl
//   4. on alerte Telegram admin
// ═══════════════════════════════════════════════════════════════════

type CalWebhook = {
  triggerEvent: string;
  payload?: {
    uid?: string;
    title?: string;
    startTime?: string;
    endTime?: string;
    organizer?: { email?: string; name?: string };
    attendees?: Array<{ email?: string; name?: string }>;
    location?: string;
    metadata?: Record<string, unknown>;
    cancellationReason?: string;
  };
};

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 14);
  return `c${ts}${rand}`.slice(0, 25).padEnd(25, "0");
}

async function notifyTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // skip silencieux
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.CAL_WEBHOOK_SECRET;

  // Vérification signature Cal.com (HMAC SHA256 du body avec secret)
  if (secret) {
    const sig = req.headers.get("x-cal-signature-256") ?? "";
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    try {
      const sigBuf = Buffer.from(sig.replace(/^sha256=/, ""), "hex");
      const expBuf = Buffer.from(expected, "hex");
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  let event: CalWebhook;
  try {
    event = JSON.parse(body) as CalWebhook;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const trigger = event.triggerEvent;
  const payload = event.payload ?? {};

  // Cherche le Lead par email attendee
  const attendeeEmail = payload.attendees?.[0]?.email;
  if (!attendeeEmail) {
    return NextResponse.json({ ok: true, skipped: "no_attendee_email" });
  }

  const lead = await db.lead.findFirst({
    where: { email: attendeeEmail, deletedAt: null },
    select: { id: true, clientId: true, companyName: true, fullName: true, triggerId: true },
  });
  if (!lead) {
    return NextResponse.json({ ok: true, skipped: "lead_not_found", email: attendeeEmail });
  }

  if (trigger === "BOOKING_CREATED" || trigger === "BOOKING_RESCHEDULED") {
    const meetingDate = payload.startTime ? new Date(payload.startTime) : null;
    const meetingUrl = payload.location ?? null;

    // Update Lead status (CONTACTED — le tracking BOOKED est dans Opportunity)
    await db.lead.update({
      where: { id: lead.id },
      data: { status: "CONTACTED" },
    });

    // Upsert Opportunity (lié au triggerId si dispo, sinon stage MEETING_SET)
    const existing = lead.triggerId
      ? await db.opportunity.findFirst({
          where: { triggerId: lead.triggerId, deletedAt: null },
          select: { id: true },
        })
      : null;
    let opportunityId: string;
    if (existing) {
      await db.opportunity.update({
        where: { id: existing.id },
        data: {
          stage: "MEETING_SET",
          meetingDate,
          meetingUrl,
        },
      });
      opportunityId = existing.id;
    } else {
      const created = await db.opportunity.create({
        data: {
          id: genCuid(),
          clientId: lead.clientId,
          leadId: lead.id,
          triggerId: lead.triggerId,
          stage: "MEETING_SET",
          meetingDate,
          meetingUrl,
        },
        select: { id: true },
      });
      opportunityId = created.id;
    }

    // Trace dans LeadActivity (timeline temps réel)
    await logActivity({
      leadId: lead.id,
      type: "MEETING_BOOKED",
      source: "WEBHOOK",
      direction: "INBOUND",
      occurredAt: meetingDate ?? new Date(),
      opportunityId,
      payload: {
        meetingDate: meetingDate?.toISOString() ?? null,
        meetingUrl,
        attendeeEmail,
      },
    });

    await notifyTelegram(
      `📅 *RDV booké via Cal.com*\n` +
        `\n🏢 *Lead :* ${lead.fullName ?? "—"} (${lead.companyName})` +
        `\n📧 ${attendeeEmail}` +
        `\n🕒 ${meetingDate?.toLocaleString("fr-FR") ?? "—"}` +
        `\n🔗 ${meetingUrl ?? "(pas de lien)"}`,
    );
    return NextResponse.json({ ok: true, action: "booking_created", leadId: lead.id });
  }

  if (trigger === "BOOKING_CANCELLED") {
    const opp = lead.triggerId
      ? await db.opportunity.findFirst({
          where: { triggerId: lead.triggerId, deletedAt: null },
          select: { id: true },
        })
      : null;
    if (opp) {
      await db.opportunity.update({
        where: { id: opp.id },
        data: {
          stage: "LOST",
          lostReason: payload.cancellationReason ?? "RDV annulé",
          closedAt: new Date(),
          lostAt: new Date(),
        },
      });
    }
    await db.lead.update({
      where: { id: lead.id },
      data: { status: "CONTACTED" },
    });
    return NextResponse.json({ ok: true, action: "booking_cancelled", leadId: lead.id });
  }

  return NextResponse.json({ ok: true, ignored: trigger });
}

export async function GET() {
  return NextResponse.json({ method: "POST required (Cal.com webhook)" });
}
