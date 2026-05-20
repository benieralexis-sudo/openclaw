import "server-only";
import { db } from "@/lib/db";
import { detectEquipmentForCompany } from "@/lib/equipment-detector-fetch";
import { inferDomainFromPayload } from "@/lib/equipment-detector";

/**
 * Pilier 3 (20/05/2026) — runner async qui dépile les Triggers en attente
 * de check équipement.
 *
 * Pattern : à chaque verdict OUI dans `qualify-trigger.ts`, on pose
 * `equipmentStatus = PENDING`. Ce runner dépile par batch de N et résout
 * chaque Trigger en NONE / EQUIPPED / UNKNOWN.
 *
 * - Si EQUIPPED : on downgrade le Trigger en IGNORED + archive Lead.
 * - Si UNKNOWN : on garde le Lead en INCOMPLETE (politique stricte
 *   demandée 20/05 : pas de lead non-sûr livré).
 * - Si NONE : on laisse le Trigger NEW (livraison normale).
 *
 * Cache : `equipmentCheckedAt` posé à la fin → un re-run ne re-check pas
 * dans les 30j (l'inventaire concurrents change peu).
 *
 * Sécurité perf : cap CHECKS_PER_RUN, timeout HTTP 6s/URL, max ~30 URLs
 * fetchées par check (méthode A + B combinées).
 */

const CHECKS_PER_RUN = 25;

export interface EquipmentRunnerResult {
  scanned: number;
  none: number;
  equipped: number;
  unknown: number;
  errors: number;
  durationMs: number;
}

/**
 * Process la queue des Triggers PENDING pour un client donné.
 *
 * Retourne le breakdown des status finaux + erreurs.
 */
