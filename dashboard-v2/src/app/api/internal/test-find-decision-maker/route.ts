import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { findDecisionMakerByCompany, inferSignalType, type SignalType } from "@/lib/harvestapi-decision-makers";

/**
 * POST /api/internal/test-find-decision-maker
 *
 * Test isolé du resolver HarvestAPI search-by-company qui trouve
 * le décideur pertinent dans une entreprise selon le type de signal.
 *
 * Auth : header `x-cron-secret`.
 *
 * Usage :
 *   POST ?companyName=Davidson%20Consulting&signalType=qa-hire
 *   POST ?companyName=Toasty&signalType=tech-hire
 *   POST ?companyName=Davidson%20Consulting&signalType=qa-hire&bypassCache=true
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const companyName = url.searchParams.get("companyName") ?? "";
  const signalTypeRaw = url.searchParams.get("signalType") ?? "default";
  const sourceCode = url.searchParams.get("sourceCode");
  const bypassCache = url.searchParams.get("bypassCache") === "true";
  const maxItems = Number(url.searchParams.get("maxItems") ?? "12");

  if (!companyName) {
    return NextResponse.json(
      { error: "missing_args", hint: "?companyName=X[&signalType=qa-hire|fundraising|tech-hire|expansion|default]" },
      { status: 400 },
    );
  }

  // Si on passe un sourceCode (ex: apify.linkedin-jobs), on infère le signalType
  const signalType: SignalType = sourceCode
    ? inferSignalType(sourceCode)
    : (signalTypeRaw as SignalType);

  const startedAt = Date.now();
  const result = await findDecisionMakerByCompany({
    companyName,
    signalType,
    bypassCache,
    maxItems,
  });
  const elapsedMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: true,
    elapsedMs,
    input: { companyName, signalType, sourceCode, bypassCache, maxItems },
    result,
  });
}

export async function GET() {
  return NextResponse.json({
    method: "POST required with x-cron-secret",
    usage: [
      "POST /api/internal/test-find-decision-maker?companyName=Davidson%20Consulting&signalType=qa-hire",
      "Signal types: qa-hire | fundraising | tech-hire | expansion | default",
      "Or pass sourceCode (e.g. apify.linkedin-jobs) to auto-infer signalType",
      "Add &bypassCache=true to force fresh API call",
    ],
  });
}
