import "server-only";
import { db } from "@/lib/db";

/**
 * Calcule un score de qualité 0-100 par Lead pour aider le commercial à
 * prioriser dans le dashboard (Q7 audit qualité 29/04, étendu 30/04).
 *
 * Pondération v2 (audit 30/04, intégration FullEnrich + LinkedIn finder + personaTier) :
 *   Sources contributives (max 60)
 *     - Pappers SIRET     : 5
 *     - Pappers financials : 5
 *     - LinkedIn URL      : 15  (identité confirmée)
 *     - Email présent     : 10
 *     - Kaspr work email  : 10  (= +5 si déjà email présent → bonus pro)
 *     - Mobile FR (Kaspr OU FullEnrich) : 15
 *
 *   FullEnrich bonus (max 10, audit 30/04)
 *     - emailFullenrich seul : +5 (waterfall 20 providers = haute confiance)
 *     - phoneFullenrich seul : +5 (mobile FR ajouté)
 *
 *   Concordance email (max 25)
 *     emailConfidence × 0.25 (95→24, 85→21, 50→13, 40→10, 0→0)
 *
 *   Hot signal (max 15)
 *     - jobMoveDetected : 10
 *     - Trigger.isHot   : 5
 *
 *   PersonaTier multiplicateur (audit 30/04) — pénalise les fallbacks Pappers holding
 *     - Tier 1 (CTO/Head of QA pour signal qa-hire) : ×1.0
 *     - Tier 2 (Founder/DSI/Eng Manager)            : ×0.95
 *     - Tier 3 (CEO/Director)                       : ×0.85
 *     - Tier 4 (fallback Pappers holding)           : ×0.70
 *     - null (pas de tier explicite)                : ×1.0 (neutre)
 */

const FR_MOBILE_RE = /^(\+?33\s?[67]|0[67])/;

function isFrenchMobile(p: string | null | undefined): boolean {
  if (!p) return false;
  return FR_MOBILE_RE.test(p.replace(/\s+/g, ""));
}

function personaTierMultiplier(tier: number | null | undefined): number {
  switch (tier) {
    case 1: return 1.0;
    case 2: return 0.95;
    case 3: return 0.85;
    case 4: return 0.70;
    default: return 1.0;
  }
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
      // FullEnrich (audit 30/04)
      emailFullenrich: true,
      phoneFullenrich: true,
      // PersonaTier multiplicateur (audit 30/04)
      personaTier: true,
      // Bounce / opt-out → pénalisation
      bouncedAt: true,
      doNotContact: true,
      trigger: { select: { isHot: true } },
    },
  });
  if (!lead) return;

  let score = 0;
  // Sources contributives (max 60)
  if (lead.companySiret) score += 5;
  if (lead.companyRevenue != null) score += 5;
  if (lead.linkedinUrl) score += 15;
  if (lead.email) score += 10;
  if (lead.kasprWorkEmail) score += 10;
  if (isFrenchMobile(lead.kasprPhone) || isFrenchMobile(lead.phone) || isFrenchMobile(lead.phoneFullenrich)) score += 15;

  // FullEnrich bonus (max 10) — récompense le waterfall multi-providers qui
  // a "rattrapé" un trou Kaspr
  if (lead.emailFullenrich) score += 5;
  if (lead.phoneFullenrich && isFrenchMobile(lead.phoneFullenrich)) score += 5;

  // Concordance email (max 25)
  score += Math.min(25, Math.floor(lead.emailConfidence * 0.25));

  // Hot signal (max 15)
  if (lead.jobMoveDetected) score += 10;
  if (lead.trigger?.isHot) score += 5;

  // Multiplicateur PersonaTier (audit 30/04)
  score = Math.round(score * personaTierMultiplier(lead.personaTier));

  // Pénalisation forte pour bounce / opt-out (lead inutilisable cold-outreach)
  if (lead.bouncedAt) score = Math.round(score * 0.5);
  if (lead.doNotContact) score = Math.round(score * 0.3);

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
