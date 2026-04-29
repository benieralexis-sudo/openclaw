import "server-only";
import { db } from "@/lib/db";

/**
 * Calcule un score de qualité 0-100 par Lead pour aider le commercial à
 * prioriser dans le dashboard (Q7 audit qualité 29/04).
 *
 * Pondération :
 *   Sources contributives (max 60)
 *     - Pappers SIRET     : 5
 *     - Pappers financials : 5
 *     - LinkedIn URL      : 15  (identité confirmée)
 *     - Email présent     : 10
 *     - Kaspr work email  : 10
 *     - Mobile FR (Kaspr) : 15
 *
 *   Concordance email (max 25)
 *     emailConfidence × 0.25 (95→24, 85→21, 50→13, 40→10, 0→0)
 *
 *   Hot signal (max 15)
 *     - jobMoveDetected : 10
 *     - Trigger.isHot    : 5
 */

const FR_MOBILE_RE = /^(\+?33\s?[67]|0[67])/;

function isFrenchMobile(p: string | null | undefined): boolean {
  if (!p) return false;
  return FR_MOBILE_RE.test(p.replace(/\s+/g, ""));
}

export async function recomputeDataQualityForLead(leadId: string): Promise<void> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      companySiret: true,
      companyRevenue: true,
      linkedinUrl: true,
      email: true,
      kasprWorkEmail: true,
      kasprPhone: true,
      phone: true,
      emailConfidence: true,
      jobMoveDetected: true,
      trigger: { select: { isHot: true } },
    },
  });
  if (!lead) return;

  let score = 0;
  if (lead.companySiret) score += 5;
  if (lead.companyRevenue != null) score += 5;
  if (lead.linkedinUrl) score += 15;
  if (lead.email) score += 10;
  if (lead.kasprWorkEmail) score += 10;
  if (isFrenchMobile(lead.kasprPhone) || isFrenchMobile(lead.phone)) score += 15;
  score += Math.min(25, Math.floor(lead.emailConfidence * 0.25));
  if (lead.jobMoveDetected) score += 10;
  if (lead.trigger?.isHot) score += 5;

  const final = Math.min(100, Math.max(0, score));
  await db.lead.update({
    where: { id: leadId },
    data: { dataQuality: final },
  });
}

/**
 * Recalcule en bulk tous les leads d'un client. Utilisé en backfill ou
 * en cron horaire pour rafraîchir les scores.
 */
export async function recomputeDataQualityForClient(clientId: string): Promise<{ scanned: number; updated: number }> {
  const leads = await db.lead.findMany({
    where: { clientId, deletedAt: null },
    select: { id: true },
  });
  let updated = 0;
  for (const l of leads) {
    try {
      await recomputeDataQualityForLead(l.id);
      updated++;
    } catch {
      // best effort
    }
  }
  return { scanned: leads.length, updated };
}
