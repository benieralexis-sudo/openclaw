import "server-only";
import { NextRequest, NextResponse } from "next/server";

/**
 * 🛑 ENDPOINT DÉSACTIVÉ — 29/04/2026 (audit waterfall)
 *
 * Pourquoi : la génération d'emails par pattern (prenom.nom@domaine) produit
 * des emails UNVERIFIED. Sans MillionVerifier en amont (pas encore acheté),
 * le taux de bounce monte à >30% sur les nouveaux domaines. Conséquence :
 *  - Réputation Primeforge détruite (les domaines warming J0-J14 sont fragiles)
 *  - Mails partent en spam même sur les leads valides
 *  - Risque commercial irréversible
 *
 * Réactivation : retirer ce shim une fois MillionVerifier 20€/mo branché et
 * le pipeline `verify → enrich → send` câblé. À ce moment-là, restaurer la
 * version d'avant via `git log` sur ce fichier.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: "endpoint_disabled",
      reason:
        "email pattern DIY produit des emails non vérifiés → bounce >30% → risque réputation Primeforge. Réactivation après achat MillionVerifier.",
      since: "2026-04-29",
    },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json(
    { error: "endpoint_disabled", since: "2026-04-29" },
    { status: 410 },
  );
}