export async function runEquipmentDetectorForClient(
  clientId: string,
  opts?: { limit?: number; logPrefix?: string },
): Promise<EquipmentRunnerResult> {
  const start = Date.now();
  const limit = opts?.limit ?? CHECKS_PER_RUN;
  const logPrefix = opts?.logPrefix ?? "[equipment-detector]";

  const result: EquipmentRunnerResult = {
    scanned: 0,
    none: 0,
    equipped: 0,
    unknown: 0,
    errors: 0,
    durationMs: 0,
  };

  // Récupère les concurrents depuis l'ICP du client (icp.antiPersonas)
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, slug: true, icp: true, status: true, deletedAt: true },
  });
  if (!client || client.deletedAt || (client.status !== "ACTIVE" && client.status !== "PROSPECT")) {
    console.log(`${logPrefix} ${clientId}: client inactive/deleted, skip`);
    result.durationMs = Date.now() - start;
    return result;
  }

  const icp = client.icp as { antiPersonas?: string[] } | null;
  const competitors = (icp?.antiPersonas ?? []).filter(
    (x): x is string => typeof x === "string" && x.trim().length >= 3,
  );
  if (competitors.length === 0) {
    console.log(
      `${logPrefix} ${client.slug}: aucun antiPersonas configuré, équipement non vérifiable. Skip.`,
    );
    result.durationMs = Date.now() - start;
    return result;
  }

  // Dépile : Triggers de ce client avec PENDING. On priorise les + récents
  // (capturedAt desc) car ce sont ceux que Fred va voir en premier.
  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      equipmentStatus: "PENDING",
      deletedAt: null,
      // Verdict OUI uniquement (V2 brief). Les ENRICH/NON ne seront jamais
      // livrés donc inutile de checker leur équipement.
      score: { gte: 6 },
    },
    select: {
      id: true,
      companyName: true,
      companySiret: true,
      rawPayload: true,
    },
    orderBy: { capturedAt: "desc" },
    take: limit,
  });

  for (const trigger of triggers) {
    result.scanned++;
    try {
      // 1) Trouver le domain depuis rawPayload
      const domain = inferDomainFromPayload(trigger.rawPayload);

      // 2) Lancer la détection (méthodes A + B)
      const detection = await detectEquipmentForCompany(
        trigger.companyName,
        domain,
        competitors,
      );

      // 3) Update Trigger avec le résultat
      await db.trigger.update({
        where: { id: trigger.id },
        data: {
          equipmentStatus: detection.status,
          equipmentDetails: detection as unknown as object,
          equipmentCheckedAt: new Date(),
        },
      });

      // 4) Appliquer la politique stricte
      if (detection.status === "EQUIPPED") {
        result.equipped++;
        console.log(
          `${logPrefix} ${trigger.id} (${trigger.companyName}) EQUIPPED — competitor=${detection.competitor}. Downgrade IGNORED + archive Lead.`,
        );
        await downgradeTriggerEquipped(trigger.id, detection.competitor);
      } else if (detection.status === "UNKNOWN") {
        result.unknown++;
        console.log(
          `${logPrefix} ${trigger.id} (${trigger.companyName}) UNKNOWN — ${detection.reason}. Lead → INCOMPLETE.`,
        );
        await downgradeTriggerUnknown(trigger.id, detection.reason);
      } else {
        result.none++;
        console.log(
          `${logPrefix} ${trigger.id} (${trigger.companyName}) NONE — OK à livrer.`,
        );
      }
    } catch (e) {
      result.errors++;
      console.error(
        `${logPrefix} ${trigger.id} erreur: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Pose UNKNOWN pour ne pas re-scanner immédiatement
      try {
        await db.trigger.update({
          where: { id: trigger.id },
          data: {
            equipmentStatus: "UNKNOWN",
            equipmentDetails: {
              error: e instanceof Error ? e.message : String(e),
            },
            equipmentCheckedAt: new Date(),
          },
        });
      } catch {
        // ignore
      }
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Politique stricte EQUIPPED : downgrade Trigger en IGNORED + archive Lead.
 * Raison explicite pour audit ("déjà équipé d'un concurrent").
 */
async function downgradeTriggerEquipped(
  triggerId: string,
  competitor: string | null,
): Promise<void> {
  const reason = `Anti-filter Pilier 3 : déjà équipé d'un concurrent (${competitor ?? "inconnu"}). Ne pas livrer.`;

  await db.trigger.update({
    where: { id: triggerId },
    data: {
      status: "IGNORED",
      ignoredAt: new Date(),
      ignoredReason: reason,
    },
  });

  // Archive le Lead associé s'il existe (sans le soft-delete : on garde
  // pour traçabilité audit). La traçabilité de la raison vit dans
  // Trigger.ignoredReason — on relit toujours via la jointure Lead→Trigger.
  await db.lead.updateMany({
    where: { triggerId, deletedAt: null, status: { not: "ARCHIVED" } },
    data: {
      status: "ARCHIVED",
    },
  });
}

/**
 * Politique stricte UNKNOWN : on n'archive PAS (pas la peine de gaspiller
 * le travail) mais on passe le Lead en INCOMPLETE pour qu'il n'apparaisse
 * pas dans la vue Fred jusqu'à enrichissement manuel.
 *
 * La raison est tracée dans Trigger.equipmentDetails.reason — pas besoin de
 * dupliquer sur Lead (jointure suffit).
 */
async function downgradeTriggerUnknown(
  triggerId: string,
  _reason: string,
): Promise<void> {
  await db.lead.updateMany({
    where: {
      triggerId,
      deletedAt: null,
      status: { in: ["NEW", "ENRICHED"] },
    },
    data: {
      status: "INCOMPLETE",
    },
  });
}

/**
 * Process tous les clients actifs en séquentiel (cap LIMIT × N clients).
 * Appelé depuis le cron VPS (run-pollers-cron.sh).
 */
export async function runEquipmentDetectorForAllClients(opts?: {
  limit?: number;
}): Promise<Record<string, EquipmentRunnerResult>> {
  const clients = await db.client.findMany({
    where: {
      status: { in: ["ACTIVE", "PROSPECT"] },
      deletedAt: null,
    },
    select: { id: true, slug: true },
  });

  const results: Record<string, EquipmentRunnerResult> = {};
  for (const c of clients) {
    results[c.slug] = await runEquipmentDetectorForClient(c.id, {
      limit: opts?.limit ?? CHECKS_PER_RUN,
      logPrefix: `[equipment-detector.${c.slug}]`,
    });
  }
  return results;
}
