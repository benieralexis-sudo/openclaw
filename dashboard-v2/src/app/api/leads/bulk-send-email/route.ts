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
      fullName: true,
      firstName: true,
      lastName: true,
      email: true,
      emailStatus: true,
      status: true,
    },
  });

  const eligible: typeof leads = [];
  const skipped: Array<{ leadId: string; reason: string }> = [];

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
