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
 *
 * ─────────────────────────────────────────────────────────────────────
 * Extension 13/05/2026 — Bug racine #2 (mismatch persona/email)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Le fix B1 (briefs) ne suffit pas : Kaspr/FullEnrich posent aussi un
 * email + téléphone sur le Lead pour la persona courante. Quand HarvestAPI
 * change la persona APRÈS coup, les emails/phones restent ceux de l'ancien.
 *
 * Cas observés en prod (13/05) — 4/89 Leads avec email (4.5%) :
 *   - GitGuardian : persona=Eric Grabarczyk (Eng. Manager) / email=eric.fourrier@ (CEO)
 *   - ViaXoft     : persona=Vincent Gautier (CTO) / email=ebarthelemy@ (CEO)
 *   - happn       : persona=Paul-Antoine Campos / email=karima.ben-abdelmalek@
 *   - Kestra      : persona=Denis Lafont / email=ldehon@ (Ludovic Dehon CTO)
 *
 * Pattern : Kaspr appelé EN PREMIER sur persona initiale faible → pose email
 * de la "persona dominante" de la boîte (CEO via cross-check coherence).
 * HarvestAPI tourne ENSUITE et trouve une persona plus pertinente → écrase
 * firstName/lastName/linkedinUrl/jobTitle MAIS NE TOUCHE PAS l'email. Fred
 * envoie à la mauvaise personne avec un opener qui cite la nouvelle.
 *
 * Solution : étendre l'invalidation aux champs email/phone + reset des
 * `*AttemptedAt` pour permettre une re-tentative Kaspr/FullEnrich avec la
 * persona corrigée au prochain run-pollers.
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
 * Clear tous les briefs ET les emails/phones de la persona précédente
 * quand un Lead voit sa persona changer.
 *
 * Idempotent : si les champs sont déjà null, no-op silencieux.
 * Atomique dans une transaction Prisma : Lead + Trigger updates ensemble.
 *
 * Retourne le détail de ce qui a été clear pour logs/observabilité.
 *
 * Nom historique conservé (`clearStaleBriefsOnPersonaChange`) pour ne pas
 * casser les call sites existants. Scope étendu 13/05 — voir doc ci-dessus.
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
        // Extension 13/05 — emails/phones de l'ancienne persona
        email: true,
        kasprWorkEmail: true,
        kasprPersonalEmail: true,
        emailFullenrich: true,
        emailDropcontact: true,
        emailRodz: true,
        kasprPhone: true,
        phoneFullenrich: true,
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
    // Extension 13/05 — invalider les emails/phones de la persona précédente.
    // Kaspr/FullEnrich seront re-déclenchés au prochain run-pollers avec la
    // persona corrigée (firstName/lastName/linkedinUrl que HarvestAPI vient
    // de poser). Reset des `*AttemptedAt` débloque les retries (TTL 30j).
    let enrichmentTouched = false;
    if (lead.email !== null) {
      leadUpdate.email = null;
      // emailStatus + emailConfidence sont NOT NULL en DB — on les reset à
      // leurs defaults plutôt que null (UNVERIFIED / 0).
      leadUpdate.emailStatus = "UNVERIFIED";
      leadUpdate.emailConfidence = 0;
      leadCleared.push("email");
      enrichmentTouched = true;
    }
    if (lead.kasprWorkEmail !== null) {
      leadUpdate.kasprWorkEmail = null;
      leadCleared.push("kasprWorkEmail");
      enrichmentTouched = true;
    }
    if (lead.kasprPersonalEmail !== null) {
      leadUpdate.kasprPersonalEmail = null;
      leadCleared.push("kasprPersonalEmail");
      enrichmentTouched = true;
    }
    if (lead.emailFullenrich !== null) {
      leadUpdate.emailFullenrich = null;
      leadCleared.push("emailFullenrich");
      enrichmentTouched = true;
    }
    if (lead.emailDropcontact !== null) {
      leadUpdate.emailDropcontact = null;
      leadCleared.push("emailDropcontact");
      enrichmentTouched = true;
    }
    if (lead.emailRodz !== null) {
      leadUpdate.emailRodz = null;
      leadCleared.push("emailRodz");
      enrichmentTouched = true;
    }
    if (lead.kasprPhone !== null) {
      leadUpdate.kasprPhone = null;
      leadCleared.push("kasprPhone");
      enrichmentTouched = true;
    }
    if (lead.phoneFullenrich !== null) {
      leadUpdate.phoneFullenrich = null;
      leadCleared.push("phoneFullenrich");
      enrichmentTouched = true;
    }
    if (enrichmentTouched) {
      // Débloquer les retries Kaspr/FullEnrich (gates TTL 30j sur attemptedAt).
      leadUpdate.kasprAttemptedAt = null;
      leadUpdate.fullenrichAttemptedAt = null;
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
