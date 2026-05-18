import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { creditOveragePurchase } from "@/lib/credits";
import { requireApiSession, resolveClientScope } from "@/server/session";

/**
 * V1 18/05/2026 — Endpoint dev pour simuler l'achat d'overage (sans Stripe).
 *
 * Permet de débloquer un client capé en lui créditant N leads (8€/lead virtuel,
 * non facturé). Remplacera plus tard par un webhook Stripe Checkout.
 *
 * Permissions :
 *   - ADMIN : peut acheter pour n'importe quel client
 *   - CLIENT/EDITOR : peut acheter pour son propre client uniquement
 *   - VIEWER/COMMERCIAL : refusé
 *
 * Body : { clientId: string, amount: 1 | 5 | 10 | 25 }
 */
const Body = z.object({
  clientId: z.string().min(1),
  amount: z.number().int().min(1).max(50),
});

export async function POST(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const scope = resolveClientScope(s.user, parsed.data.clientId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  if (s.user.role === "VIEWER" || s.user.role === "COMMERCIAL") {
    return NextResponse.json({ error: "Lecture seule" }, { status: 403 });
  }

  // Simule un invoiceId stripe avec un timestamp pour traçabilité audit.
  const fakeInvoiceId = `simulated-overage-${Date.now()}`;

  try {
    const result = await creditOveragePurchase({
      clientId: parsed.data.clientId,
      amount: parsed.data.amount,
      stripeInvoiceId: fakeInvoiceId,
    });
    return NextResponse.json({
      ok: true,
      amount: parsed.data.amount,
      newBalance: result.newBalance,
      invoiceId: fakeInvoiceId,
      note: "Achat simulé sans facturation Stripe — remplacer par webhook réel en prod.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
