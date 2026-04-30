import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { findLinkedInUrl } from "@/lib/linkedin-finder";
import { enrichLeadsViaLinkedInFinder } from "@/lib/enrich-via-linkedin-finder";
import { db } from "@/lib/db";

/**
 * POST /api/internal/test-linkedin-finder
 *
 * 2 modes :
 *  - Mode unitaire : ?firstName=X&lastName=Y&companyName=Z
 *    → teste la cascade HarvestAPI Profile Search → Google CSE
 *  - Mode batch : ?clientId=...[&limit=15]
 *    → exécute le pipeline étage 3-bis sur les leads Qualifié+ du client
 *  - Mode leadIds : ?leadIds=id1,id2,id3
 *    → cible des leads précis (bypass gate score)
 *
 * Auth : header `x-cron-secret`.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const firstName = url.searchParams.get("firstName");
  const lastName = url.searchParams.get("lastName");
  const companyName = url.searchParams.get("companyName");
  const clientId = url.searchParams.get("clientId");
  const limit = Number(url.searchParams.get("limit") ?? "15");
  const leadIdsRaw = url.searchParams.get("leadIds");

  // Mode 3 : leadIds explicites (test ciblé sur Pépites bloquées)
  if (leadIdsRaw) {
    const leadIds = leadIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const leads = await db.lead.findMany({
      where: { id: { in: leadIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        linkedinUrl: true,
        jobTitle: true,
      },
    });
    const results = await Promise.all(
      leads.map(async (l) => {
        if (!l.firstName || !l.lastName || !l.companyName) {
          return { leadId: l.id, skipped: "missing_persona" };
        }
        if (l.linkedinUrl) {
          return { leadId: l.id, skipped: "already_has_linkedin", linkedinUrl: l.linkedinUrl };
        }
        const startedAt = Date.now();
        const found = await findLinkedInUrl({
          firstName: l.firstName,
          lastName: l.lastName,
          companyName: l.companyName,
          jobTitleHint: l.jobTitle ?? undefined,
        });
        const elapsedMs = Date.now() - startedAt;
        if (found) {
          await db.lead.update({
            where: { id: l.id },
            data: {
              linkedinUrl: found.linkedinUrl,
              linkedinSource: found.source,
              linkedinFinderAttemptedAt: new Date(),
              status: "ENRICHED",
              enrichedAt: new Date(),
            },
          });
        }
        return {
          leadId: l.id,
          input: { firstName: l.firstName, lastName: l.lastName, companyName: l.companyName },
          elapsedMs,
          found,
        };
      }),
    );
    return NextResponse.json({ ok: true, mode: "leadIds", results });
  }

  // Mode 2 : batch sur un client
  if (clientId) {
    const startedAt = Date.now();
    const result = await enrichLeadsViaLinkedInFinder(clientId, { limit });
    const elapsedMs = Date.now() - startedAt;
    return NextResponse.json({ ok: true, mode: "batch", elapsedMs, result });
  }

  // Mode 1 : unitaire
  if (!firstName || !lastName || !companyName) {
    return NextResponse.json(
      {
        error: "missing_args",
        hint: "?firstName=X&lastName=Y&companyName=Z OR ?clientId=... OR ?leadIds=id1,id2",
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const result = await findLinkedInUrl({ firstName, lastName, companyName });
  const elapsedMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: true,
    mode: "unit",
    elapsedMs,
    input: { firstName, lastName, companyName },
    result,
  });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required with x-cron-secret",
    usage: [
      "Unit: POST ?firstName=Jean&lastName=Dupont&companyName=ACME",
      "Batch: POST ?clientId=...&limit=15",
      "Targeted: POST ?leadIds=id1,id2,id3 (bypasses score gate)",
    ],
  });
}
