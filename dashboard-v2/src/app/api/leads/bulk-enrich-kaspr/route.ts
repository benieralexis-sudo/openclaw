import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { enrichLinkedInProfile, isValidLinkedInUrl, pickPhone } from "@/lib/kaspr";

// POST /api/leads/bulk-enrich-kaspr
// Body : { leadIds: string[] }
// Pour chaque lead avec linkedinUrl valide, déclenche enrichissement Kaspr.
// Plafond strict : max 20 leads par appel (protection crédits Kaspr).

const MAX_LEADS_PER_CALL = 20;

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
      firstName: true,
      lastName: true,
      fullName: true,
      linkedinUrl: true,
      kasprEnrichedAt: true,
    },
  });

  // Vérif scope user pour chaque lead
  const allowed = leads.filter((l) => {
    const scope = resolveClientScope(s.user, l.clientId);
    return scope.ok && (scope.clientId === null || scope.clientId === l.clientId);
  });

  const result = {
    requested: leadIds.length,
    found: leads.length,
    allowed: allowed.length,
    enriched: 0,
    skipped_no_linkedin: 0,
    skipped_already_enriched: 0,
    skipped_recent: 0,
    errors: 0,
  };

  for (const lead of allowed) {
    if (!lead.linkedinUrl || !isValidLinkedInUrl(lead.linkedinUrl)) {
      result.skipped_no_linkedin++;
      continue;
    }
    // Cache 7j : skip si déjà enrichi récemment
    if (lead.kasprEnrichedAt) {
      const age = Date.now() - lead.kasprEnrichedAt.getTime();
      if (age < 7 * 24 * 3600 * 1000) {
        result.skipped_recent++;
        continue;
      }
    }
    const fullName = lead.fullName ?? [lead.firstName, lead.lastName].filter(Boolean).join(" ");
    if (!fullName) {
      result.skipped_no_linkedin++;
      continue;
    }
    try {
      const kr = await enrichLinkedInProfile({
        id: lead.linkedinUrl,
        name: fullName,
        dataToGet: ["workEmail", "phone"],
      });
      if (kr.ok && kr.profile) {
        const we = kr.profile.workEmail;
        const workEmail = typeof we === "string" ? we : we?.email ?? null;
        const phone = pickPhone(kr.profile.phones ?? kr.profile.phone ?? null);
        await db.lead.update({
          where: { id: lead.id },
          data: {
            ...(workEmail ? { kasprWorkEmail: workEmail } : {}),
            ...(phone ? { kasprPhone: phone } : {}),
            kasprEnrichedAt: new Date(),
          },
        });
        result.enriched++;
      } else {
        result.errors++;
      }
    } catch {
      result.errors++;
    }
  }

  return NextResponse.json(result);
}
