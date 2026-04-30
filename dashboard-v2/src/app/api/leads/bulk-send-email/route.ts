import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";

// POST /api/leads/bulk-send-email
// Body : { leadIds: string[], mailbox: string, template: "pitch"|"linkedin-dm"|"call-brief" }
//
// Endpoint simple qui retourne la liste des leads ELIGIBLES pour l'envoi groupé
// (avec email valid + pas en NOT_INTERESTED). Le commercial reçoit la liste
// + doit valider/envoyer un par un via la modal SendEmail existante (ne pas
// envoyer auto en bulk pour préserver la deliverability et permettre review).

const MAX_LEADS_PER_CALL = 30;

export async function POST(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  if (s.user.role !== "ADMIN" && s.user.role !== "COMMERCIAL") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { leadIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const leadIds = (body.leadIds ?? []).slice(0, MAX_LEADS_PER_CALL);
  if (leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds_required" }, { status: 400 });
  }

  const leads = await db.lead.findMany({
    where: { id: { in: leadIds }, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      companyName: true,
      companySiret: true,
      fullName: true,
      firstName: true,
      lastName: true,
      email: true,
      emailStatus: true,
      status: true,
      bouncedAt: true,
      doNotContact: true,
      doNotContactReason: true,
    },
  });

  // Cooldown 7j par société (audit 30/04) : on évite d'envoyer 2 emails à des
  // personas différentes de la même boîte en moins de 7 jours. Triple message
  // sur la même boîte = signal de spam fort pour les providers email.
  const COOLDOWN_DAYS = 7;
  const sevenDaysAgo = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const sirets = leads
    .map((l) => l.companySiret)
    .filter((s): s is string => !!s);
  // Trouver pour chaque SIRET le dernier email envoyé < 7j (via EmailActivity
  // SENT joint sur Lead.companySiret).
  const recentSends = sirets.length
    ? await db.emailActivity.findMany({
        where: {
          direction: "SENT",
          sentAt: { gte: sevenDaysAgo },
          lead: { companySiret: { in: sirets } },
        },
        select: {
          sentAt: true,
          lead: { select: { companySiret: true, fullName: true } },
        },
        orderBy: { sentAt: "desc" },
      })
    : [];
  const cooldownBySiret = new Map<string, { sentAt: Date; toFullName: string | null }>();
  for (const ea of recentSends) {
    const siret = ea.lead?.companySiret;
    if (!siret) continue;
    if (!cooldownBySiret.has(siret)) {
      cooldownBySiret.set(siret, { sentAt: ea.sentAt, toFullName: ea.lead?.fullName ?? null });
    }
  }

  const eligible: typeof leads = [];
  const skipped: Array<{ leadId: string; reason: string; detail?: string }> = [];

  for (const lead of leads) {
    const scope = resolveClientScope(s.user, lead.clientId);
    if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
      skipped.push({ leadId: lead.id, reason: "out_of_scope" });
      continue;
    }
    if (!lead.email) {
      skipped.push({ leadId: lead.id, reason: "no_email" });
      continue;
    }
    if (lead.status === "NOT_INTERESTED" || lead.status === "ARCHIVED") {
      skipped.push({ leadId: lead.id, reason: "status_blocked" });
      continue;
    }
    if (lead.bouncedAt) {
      skipped.push({ leadId: lead.id, reason: "previous_bounce", detail: lead.bouncedAt.toISOString() });
      continue;
    }
    if (lead.doNotContact) {
      skipped.push({
        leadId: lead.id,
        reason: "do_not_contact",
        detail: lead.doNotContactReason ?? "opt_out",
      });
      continue;
    }
    if (lead.companySiret) {
      const cooldown = cooldownBySiret.get(lead.companySiret);
      if (cooldown) {
        const daysAgo = Math.floor((Date.now() - cooldown.sentAt.getTime()) / (24 * 60 * 60 * 1000));
        skipped.push({
          leadId: lead.id,
          reason: "cooldown_company",
          detail: `Email envoyé à ${cooldown.toFullName ?? "qqn"} il y a ${daysAgo}j sur cette boîte (cooldown ${COOLDOWN_DAYS}j)`,
        });
        continue;
      }
    }
    eligible.push(lead);
  }

  return NextResponse.json({
    eligible: eligible.map((l) => ({
      id: l.id,
      companyName: l.companyName,
      fullName: l.fullName ?? `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      email: l.email,
    })),
    skipped,
    count: { eligible: eligible.length, skipped: skipped.length, total: leadIds.length },
  });
}
