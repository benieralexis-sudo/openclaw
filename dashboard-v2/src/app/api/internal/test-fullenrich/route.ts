import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichBulk, waitForBulk, pickBestEmail, pickBestPhone, FullEnrichError } from "@/lib/fullenrich";

/**
 * POST /api/internal/test-fullenrich
 *
 * Test isolé du provider FullEnrich SANS toucher la DB.
 * Auth : header `x-cron-secret`.
 *
 * Usage :
 *   POST ?leadId=xxx                          → enrich 1 lead, dryRun
 *   POST ?firstname=X&lastname=Y&company=Z[&linkedin=...]
 *   POST ?leadIds=id1,id2,id3                 → enrich plusieurs leads
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId");
  const leadIdsRaw = url.searchParams.get("leadIds");
  const firstname = url.searchParams.get("firstname");
  const lastname = url.searchParams.get("lastname");
  const company = url.searchParams.get("company");
  const linkedin = url.searchParams.get("linkedin");
  const includePhones = url.searchParams.get("includePhones") !== "false";

  let datas: Array<{
    firstname?: string;
    lastname?: string;
    company_name?: string;
    linkedin_url?: string;
    enrich_fields: ("contact.emails" | "contact.work_emails" | "contact.personal_emails" | "contact.phones")[];
    custom?: { leadId?: string };
  }> = [];

  const enrichFields: ("contact.emails" | "contact.phones")[] = includePhones
    ? ["contact.emails", "contact.phones"]
    : ["contact.emails"];

  if (leadIdsRaw) {
    const ids = leadIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const leads = await db.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, companyName: true, linkedinUrl: true },
    });
    datas = leads.map((l) => ({
      firstname: l.firstName ?? undefined,
      lastname: l.lastName ?? undefined,
      company_name: l.companyName,
      linkedin_url: l.linkedinUrl ?? undefined,
      enrich_fields: enrichFields,
      custom: { leadId: l.id },
    }));
  } else if (leadId) {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { id: true, firstName: true, lastName: true, companyName: true, linkedinUrl: true },
    });
    if (!lead) return NextResponse.json({ error: "lead_not_found", leadId }, { status: 404 });
    datas = [{
      firstname: lead.firstName ?? undefined,
      lastname: lead.lastName ?? undefined,
      company_name: lead.companyName,
      linkedin_url: lead.linkedinUrl ?? undefined,
      enrich_fields: enrichFields,
      custom: { leadId: lead.id },
    }];
  } else if (firstname && lastname && company) {
    datas = [{
      firstname, lastname, company_name: company,
      linkedin_url: linkedin ?? undefined,
      enrich_fields: enrichFields,
    }];
  } else {
    return NextResponse.json(
      { error: "missing_args", hint: "?leadId=X | ?leadIds=X,Y,Z | ?firstname=X&lastname=Y&company=Z[&linkedin=...]" },
      { status: 400 },
    );
  }

  if (datas.length === 0) {
    return NextResponse.json({ error: "no_data" }, { status: 400 });
  }

  const startedAt = Date.now();
  let bulkId: string;
  try {
    const r = await enrichBulk({ name: `test-${Date.now()}`, datas });
    bulkId = r.enrichment_id;
  } catch (e) {
    if (e instanceof FullEnrichError) {
      return NextResponse.json({ error: "fullenrich_error", code: e.code, message: e.message, status: e.status }, { status: 502 });
    }
    return NextResponse.json({ error: "internal", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Polling
  let bulk;
  try {
    bulk = await waitForBulk(bulkId, { timeoutMs: 90_000, pollIntervalMs: 3_000 });
  } catch (e) {
    return NextResponse.json({ error: "poll_failed", message: e instanceof Error ? e.message : String(e), bulkId }, { status: 504 });
  }

  // Format human-readable summary
  const summary = bulk.datas.map((d, i) => {
    const c = d.contact;
    return {
      input: datas[i] && {
        name: `${datas[i]!.firstname} ${datas[i]!.lastname}`,
        company: datas[i]!.company_name,
        leadId: datas[i]!.custom?.leadId,
      },
      bestEmail: pickBestEmail(c),
      bestPhone: pickBestPhone(c),
      emailsFound: c?.emails?.length ?? 0,
      phonesFound: c?.phones?.length ?? 0,
      personalEmails: c?.personal_emails?.length ?? 0,
    };
  });

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    bulkId,
    status: bulk.status,
    creditsUsed: bulk.cost?.credits ?? 0,
    summary,
    raw: bulk,
  });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required with x-cron-secret",
    usage: [
      "POST /api/internal/test-fullenrich?leadId=xxx",
      "POST /api/internal/test-fullenrich?leadIds=id1,id2,id3",
      "POST /api/internal/test-fullenrich?firstname=X&lastname=Y&company=Z[&linkedin=URL]",
      "Add &includePhones=false to skip phones (saves 10 credits/lead)",
    ],
  });
}
