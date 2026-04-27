import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/server/session";
import { listMailboxes } from "@/lib/mailbox";

// ──────────────────────────────────────────────────────────────────────
// GET /api/mailboxes — liste des mailboxes Primeforge actives
// ──────────────────────────────────────────────────────────────────────
// Renvoie uniquement { id, user, label } — JAMAIS l'app password.
// Auth requise (toute role authenticated peut voir la liste).

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const mailboxes = listMailboxes();
  return NextResponse.json({ mailboxes });
}
