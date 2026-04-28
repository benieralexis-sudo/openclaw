import { NextResponse, type NextRequest } from "next/server";
import { auditAndHeal } from "@/lib/audit-heal";

// POST /api/internal/audit-heal — déclenchable à la main pour rattrapage
// massif. Protégé par CRON_SECRET. Idempotent : safe à relancer.
//
// Query params :
//   - clientId=xxx (optionnel, sinon tous clients)

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;

  const result = await auditAndHeal({ clientId });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), result });
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" });
}
