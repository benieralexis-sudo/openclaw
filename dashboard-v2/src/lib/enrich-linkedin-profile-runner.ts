import "server-only";

/**
 * Orchestrateur DB pour l'enrichissement des profils LinkedIn complets.
 *
 * IMPORTANT (test live 01/05) : l'actor `harvestapi/linkedin-profile-search`
 * NE supporte PAS `profileUrls` ni `linkedinUrls` directement (renvoie []).
 * Il accepte UNIQUEMENT `searchQuery`. On fait donc 1 requête par lead avec
 * "firstName lastName companyName" et on valide le match par companyName.
 *
 * Gate score : Trigger.score >= 6 (Pépites + Qualifiés) pour économiser
 * les crédits Apify.
 *
 * Cas limites :
 *  - Pas de firstName/lastName → skip
 *  - HarvestAPI return 0 ou erreur → marque enrichedAt (TTL 30j) sans data
 *  - Lead bouncedAt OR doNotContact → skip
 *  - Mismatch company (homonyme) → skip + flag enrichedAt
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { runAndGetItems } from "@/lib/apify";
import { invalidateTriggerForRequalify } from "@/lib/requalify-engine";

const ACTOR_ID = "harvestapi/linkedin-profile-search";
const TTL_DAYS = 30;
const SCORE_GATE = 6;
const DEFAULT_LIMIT = 30;
const PAUSE_BETWEEN_LEADS_MS = 1500; // anti-throttle (1 req/1.5s)

export interface EnrichLinkedInProfileResult {
  scanned: number;
  attempted: number;
  enriched: number;
  emptyResponses: number;
  mismatchCompany: number;
  skipped: number;
  errors: Array<{ leadId: string; error: string }>;
}

interface HarvestProfileItem {
  linkedinUrl?: string;
  url?: string;
  profileUrl?: string;
  publicIdentifier?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  about?: string;
  currentPosition?: Array<{ companyName?: string }>;
  experience?: Array<unknown>;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function companyMatches(profile: HarvestProfileItem, expectedCo: string): boolean {
  const exp = normalize(expectedCo);
  if (!exp) return false;
  const cps = profile.currentPosition ?? [];
  for (const cp of cps) {
    const co = normalize(cp.companyName ?? "");
    if (!co) continue;
    if (co === exp) return true;
    if (co.includes(exp) || exp.includes(co)) return true;
  }
  // Fallback : check headline aussi
  const headline = normalize(profile.headline ?? "");
  if (exp.length >= 4 && headline.includes(exp)) return true;
  return false;
}

export async function enrichLinkedInProfilesForClient(
  clientId: string,
  opts: { limit?: number; force?: boolean } = {},
): Promise<EnrichLinkedInProfileResult> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, 50);
  const force = opts.force ?? false;
  const ttlAgo = new Date(Date.now() - TTL_DAYS * 86400_000);

  const result: EnrichLinkedInProfileResult = {
    scanned: 0,
    attempted: 0,
    enriched: 0,
    emptyResponses: 0,
    mismatchCompany: 0,
    skipped: 0,
    errors: [],
  };

  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      firstName: { not: null },
      lastName: { not: null },
      bouncedAt: null,
      doNotContact: false,
      ...(force
        ? {}
        : {
            OR: [
              { linkedinProfileEnrichedAt: null },
              { linkedinProfileEnrichedAt: { lt: ttlAgo } },
            ],
          }),
      trigger: { score: { gte: SCORE_GATE } },
    },
    select: { id: true, firstName: true, lastName: true, companyName: true, triggerId: true },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  for (const lead of candidates) {
    if (!lead.firstName || !lead.lastName) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    const searchQueryPrimary = `${lead.firstName.trim()} ${lead.lastName.trim()} ${lead.companyName.trim()}`.trim();
    // Patch E (06/05) — fallback search sans companyName. Audit Apify : 14/58
    // lookups (24%) reviennent vides, souvent à cause d'accents/anciens noms
    // RCS qui ne matchent pas le brand LinkedIn. On retry "FirstName LastName"
    // seul si le 1er échoue. Coût marginal $0.10/retry, mais réduit empty 50%.
    const searchQueryFallback = `${lead.firstName.trim()} ${lead.lastName.trim()}`.trim();

    let items: HarvestProfileItem[] = [];
    let usedQuery = searchQueryPrimary;
    try {
      const r = await runAndGetItems<HarvestProfileItem>(
        ACTOR_ID,
        {
          searchQuery: searchQueryPrimary,
          profileScraperMode: "Full",
          maxItems: 1,
        },
        { timeout: 60, memory: 512, itemsLimit: 1 },
      );
      items = r.items;
      // Retry sans company si 1er run vide ET company faisait partie du query.
      // Skip si le nom est trop générique (firstName+lastName <8 chars =
      // risque Jean Dupont qui matche n'importe qui).
      if (items.length === 0 && searchQueryFallback.length >= 8 && searchQueryFallback !== searchQueryPrimary) {
        await new Promise((res) => setTimeout(res, PAUSE_BETWEEN_LEADS_MS));
        const r2 = await runAndGetItems<HarvestProfileItem>(
          ACTOR_ID,
          {
            searchQuery: searchQueryFallback,
            profileScraperMode: "Full",
            maxItems: 1,
          },
          { timeout: 60, memory: 512, itemsLimit: 1 },
        );
        items = r2.items;
        usedQuery = searchQueryFallback;
      }
    } catch (e) {
      result.errors.push({
        leadId: lead.id,
        error: `actor_run (q="${usedQuery}"): ${e instanceof Error ? e.message : String(e)}`,
      });
      // pause anti-throttle même en cas d'erreur
      await new Promise((res) => setTimeout(res, PAUSE_BETWEEN_LEADS_MS));
      continue;
    }

    const now = new Date();
    if (items.length === 0) {
      try {
        await db.lead.update({
          where: { id: lead.id },
          data: { linkedinProfileEnrichedAt: now },
        });
      } catch { /* ignore */ }
      result.emptyResponses += 1;
      await new Promise((res) => setTimeout(res, PAUSE_BETWEEN_LEADS_MS));
      continue;
    }

    const profile = items[0]!;
    const matchOk = companyMatches(profile, lead.companyName);

    try {
      if (matchOk) {
        await db.lead.update({
          where: { id: lead.id },
          data: {
            linkedinProfileJson: profile as unknown as Prisma.InputJsonValue,
            linkedinProfileEnrichedAt: now,
          },
        });
        result.enriched += 1;
        // Sprint 3.2 (05/05) — Le profil LinkedIn Full vient d'être posé.
        // Le judge avait jugé sans cette data → invalide pour qu'il re-juge
        // au prochain run. Bénéficie auto des blocs Sprint 1+2 (PERSONA QUAL
        // + LinkedIn Profile Section + ESN/SaaS/Startup backgrounds).
        if (lead.triggerId) {
          await invalidateTriggerForRequalify(lead.triggerId, "linkedinProfileJson-resolved");
        }
      } else {
        // Profil trouvé mais mauvais (homonyme) → skip propre
        await db.lead.update({
          where: { id: lead.id },
          data: { linkedinProfileEnrichedAt: now },
        });
        result.mismatchCompany += 1;
      }
    } catch (e) {
      result.errors.push({
        leadId: lead.id,
        error: `db_update: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    // Pause anti-throttle entre les leads
    await new Promise((res) => setTimeout(res, PAUSE_BETWEEN_LEADS_MS));
  }

  return result;
}
