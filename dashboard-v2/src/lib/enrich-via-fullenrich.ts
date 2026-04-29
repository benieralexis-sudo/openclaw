import "server-only";

/**
 * FullEnrich pipeline integration — fallback Kaspr
 * ─────────────────────────────────────────────────
 *
 * Quand un Lead a une persona identifiée (firstName + lastName + companyName,
 * idéalement + LinkedIn URL) MAIS que Kaspr n'a pas trouvé d'email/phone,
 * on tape FullEnrich qui cascade sur 20+ providers en waterfall.
 *
 * Mesure empirique 29/04 : Kaspr résout 45% emails sur les décideurs HarvestAPI
 * (CTO startup, Co-Founders) vs 92% sur les profils Rodz fundraising. FullEnrich
 * comble ce gap car il intègre des providers complémentaires (Hunter, Apollo,
 * Anymail Finder, Findymail) que Kaspr seul n'a pas.
 *
 * Stratégie de coût :
 *   - Sélectionne les Leads avec persona (firstName+lastName) mais sans email
 *   - Skip si déjà tenté <30j (dedup `fullenrichAttemptedAt`)
 *   - Demande emails ET phones (1+10 = 11 credits par lead enrichi)
 *   - Plafond 5 leads/run par défaut (= 55 credits max/run)
 *   - Crédits déduits seulement si trouvé (modèle FullEnrich)
 *
 * Coût attendu sur 200 leads/mois où Kaspr échoue (~80 leads) :
 *   - 80 × 1 cr email (succès estimé 80%) = 64 credits
 *   - 80 × 10 cr phone (succès 50% FR) = 400 credits
 *   - Total ~470 credits ≈ Plan Pro 55€/mo (1000 cr) confortable
 *   - Plan Starter 29€/mo (500 cr) tendu mais possible
 */

import { db } from "@/lib/db";
import {
  enrichBulk,
  waitForBulk,
  pickBestEmail,
  pickBestPhone,
  pickBestPersonalEmail,
  FullEnrichError,
  type FullEnrichInput,
} from "@/lib/fullenrich";
import { recomputeEmailConfidenceForLead } from "@/lib/recompute-email-confidence";

export interface EnrichViaFullEnrichResult {
  scanned: number;
  enriched: number;
  emailFound: number;
  phoneFound: number;
  personalEmailFound: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ leadId: string; error: string }>;
  creditsUsed: number;
}

const FULLENRICH_TTL_DAYS = 30;
const DEFAULT_LIMIT = 5; // plafond credits/run pour ne pas cramer

