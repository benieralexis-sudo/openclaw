import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { generateCopyForLead } from "@/lib/copy-runner";

/**
 * POST /api/internal/test-copy?leadId=X&force=true
 *
 * Endpoint test interne — bypass session Better Auth pour permettre la
 * validation e2e du Copy Engine via curl en CI / dev.
 *
 * Auth : x-cron-secret.
 */

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId");
  if (!leadId) {
    return NextResponse.json({ error: "leadId requis" }, { status: 400 });
  }
  const force = url.searchParams.get("force") === "true";

  const result = await generateCopyForLead({ leadId, force });
  return NextResponse.json(result);
}
