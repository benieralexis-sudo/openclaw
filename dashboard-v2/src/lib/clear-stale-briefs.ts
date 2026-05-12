import "server-only";

/**
 * Fix B1 racine (12/05/2026) — Invalidation des briefs quand persona change.
 *
 * Problème : un Lead créé avec persona A se fait régénérer brief (Opus) pour
 * persona A. Plus tard, un enrichissement (HarvestAPI, Google CSE cascade,
 * Pappers dirigeants) trouve un meilleur décideur B → Lead.fullName mis à
 * jour. Mais les briefs (briefV2Json sur Trigger, et briefJson/pitchJson/
 * callBriefJson/linkedinDmJson/warmMailJson sur Lead) ne sont PAS régénérés.
 * Résultat : l'opener cite "Bonjour Jean-Luc" alors que le Lead est Thomas.
 *
 * Cas observés en prod (12/05) :
 *   - DimoMaint : briefV2 "Bonjour Jean-Luc" / Lead = Thomas Bourgeois
 *   - Training Orchestra : briefV2 "Bonjour Laetitia" + pitch idem / Lead = Valérie
 *   - DiXiO : briefV2 "Bonjour Thierry" / Lead = Adrien SICOLI
 *   - Kestra : briefV2 "Bonjour Ludovic" / Lead = Denis Lafont
 *
 * Le UI (lead-brief-v2-view.tsx) et le digest email (lead-digest-builder.ts)
 * ont déjà un guard `detectOpenerPersonaDesync` qui masque l'opener + bloque
 * la copie. Mais /api/leads/[id]/copy expose `pitchJson` brut → bypass.
 *
 * Solution structurelle : quand fullName change, clear TOUS les briefs Lead
 * + Trigger.briefV2Json. Ils repartiront vides en attendant régénération.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { isPersonaChanged } from "@/lib/persona-changed";

export { isPersonaChanged };

export interface ClearStaleBriefsResult {
  cleared: boolean;
  oldName: string | null;
  newName: string;
  leadFieldsCleared: string[];
  triggerV2Cleared: boolean;
}

/**
 * Clear tous les briefs liés à un Lead quand sa persona change.
 *
 * Idempotent : si les briefs sont déjà null, no-op silencieux.
 * Atomique dans une transaction Prisma : Lead + Trigger updates ensemble.
 *
 * Retourne le détail de ce qui a été clear pour logs/observabilité.
 */
export async function clearStaleBriefsOnPersonaChange(
  leadId: string,
  oldFullName: string | null | undefined,
  newFullName: string,
  triggerId: string | null | undefined,
): Promise<ClearStaleBriefsResult> {
  if (!isPersonaChanged(oldFullName, newFullName)) {
    return {
      cleared: false,
      oldName: oldFullName ?? null,
      newName: newFullName,
      leadFieldsCleared: [],
      triggerV2Cleared: false,
    };
  }

  const leadCleared: string[] = [];
  const result = await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: {
        briefJson: true,
        callBriefJson: true,
        pitchJson: true,
        warmMailJson: true,
        linkedinDmJson: true,
      },
    });
    if (!lead) return { v2Cleared: false };

    const leadUpdate: Record<string, unknown> = {};
    if (lead.briefJson !== null) {
      leadUpdate.briefJson = null;
      leadUpdate.briefGeneratedAt = null;
      leadCleared.push("briefJson");
    }
    if (lead.callBriefJson !== null) {
      leadUpdate.callBriefJson = null;
      leadUpdate.callBriefGeneratedAt = null;
      leadCleared.push("callBriefJson");
    }
    if (lead.pitchJson !== null) {
      leadUpdate.pitchJson = null;
      leadUpdate.pitchGeneratedAt = null;
      leadCleared.push("pitchJson");
    }
    if (lead.warmMailJson !== null) {
      leadUpdate.warmMailJson = null;
      leadUpdate.warmMailGeneratedAt = null;
      leadCleared.push("warmMailJson");
    }
    if (lead.linkedinDmJson !== null) {
      leadUpdate.linkedinDmJson = null;
      leadUpdate.linkedinDmGeneratedAt = null;
      leadCleared.push("linkedinDmJson");
    }
    if (Object.keys(leadUpdate).length > 0) {
      leadUpdate.copyGeneratedAt = null;
      await tx.lead.update({ where: { id: leadId }, data: leadUpdate });
    }

    let v2Cleared = false;
    if (triggerId) {
      const trigger = await tx.trigger.findUnique({
        where: { id: triggerId },
        select: { briefV2Json: true },
      });
      if (trigger?.briefV2Json !== null && trigger?.briefV2Json !== undefined) {
        await tx.trigger.update({
          where: { id: triggerId },
          data: { briefV2Json: Prisma.JsonNull },
        });
        v2Cleared = true;
      }
    }
    return { v2Cleared };
  });

  return {
    cleared: leadCleared.length > 0 || result.v2Cleared,
    oldName: oldFullName ?? null,
    newName: newFullName,
    leadFieldsCleared: leadCleared,
    triggerV2Cleared: result.v2Cleared,
  };
}
