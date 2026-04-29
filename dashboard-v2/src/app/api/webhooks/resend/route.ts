import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActivityType, EmailEventType } from "@prisma/client";
import { logActivity } from "@/lib/lead-activity";

// Resend webhooks doc : https://resend.com/docs/dashboard/webhooks/introduction
// Signature : Svix-Id + Svix-Timestamp + Svix-Signature (HMAC SHA256)
//
// Stratégie : on log TOUS les events dans EmailEvent et on lie au Lead via
// le destinataire (recipient = lead.email). Si match → leadId, sinon null.

type ResendEvent = {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    to?: string[];
    subject?: string;
    from?: string;
    click?: { url?: string; user_agent?: string; ip_address?: string };
    open?: { user_agent?: string; ip_address?: string };
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

const TYPE_MAP: Record<string, EmailEventType> = {
  "email.delivered": "DELIVERED",
  "email.opened": "OPENED",
  "email.clicked": "CLICKED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.delivery_delayed": "FAILED",
  "email.failed": "FAILED",
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  // Vérification signature Svix HMAC SHA256 (format Resend webhooks)
  // Si secret absent → on accepte (webhook public, OK pour tracking soft).
  if (secret) {
    const id = req.headers.get("svix-id") ?? "";
    const ts = req.headers.get("svix-timestamp") ?? "";
    const sig = req.headers.get("svix-signature") ?? "";
    if (!id || !ts || !sig) {
      return NextResponse.json({ error: "missing_headers" }, { status: 401 });
    }
    // Resend secret format : "whsec_BASE64"
    const cleanSecret = secret.replace(/^whsec_/, "");
    const secretBytes = Buffer.from(cleanSecret, "base64");
    const toSign = `${id}.${ts}.${body}`;
    const expected = createHmac("sha256", secretBytes).update(toSign).digest("base64");
    // sig format : "v1,<base64> v1,<base64> ..." — check si au moins 1 match
    const provided = sig.split(" ").map((s) => s.replace(/^v1,/, ""));
    const expectedBuf = Buffer.from(expected);
    const valid = provided.some((p) => {
      try {
        const pb = Buffer.from(p);
        return pb.length === expectedBuf.length && timingSafeEqual(pb, expectedBuf);
      } catch {
        return false;
      }
    });
    if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const mappedType = TYPE_MAP[event.type];
  if (!mappedType) return NextResponse.json({ ok: true, ignored: event.type });

  const recipient = event.data.to?.[0] ?? "";
  if (!recipient) return NextResponse.json({ ok: true, skipped: "no_recipient" });

  // Lookup Lead par email (peut retourner null si pas trouvé — on garde quand même l'event)
  const lead = await db.lead.findFirst({
    where: { email: recipient, deletedAt: null },
    select: { id: true },
  });

  const evt = await db.emailEvent.create({
    data: {
      leadId: lead?.id ?? null,
      emailId: event.data.email_id ?? null,
      recipient,
      type: mappedType,
      occurredAt: event.created_at ? new Date(event.created_at) : new Date(),
      metadata: {
        click: event.data.click ?? null,
        open: event.data.open ?? null,
        bounce: event.data.bounce ?? null,
      },
    },
  });

  // Trace dans LeadActivity (timeline temps réel) si lead matché et type pertinent
  if (lead?.id) {
    const activityTypeMap: Partial<Record<EmailEventType, ActivityType>> = {
      OPENED: "EMAIL_OPEN",
      CLICKED: "EMAIL_CLICK",
      BOUNCED: "EMAIL_BOUNCE",
    };
    const activityType = activityTypeMap[mappedType];
    if (activityType) {
      await logActivity({
        leadId: lead.id,
        type: activityType,
        source: "WEBHOOK",
        direction: "INBOUND",
        occurredAt: event.created_at ? new Date(event.created_at) : new Date(),
        emailEventId: evt.id,
        payload: {
          recipient,
          click: event.data.click ?? null,
          open: event.data.open ?? null,
          bounce: event.data.bounce ?? null,
        },
      });
    }

    // Q8 — Sur bounce : on memorise l'email rejeté + on reset les flags pour
    // que le prochain cron run-pollers re-tente Rodz/Dropcontact avec une
    // chance de retrouver une autre adresse. Le waterfall doit exclure
    // bouncedFromEmail des candidats Dropcontact (cf. enrich-via-dropcontact).
    if (mappedType === "BOUNCED") {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          emailStatus: "BOUNCED",
          bouncedAt: new Date(),
          bouncedFromEmail: recipient,
          // Reset flags pour relancer le waterfall sur le prochain cron
          email: null,
          emailDropcontact: null,
          emailRodz: null,
          dropcontactAttemptedAt: null,
          rodzAttemptedAt: null,
          // kasprAttemptedAt préservé : Kaspr work email viens d'être réfuté,
          // pas la peine de re-payer pour la même adresse.
          emailConfidence: 0,
          emailSourceCount: 0,
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, leadMatched: !!lead });
}

export async function GET() {
  return NextResponse.json({ method: "POST required" });
}
