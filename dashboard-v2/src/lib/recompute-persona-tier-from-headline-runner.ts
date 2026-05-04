import "server-only";
import { db } from "@/lib/db";
import { computeTierFromHeadline } from "@/lib/compute-tier-from-headline";

/**
 * Runner DB — recompute personaTier depuis le headline LinkedIn (Sprint 1, 04/05/2026)
 * ──────────────────────────────────────────────────────────────────────────────
 * Pour les Leads avec linkedinProfileJson enrichi mais personaTier null/3,
 * extrait le tier depuis le headline et UPGRADE si meilleur.
 *
 * Règle stricte UPGRADE-ONLY :
 *   - Jamais downgrade (Tier 1 acquis ne devient pas Tier 2)
 *   - Update uniquement si headlineTier !== null ET (current null OU headlineTier < current)
 *   - Stamp personaSource = "{old} + headline-upgrade" pour traçabilité
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

  const leads = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      linkedinProfileJson: { not: undefined },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      personaTier: true,
      personaSource: true,
      linkedinProfileJson: true,
    },
  });

  result.scanned = leads.length;

  for (const lead of leads) {
    try {
      const profile = lead.linkedinProfileJson as { headline?: string } | null;
      if (!profile || typeof profile !== "object") {
        result.skipped += 1;
        continue;
      }
      const headline = profile.headline ?? null;
      if (!headline) {
        result.skipped += 1;
        continue;
      }

      const headlineResult = computeTierFromHeadline(headline);
      if (headlineResult.tier === null) {
        result.skipped += 1;
        continue;
      }

      // Règle UPGRADE-ONLY : on ne touche que si headline donne meilleur tier
      const currentTier = lead.personaTier;
      const shouldUpgrade =
        currentTier === null || headlineResult.tier < currentTier;
      if (!shouldUpgrade) {
        result.skipped += 1;
        continue;
      }

      // Tag source pour traçabilité (qui a posé ce tier ?)
      const oldSource = lead.personaSource ?? "none";
      const newSource = oldSource.includes("headline-upgrade")
        ? oldSource
        : `${oldSource} + headline-upgrade`;

      await db.lead.update({
        where: { id: lead.id },
        data: {
          personaTier: headlineResult.tier,
          personaSource: newSource,
        },
      });

      result.upgraded += 1;
      result.upgradeDetails.push({
        leadId: lead.id,
        persona: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
        company: lead.companyName,
        fromTier: currentTier,
        toTier: headlineResult.tier,
        matchedText: headlineResult.matchedText ?? "",
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