export async function enrichLeadsViaFullEnrich(
  clientId: string,
  options: { limit?: number; dryRun?: boolean; includePhones?: boolean } = {},
): Promise<EnrichViaFullEnrichResult> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, 30);
  const includePhones = options.includePhones ?? true;
  const result: EnrichViaFullEnrichResult = {
    scanned: 0, enriched: 0, emailFound: 0, phoneFound: 0,
    personalEmailFound: 0, skipped: 0, errors: 0, errorDetails: [], creditsUsed: 0,
  };

  const ttlAgo = new Date(Date.now() - FULLENRICH_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Sélection : Leads avec persona (firstName + lastName + companyName) mais
  // sans email final ET Kaspr déjà tenté (= Kaspr a échoué). On veut éviter
  // de doubler avec Kaspr qui pourrait encore tourner.
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      firstName: { not: null },
      lastName: { not: null },
      companyName: { not: "" },
      // Pas d'email final (= Kaspr/Rodz/Dropcontact n'ont rien trouvé)
      OR: [
        { email: null },
        { email: "" },
      ],
      // Kaspr déjà tenté (sinon on attend que Kaspr ait sa chance)
      kasprAttemptedAt: { not: null },
      // Pas tenté FullEnrich <30j
      AND: [
        {
          OR: [
            { fullenrichAttemptedAt: null },
            { fullenrichAttemptedAt: { lt: ttlAgo } },
          ],
        },
      ],
      // Filtre score (économie credits)
      trigger: { score: { gte: 6 } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      linkedinUrl: true,
      bouncedFromEmail: true,
      trigger: { select: { sourceCode: true } },
    },
    take: limit,
    orderBy: [{ dataQuality: "desc" }, { createdAt: "desc" }],
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  if (options.dryRun) {
    return result;
  }

  // Build bulk payload
  const enrichFields: FullEnrichInput["enrich_fields"] = includePhones
    ? ["contact.emails", "contact.phones"]
    : ["contact.emails"];

  const datas: FullEnrichInput[] = candidates.map((lead) => ({
    firstname: lead.firstName ?? undefined,
    lastname: lead.lastName ?? undefined,
    company_name: lead.companyName,
    linkedin_url: lead.linkedinUrl ?? undefined,
    enrich_fields: enrichFields,
    custom: { leadId: lead.id },
  }));

  let bulkId: string;
  try {
    const r = await enrichBulk({
      name: `ifind-${clientId}-${Date.now()}`,
      datas,
    });
    bulkId = r.enrichment_id;
  } catch (e) {
    const msg = e instanceof FullEnrichError ? `${e.code}: ${e.message}` : String(e);
    result.errors = candidates.length;
    candidates.forEach((c) => result.errorDetails.push({ leadId: c.id, error: `bulk_create: ${msg}` }));
    return result;
  }

  // Polling jusqu'à FINISHED
  let bulk;
  try {
    bulk = await waitForBulk(bulkId, { timeoutMs: 120_000, pollIntervalMs: 4_000 });
  } catch (e) {
    const msg = e instanceof FullEnrichError ? `${e.code}: ${e.message}` : String(e);
    result.errors = candidates.length;
    candidates.forEach((c) => result.errorDetails.push({ leadId: c.id, error: `poll: ${msg}` }));
    return result;
  }

  if (bulk.status === "CREDITS_INSUFFICIENT") {
    result.errors = candidates.length;
    candidates.forEach((c) => result.errorDetails.push({ leadId: c.id, error: "credits_insufficient" }));
    return result;
  }
  if (bulk.status === "FAILED") {
    result.errors = candidates.length;
    candidates.forEach((c) => result.errorDetails.push({ leadId: c.id, error: "bulk_failed" }));
    return result;
  }

  result.creditsUsed = bulk.cost?.credits ?? 0;

  // Match résultats par index (FullEnrich préserve l'ordre des datas)
  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    if (!lead) continue;
    const item = bulk.datas?.[i];
    const contact = item?.contact;

    const updates: Record<string, unknown> = {
      fullenrichAttemptedAt: new Date(),
    };

    let emailFinal = pickBestEmail(contact);
    const phoneFinal = pickBestPhone(contact);
    const personalEmail = pickBestPersonalEmail(contact);

    // Anti-bounce : si email = bouncedFromEmail historique, on l'écarte
    if (emailFinal && lead.bouncedFromEmail && emailFinal.toLowerCase() === lead.bouncedFromEmail.toLowerCase()) {
      emailFinal = null;
    }

    if (emailFinal) {
      updates.emailFullenrich = emailFinal;
      result.emailFound += 1;
    }
    if (phoneFinal) {
      updates.phoneFullenrich = phoneFinal;
      // On pose aussi `phone` final si vide
      updates.phone = phoneFinal;
      result.phoneFound += 1;
    }
    if (personalEmail) {
      // Stocke en Kaspr Personal pour cohérence (champ existant)
      // On évite gmail/yahoo/etc. côté outreach (cf. Q6 audit)
      const isPersoDomain = /@(gmail|yahoo|hotmail|outlook|orange|free|icloud|protonmail|laposte|sfr|wanadoo|live)\./i.test(personalEmail);
      if (!isPersoDomain) {
        updates.kasprPersonalEmail = personalEmail;
        result.personalEmailFound += 1;
      }
    }

    if (emailFinal || phoneFinal) {
      result.enriched += 1;
    } else {
      result.skipped += 1;
    }

    try {
      await db.lead.update({
        where: { id: lead.id },
        data: updates,
      });
      // Recompute email confidence si nouvel email posé
      if (emailFinal) {
        await recomputeEmailConfidenceForLead(lead.id);
      }
    } catch (e) {
      result.errors += 1;
      result.errorDetails.push({
        leadId: lead.id,
        error: `db.update: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return result;
}
