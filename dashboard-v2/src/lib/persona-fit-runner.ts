import "server-only";

/**
 * Orchestrateur DB pour le Persona Fit Scoring.
 * Recalcule fitScore + fitScoreBreakdown sur tous les leads actifs d'un client.
 *
 * Combine :
 *  - personaTier (déjà en DB)
 *  - linkedinProfileJson (chantier #2a) → currentTenureMonths + backgrounds
 *  - companyEtabsCount (Pappers existant)
 *  - ICP du client (pour wantsESN/SaaS/Startup + sizeMin/sizeMax)
 *
 * Coût : 0€ (pure compute, pas d'API externe).
 * Latence : ~5ms par lead, ~150ms total sur 86 leads DTL.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { extractLinkedInProfile } from "@/lib/linkedin-profile-extractor";
import { computeFitScore, type ICPProfile } from "@/lib/persona-fit-scoring";

export interface FitRunResult {
  scanned: number;
  computed: number;
  withTier: number;
  withProfile: number;
  topFitScore: number | null;
  errors: number;
}

/**
 * Extrait l'ICP fit profile depuis l'ICP brut du Client (JSON).
 * Pour DTL : industries=["SaaS B2B", "ESN / SSII"] → wantsESN=true, wantsSaaS=true.
 */
function extractIcpFit(icp: unknown): ICPProfile {
  if (!icp || typeof icp !== "object") return {};
  const o = icp as Record<string, unknown>;

  // wantsESN/wantsSaaS détectés depuis industries
  const industries = Array.isArray(o.industries) ? (o.industries as unknown[]) : [];
  const indStr = industries.map((i) => String(i).toLowerCase()).join(" | ");
  const wantsESN = /\b(esn|ssii)\b/i.test(indStr);
  const wantsSaaS = /\b(saas|software|éditeur|editor|edition)\b/i.test(indStr);
  const wantsStartup = /\bstartup|scale[- ]?up\b/i.test(indStr);

  // sizeMin/sizeMax depuis company_size_min/max ou sizes
  let sizeMin: number | undefined;
  let sizeMax: number | undefined;
  if (typeof o.company_size_min === "number") sizeMin = o.company_size_min;
  if (typeof o.company_size_max === "number") sizeMax = o.company_size_max;
  // Fallback : parse "11-50" / "51-200" depuis sizes array
  if ((sizeMin === undefined || sizeMax === undefined) && Array.isArray(o.sizes)) {
    const sizes = o.sizes as unknown[];
    let min = Infinity;
    let max = 0;
    for (const s of sizes) {
      const m = String(s).match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        min = Math.min(min, parseInt(m[1]!, 10));
        max = Math.max(max, parseInt(m[2]!, 10));
      }
    }
    if (min !== Infinity) sizeMin = sizeMin ?? min;
    if (max > 0) sizeMax = sizeMax ?? max;
  }

  return {
    wantsESN,
    wantsSaaS,
    wantsStartup,
    sizeMin,
    sizeMax,
  };
}

export async function recomputeFitScoresForClient(clientId: string): Promise<FitRunResult> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, icp: true },
  });
  if (!client) {
    return { scanned: 0, computed: 0, withTier: 0, withProfile: 0, topFitScore: null, errors: 0 };
  }

  const icpFit = extractIcpFit(client.icp);

  const leads = await db.lead.findMany({
    where: { clientId, deletedAt: null },
    select: {
      id: true,
      personaTier: true,
      linkedinProfileJson: true,
      companyEtabsCount: true,
      jobTitle: true,
    },
  });

  const result: FitRunResult = {
    scanned: leads.length,
    computed: 0,
    withTier: 0,
    withProfile: 0,
    topFitScore: null,
    errors: 0,
  };

  for (const lead of leads) {
    if (lead.personaTier !== null) result.withTier += 1;
    if (lead.linkedinProfileJson) result.withProfile += 1;

    let currentTenureMonths: number | null = null;
    let backgrounds = null;
    let headline: string | null = null;
    if (lead.linkedinProfileJson) {
      const extracted = extractLinkedInProfile(lead.linkedinProfileJson);
      currentTenureMonths = extracted.currentTenureMonths;
      backgrounds = {
        hasESNBackground: extracted.hasESNBackground,
        hasSaaSBackground: extracted.hasSaaSBackground,
        hasStartupBackground: extracted.hasStartupBackground,
      };
      // Extract headline pour penalty non-buyer (Angel/Investor pur)
      const profile = lead.linkedinProfileJson as { headline?: string } | null;
      headline = profile?.headline ?? null;
    }
    // Concat jobTitle + headline pour scorer non-buyer (04/05/2026)
    const jobTitleAndHeadline = [lead.jobTitle, headline]
      .filter(Boolean)
      .join(" | ") || null;

    const fit = computeFitScore({
      personaTier: lead.personaTier,
      currentTenureMonths,
      backgrounds,
      companyEtabsCount: lead.companyEtabsCount,
      icp: icpFit,
      jobTitleAndHeadline,
    });

    if (result.topFitScore === null || fit.score > result.topFitScore) {
      result.topFitScore = fit.score;
    }

    try {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          fitScore: fit.score,
          fitScoreBreakdown: fit.breakdown as unknown as Prisma.InputJsonValue,
          fitScoreComputedAt: new Date(),
        },
      });
      result.computed += 1;
    } catch {
      result.errors += 1;
    }
  }

  return result;
}
