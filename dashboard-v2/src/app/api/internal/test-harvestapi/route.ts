import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveLinkedInUrl } from "@/lib/harvestapi-linkedin";

/**
 * POST /api/internal/test-harvestapi
 *
 * Test isolé du resolver HarvestAPI Profile Search SANS toucher la DB.
 * Sert à valider sur un lead concret (Asys/Salaheddine Chebil) que
 * l'actor remonte bien le bon profil avant d'activer en pipeline.
 *
 * Auth : header `x-cron-secret`.
 *
 * Modes :
 *  - ?leadId=xxx                   → résout pour ce Lead (dryRun, pas de write)
 *  - ?firstName=X&lastName=Y&companyName=Z  → résout pour les valeurs brutes
 *  - ?bypassCache=true             → force un appel API frais
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId");
  const bypassCache = url.searchParams.get("bypassCache") === "true";

  let firstName = url.searchParams.get("firstName") ?? "";
  let lastName = url.searchParams.get("lastName") ?? "";
  let companyName = url.searchParams.get("companyName") ?? "";
  let leadInfo: { id: string; companyName: string; firstName: string | null; lastName: string | null } | null = null;

  if (leadId) {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    });
    if (!lead) {
      return NextResponse.json({ error: "lead_not_found", leadId }, { status: 404 });
    }
    leadInfo = lead;
    firstName = lead.firstName ?? firstName;
    lastName = lead.lastName ?? lastName;
    companyName = lead.companyName ?? companyName;
  }

  if (!firstName || !lastName || !companyName) {
    return NextResponse.json(
      {
        error: "missing_args",
        hint: "Need (leadId) or (firstName + lastName + companyName)",
        received: { firstName, lastName, companyName },
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const result = await resolveLinkedInUrl({
    firstName,
    lastName,
    companyName,
    bypassCache,
  });
  const elapsedMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: true,
    elapsedMs,
    input: { firstName, lastName, companyName, bypassCache },
    leadInfo,
    result,
  });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required with x-cron-secret",
    usage: [
      "POST /api/internal/test-harvestapi?leadId=xxx",
      "POST /api/internal/test-harvestapi?firstName=X&lastName=Y&companyName=Z",
      "Add &bypassCache=true to force fresh API call",
    ],
  });
}
