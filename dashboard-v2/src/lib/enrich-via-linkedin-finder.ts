import "server-only";
import { db } from "@/lib/db";
import { findLinkedInUrl, type LinkedInFinderSource } from "@/lib/linkedin-finder";
import { enrichLinkedInProfile, isValidLinkedInUrl, pickPhone } from "@/lib/kaspr";
import { isFrenchPhone, isFrenchMobile } from "@/lib/phone-fr";
import { recomputeEmailConfidenceForLead } from "@/lib/recompute-email-confidence";
import { invalidateTriggerForRequalify } from "@/lib/requalify-engine";

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
  // Chaining Kaspr inline (audit 30/04) : quand le finder trouve un LinkedIn,
  // on enchaîne immédiatement Kaspr sur ce LinkedIn au lieu d'attendre 1h le
  // prochain run-pollers. Permet de servir le commercial avec phone/email
  // dans la même vague d'enrichissement.
  kasprChained: number;
  kasprWorkEmailFound: number;
  kasprMobileFound: number;
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
    kasprChained: 0,
    kasprWorkEmailFound: 0,
    kasprMobileFound: 0,
    errors: [],
  };

  // Plafond Kaspr chaining par run (sécurité crédits, même si Kaspr est
  // dans le plan inclus, on ne veut pas brûler 200 phones/mois en 1 run).
  const KASPR_CHAIN_MAX = 10;

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
      triggerId: true,
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
        // C9 — Cross-check LinkedIn URL slug vs firstName/lastName du Lead
        // avant de poser. LinkedInFinder peut renvoyer le profil d'un homonyme
        // ou d'un ex-employé. Voir bug Kestra (Pappers a posé Lafont, mais
        // findLinkedInUrl peut résoudre ldehon-kestra car même boîte).
        const { verifyPersonaCoherence } = await import("@/lib/verify-persona-coherence");
        const linkedinCheck = verifyPersonaCoherence({
          firstName: lead.firstName,
          lastName: lead.lastName,
          linkedinUrl: found.linkedinUrl,
        });
        if (!linkedinCheck.ok) {
          console.warn(
            `[linkedin-finder.C9] persona mismatch lead=${lead.id} firstName=${lead.firstName} lastName=${lead.lastName} linkedin=${found.linkedinUrl} reason=${linkedinCheck.reason}`,
          );
          await db.lead.update({
            where: { id: lead.id },
            data: { linkedinFinderAttemptedAt: attemptedAt },
          });
          result.bySource.none++;
          continue;
        }

        // Chaining Kaspr inline (audit 30/04) : on a un nouveau LinkedIn URL,
        // on appelle Kaspr immédiatement sur ce profil pour récupérer
        // workEmail + mobile FR. Évite d'attendre 1h le prochain run-pollers.
        let kasprWorkEmail: string | null = null;
        let kasprPhone: string | null = null;
        const shouldChainKaspr =
          isValidLinkedInUrl(found.linkedinUrl) &&
          result.kasprChained < KASPR_CHAIN_MAX;
        if (shouldChainKaspr) {
          result.kasprChained++;
          try {
            const fullName =
              `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim();
            const kr = await enrichLinkedInProfile({
              id: found.linkedinUrl,
              name: fullName,
              dataToGet: ["phone", "workEmail"],
            });
            if (kr.ok && kr.profile) {
              const kPhone = pickPhone(
                kr.profile.phones ?? kr.profile.phone ?? null,
              );
              if (kPhone && isFrenchPhone(kPhone)) {
                kasprPhone = kPhone;
                if (isFrenchMobile(kPhone)) result.kasprMobileFound++;
              }
              const prof = kr.profile as typeof kr.profile & {
                workEmails?: Array<string | { email?: string }>;
                emails?: Array<string | { email?: string }>;
              };
              const pickFirst = (
                list: Array<string | { email?: string }> | undefined,
              ): string | null => {
                if (!list || list.length === 0) return null;
                for (const it of list) {
                  if (typeof it === "string" && it) return it;
                  if (it && typeof it === "object" && it.email) return it.email;
                }
                return null;
              };
              const we = kr.profile.workEmail;
              kasprWorkEmail =
                pickFirst(prof.workEmails) ??
                (typeof we === "string" ? we : we?.email ?? null) ??
                pickFirst(prof.emails);
              if (kasprWorkEmail) result.kasprWorkEmailFound++;
            }
          } catch (e) {
            // Kaspr fail = silent. On a déjà le LinkedIn, c'est un bonus.
            result.errors.push({
              leadId: lead.id,
              reason: `kaspr_chain: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }

        await db.lead.update({
          where: { id: lead.id },
          data: {
            linkedinUrl: found.linkedinUrl,
            linkedinSource: found.source,
            linkedinFinderAttemptedAt: attemptedAt,
            status: "ENRICHED",
            enrichedAt: new Date(),
            // Persiste les enrichissements Kaspr inline si disponibles
            ...(kasprWorkEmail
              ? { kasprWorkEmail, email: kasprWorkEmail }
              : {}),
            ...(kasprPhone ? { kasprPhone } : {}),
            ...(kasprWorkEmail || kasprPhone
              ? { kasprAttemptedAt: new Date(), kasprEnrichedAt: new Date() }
              : {}),
          },
        });
        if (kasprWorkEmail) {
          // Recompute email confidence avec la nouvelle source
          try {
            await recomputeEmailConfidenceForLead(lead.id);
          } catch {
            // best effort
          }
        }
        // Sprint 3.2 (05/05) — linkedinUrl résolu (et potentiellement
        // workEmail/phone via chaining Kaspr inline). Le judge avait jugé
        // sans LinkedIn → invalide pour qu'il re-juge avec PERSONA QUAL
        // complet (linkedinUrl + jobTitle + persona vraisemblable).
        if (lead.triggerId) {
          await invalidateTriggerForRequalify(lead.triggerId, "linkedinUrl-resolved");
        }
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
