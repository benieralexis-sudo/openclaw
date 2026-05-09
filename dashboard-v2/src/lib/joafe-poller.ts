import "server-only";

/**
 * Sprint 1 (10/05/2026) — Poller JOAFE pour dashboard-v2.
 *
 * JOAFE = Journal Officiel des Associations et Fondations d'Entreprise.
 * Source : DILA Open Data (https://echanges.dila.gouv.fr/OPENDATA/ASSOCIATIONS/).
 * Format : tar bulk hebdomadaire ~3.7 MB XML ISO-8859-1.
 *
 * STATUT MIGRATION : STUB MINIMAL.
 *
 * Le bot trigger-engine a capté 11278 events JOAFE sur 6 mois mais quasiment
 * aucun n'a produit de lead utile pour DTL (ICP DTL = SaaS B2B QA, pas
 * associations / fondations). La complexité de migration (tar-stream + ISO-8859-1
 * decoding) ne justifie pas le ROI sur l'ICP actuel.
 *
 * Décision Sprint 1 : on stub à 0 events. Si client #2 a un ICP qui bénéficie
 * de JOAFE (CSR/RSE budgets, associations pro), on finalise Sprint 2.
 *
 * Code source bot conservé : skills/trigger-engine/sources/joafe.js (193 lignes).
 * Ne pas supprimer tant que ce stub n'est pas étendu.
 */

import { db } from "@/lib/db";

export interface JoafePollerResult {
  clientId: string;
  itemsFetched: number;
  triggersCreated: number;
  errors: string[];
  status: "stub" | "active";
}

export async function pollJoafeForClient(
  clientId: string,
): Promise<JoafePollerResult> {
  const result: JoafePollerResult = {
    clientId,
    itemsFetched: 0,
    triggersCreated: 0,
    errors: [],
    status: "stub",
  };

  // Validation client existe + actif (pour cohérence avec autres pollers)
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!client || client.deletedAt || client.status !== "ACTIVE") {
    result.errors.push(`Client ${clientId} not active or deleted`);
    return result;
  }

  console.log(
    `[joafe-poller] ${clientId}: STUB — JOAFE migration deferred (low ROI for current ICPs). See joafe-poller.ts header.`,
  );

  return result;
}
