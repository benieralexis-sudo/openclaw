import "server-only";
import { db } from "@/lib/db";
import { findLinkedInUrl, type LinkedInFinderSource } from "@/lib/linkedin-finder";

/**
 * Pipeline étage 3-bis — applique la cascade LinkedIn finder sur les Leads
 * du client qui ont une persona connue mais pas de LinkedIn URL.
 *
 * Gate : Trigger.score >= 6 (Qualifiés + Pépites). Les leads sans Trigger
 * lié ou avec score < 6 sont skip pour économiser les crédits Apify et
 * les requêtes Google CSE.
 *
 * TTL 30j : un lead tenté sans succès n'est pas re-tenté avant 30 jours
 * via le flag `linkedinFinderAttemptedAt`. Pose même si rien trouvé.
 */

const SCORE_GATE = 6;
const DEFAULT_LIMIT = 15;
const TTL_DAYS = 30;

export interface LinkedInFinderRunResult {
  scanned: number;
  attempted: number;
  found: number;
  bySource: Record<LinkedInFinderSource | "none", number>;
  errors: Array<{ leadId: string; reason: string }>;
}

export async function enrichLeadsViaLinkedInFinder(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<LinkedInFinderRunResult> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, 30);
  const result: LinkedInFinderRunResult = {
    scanned: 0,
    attempted: 0,
    found: 0,
    bySource: {
      "harvestapi-profile-search": 0,
      "google-cse": 0,
      none: 0,
    },
    errors: [],
  };

  const ttlAgo = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000);

  // Eligibilité : firstName + lastName + companyName remplis,
  // linkedinUrl manquant, jamais tenté (ou tenté >30j),
  // ET au moins un Trigger lié avec score >= 6.
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      linkedinUrl: null,
      firstName: { not: null },
      lastName: { not: null },
      companyName: { not: "" },
      OR: [
        { linkedinFinderAttemptedAt: null },
        { linkedinFinderAttemptedAt: { lt: ttlAgo } },
      ],
      // Gate score : Trigger lié avec score >= 6 (Qualifié+)
      trigger: {
        score: { gte: SCORE_GATE },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      jobTitle: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  result.scanned = candidates.length;

  for (const lead of candidates) {
    if (!lead.firstName || !lead.lastName || !lead.companyName) continue;
    result.attempted++;
    const attemptedAt = new Date();

    try {
      const found = await findLinkedInUrl({
        firstName: lead.firstName,
        lastName: lead.lastName,
        companyName: lead.companyName,
        jobTitleHint: lead.jobTitle ?? undefined,
      });

      if (found) {
        await db.lead.update({
          where: { id: lead.id },
          data: {
            linkedinUrl: found.linkedinUrl,
            linkedinSource: found.source,
            linkedinFinderAttemptedAt: attemptedAt,
            status: "ENRICHED",
            enrichedAt: new Date(),
          },
        });
        result.found++;
        result.bySource[found.source]++;
      } else {
        await db.lead.update({
          where: { id: lead.id },
          data: { linkedinFinderAttemptedAt: attemptedAt },
        });
        result.bySource.none++;
      }
    } catch (e) {
      // On marque tenté quand même pour éviter de boucler sur erreur
      try {
        await db.lead.update({
          where: { id: lead.id },
          data: { linkedinFinderAttemptedAt: attemptedAt },
        });
      } catch {
        // best effort
      }
      result.errors.push({
        leadId: lead.id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
