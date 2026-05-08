import "server-only";
import { db } from "@/lib/db";

/**
 * Sync Lead.status avec Trigger.status — fix bug 08/05 (orphelins dashboard).
 *
 * Bug observé 08/05 : 19 leads visibles dans le dashboard de Fred avec
 * Trigger.status=IGNORED mais Lead.status=NEW/ENRICHED. Les setters de
 * Trigger.status=IGNORED dans qualify-trigger.ts (C3 below_min_score,
 * C4-C5 pre-opus-reject) ne synchronisaient pas le Lead lié → orphelins.
 *
 * Quand le judge dit "ce Trigger ne mérite pas d'être actionné" (IGNORED),
 * on archive automatiquement le Lead correspondant pour le retirer du
 * dashboard sans détruire la data.
 *
 * On préserve les statuts manuels du commercial (CONTACTABLE, CONTACTED,
 * NOT_INTERESTED) parce que Fred peut avoir tagué le lead manuellement.
 * Le commercial > l'auto-judge sur ces transitions terminales.
 */
export async function archiveLeadOnTriggerIgnored(triggerId: string): Promise<void> {
  try {
    const result = await db.lead.updateMany({
      where: {
        triggerId,
        deletedAt: null,
        status: { notIn: ["ARCHIVED", "NOT_INTERESTED", "CONTACTED", "CONTACTABLE"] },
      },
      data: { status: "ARCHIVED" },
    });
    if (result.count > 0) {
      console.log(`[lead-status-sync] trigger=${triggerId} → archived ${result.count} lead(s)`);
    }
  } catch (e) {
    console.warn(
      `[lead-status-sync] err triggerId=${triggerId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Sync inverse — Trigger IGNORED → NEW (promotion B.7 ou RECOVERED) :
 * désarchiver le Lead lié pour le rendre à nouveau visible dans le dashboard.
 *
 * Bug observé 08/05 (2e cas désync) : 9 leads (Asys, HrFlow.ai, SQUAREMIND,
 * Koralplay, Audion, Diabolocom, cobl, Groupe Yoni, LACOUR CONCEPT) avec
 * Trigger.status=NEW mais Lead.status=ARCHIVED. Cas typique : sweep
 * recoverIgnoredTriggersForClient a re-promu IGNORED→NEW mais Lead resté
 * ARCHIVED → invisible dans le dashboard.
 *
 * Stratégie : repose Lead.status en fonction des données d'enrichissement.
 *   - Si email + linkedinUrl déjà posés → ENRICHED (lead prêt pour Fred)
 *   - Sinon → NEW (à enrichir)
 *
 * On préserve les statuts manuels (CONTACTABLE, CONTACTED, NOT_INTERESTED) :
 * un commercial qui a tagué un lead manuellement > l'auto-judge.
 */
export async function unarchiveLeadOnTriggerRevived(triggerId: string): Promise<void> {
  try {
    const lead = await db.lead.findFirst({
      where: { triggerId, deletedAt: null, status: "ARCHIVED" },
      select: { id: true, email: true, linkedinUrl: true, fullName: true },
    });
    if (!lead) return;
    const hasContact = !!(lead.email || lead.linkedinUrl);
    const newStatus = hasContact && lead.fullName ? "ENRICHED" : "NEW";
    await db.lead.update({
      where: { id: lead.id },
      data: { status: newStatus },
    });
    console.log(
      `[lead-status-sync] trigger=${triggerId} → unarchived lead → ${newStatus}`,
    );
  } catch (e) {
    console.warn(
      `[lead-status-sync.unarchive] err triggerId=${triggerId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
