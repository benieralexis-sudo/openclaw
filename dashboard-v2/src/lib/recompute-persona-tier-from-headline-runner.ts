import "server-only";
import { db } from "@/lib/db";
import { computeTierFromHeadline } from "@/lib/compute-tier-from-headline";
import { computeTierFromJobTitle } from "@/lib/compute-tier-from-jobtitle";

/**
 * Runner DB — recompute personaTier depuis headline LinkedIn + jobTitle Pappers
 * ──────────────────────────────────────────────────────────────────────────────
 * Sprint 1 (04/05) : initialement headline LinkedIn uniquement.
 * Phase 1 recovery (04/05 soir) : ajout fallback jobTitle Pappers pour
 *   capter les Pépites Opus≥7 sans linkedinProfileJson (Proelan, Decade
 *   Energy, Kestra, SQUAREMIND, Alithya, Tech Riders, Deodis).
 *
 * Logique séquentielle :
 *   1. Si headline LinkedIn présent → computeTierFromHeadline
 *   2. Si pas de tier ou pas de headline → fallback computeTierFromJobTitle
 *   3. UPGRADE-only : tier upgradé seulement si meilleur que current
 *
 * Règle stricte UPGRADE-ONLY :
 *   - Jamais downgrade (Tier 1 acquis ne devient pas Tier 2)
 *   - Update uniquement si computedTier !== null ET (current null OU computedTier < current)
 *   - Stamp personaSource = "{old} + {headline|jobtitle}-upgrade" pour traçabilité
 *
 * À brancher dans run-pollers/route.ts dans le bloc isFullPipeline,
 * AVANT recomputeFitScoresForClient (sinon le fit recompute utilise un tier obsolète).
 */

export interface PersonaTierUpgradeResult {
  scanned: number;
  upgraded: number;
  skipped: number;
  errors: number;
  upgradeDetails: Array<{
    leadId: string;
    persona: string;
    company: string;
    fromTier: number | null;
    toTier: number;
    matchedText: string;
  }>;
}

export async function recomputePersonaTierFromHeadlineForClient(
  clientId: string,
): Promise<PersonaTierUpgradeResult> {
  const result: PersonaTierUpgradeResult = {
    scanned: 0,
    upgraded: 0,
    skipped: 0,
    errors: 0,
    upgradeDetails: [],
  };

  // Sélection élargie 04/05 (Phase 1 recovery) : on prend TOUS les Leads
  // avec personaTier null OU faible (≥3). Avant : seulement ceux avec
  // linkedinProfileJson. Désormais on traite aussi les Leads qui ont
  // jobTitle (Pappers RCS) sans linkedinProfileJson.
  const leads = await db.lead.findMany({
    where: { clientId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      personaTier: true,
      personaSource: true,
      linkedinProfileJson: true,
      jobTitle: true,
    },
  });

  result.scanned = leads.length;

  for (const lead of leads) {
    try {
      // Étape 1 : essayer headline LinkedIn (priorité, signal le plus riche)
      let computedTier: 1 | 2 | 3 | null = null;
      let matchedText = "";
      let upgradeSource = "headline-upgrade";

      const profile = lead.linkedinProfileJson as { headline?: string } | null;
      const headline = profile && typeof profile === "object"
        ? profile.headline ?? null
        : null;

      if (headline) {
        const headlineResult = computeTierFromHeadline(headline);
        if (headlineResult.tier !== null) {
          computedTier = headlineResult.tier;
          matchedText = headlineResult.matchedText ?? "";
        }
      }

      // Étape 2 : fallback jobTitle Pappers si headline n'a rien donné
      if (computedTier === null && lead.jobTitle) {
        const jobTitleResult = computeTierFromJobTitle(lead.jobTitle);
        if (jobTitleResult.tier !== null) {
          computedTier = jobTitleResult.tier;
          matchedText = jobTitleResult.matchedText ?? "";
          upgradeSource = "jobtitle-upgrade";
        }
      }

      if (computedTier === null) {
        result.skipped += 1;
        continue;
      }

      // Règle UPGRADE-ONLY : on ne touche que si computed donne meilleur tier
      const currentTier = lead.personaTier;
      const shouldUpgrade =
        currentTier === null || computedTier < currentTier;
      if (!shouldUpgrade) {
        result.skipped += 1;
        continue;
      }

      // Tag source pour traçabilité
      const oldSource = lead.personaSource ?? "none";
      const newSource = oldSource.includes(upgradeSource)
        ? oldSource
        : `${oldSource} + ${upgradeSource}`;

      await db.lead.update({
        where: { id: lead.id },
        data: {
          personaTier: computedTier,
          personaSource: newSource,
        },
      });

      result.upgraded += 1;
      result.upgradeDetails.push({
        leadId: lead.id,
        persona: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
        company: lead.companyName,
        fromTier: currentTier,
        toTier: computedTier,
        matchedText,
      });
    } catch (e) {
      result.errors += 1;
      console.warn(
        `[tier-headline-runner] error on lead ${lead.id}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  return result;
}
