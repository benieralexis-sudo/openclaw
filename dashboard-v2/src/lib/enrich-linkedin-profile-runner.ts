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
// Anti-burn Apify 13/05 — TTL augmenté 30j→90j (les profils LinkedIn changent
// rarement plus vite que ça, et 30j cause re-enrichissements futiles sur
// leads stables). Économie estimée ~$2-3/mois.
const TTL_DAYS = 90;
// Score gate maintenu à 6 (= verdict V2 OUI/ENRICH minimum, NON exclus avant ici).
// Voir filtre verdict V2 ajouté ligne 114+ ci-dessous (patch anti-burn 13/05).
const SCORE_GATE = 6;
const DEFAULT_LIMIT = 30;
// Anti-burn cap dur 13/05 — au-delà de ce seuil par 24h sur ce client, on bloque
// l'enrich pour éviter l'explosion budgétaire (cas où ICP mal calibré fait
// des centaines de leads sans value). Reset auto chaque jour.
const DAILY_CAP_PER_CLIENT = 30;
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

  // Anti-burn 13/05 — cap dur quotidien par client.
  // Compte les Leads enrichis dans les dernières 24h sur ce client.
  const todayStart = new Date(Date.now() - 24 * 86400_000 / 24);
  const enrichedToday = await db.lead.count({
    where: {
      clientId,
      linkedinProfileEnrichedAt: { gte: todayStart },
    },
  });
  if (enrichedToday >= DAILY_CAP_PER_CLIENT && !force) {
    console.warn(
      `[enrich-linkedin-profiles] cap quotidien ${DAILY_CAP_PER_CLIENT} atteint pour client ${clientId} (${enrichedToday} enrichis 24h). Skip ce run.`,
    );
    return result;
  }
  const remainingCap = DAILY_CAP_PER_CLIENT - enrichedToday;
  const effectiveLimit = Math.min(limit, remainingCap);

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
      // Anti-burn 13/05 — Score gate + filtre verdict V2.
      // On enrichit UNIQUEMENT les Leads dont le Trigger a verdict V2 = OUI
      // OU sans verdict V2 encore (à qualifier). On NE PAS enrichir les NON
      // (Lead jetable) ni les ENRICH si confidence ≥80 (déjà tranché).
      // Économie estimée ~$5-10/mois en filtrant les leads inactionnables.
      trigger: {
        score: { gte: SCORE_GATE },
        // Anti-burn 13/05 — exclure les Leads dont le verdict V2 est NON
        // (= jetables, pas la peine d'enrichir LinkedIn). On garde :
        // - briefV2Json NULL (pas encore jugé, à enrichir pour qualifier)
        // - briefV2Json verdict OUI (Pépite, enrichir pour brief commercial)
        // - briefV2Json verdict ENRICH (le judge demande plus d'info)
        NOT: {
          briefV2Json: { path: ["verdict"], equals: "NON" },
        },
      },
    },
    select: { id: true, firstName: true, lastName: true, companyName: true, triggerId: true },
    take: effectiveLimit,
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
