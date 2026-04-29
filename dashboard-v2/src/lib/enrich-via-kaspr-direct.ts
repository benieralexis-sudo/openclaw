import "server-only";
import { db } from "@/lib/db";
import { enrichLinkedInProfile, isValidLinkedInUrl, pickPhone, type KasprProfile } from "@/lib/kaspr";
import { recomputeEmailConfidenceForLead } from "@/lib/recompute-email-confidence";

/**
 * Kaspr enrichProfile DIRECT — rattrape les leads avec LinkedIn mais
 * jamais enrichis Kaspr.
 *
 * Pourquoi ce module : `enrichLeadsViaDropcontact` chaîne Kaspr UNIQUEMENT
 * pour les leads qui passent par Dropcontact (donc ceux sans email avec
 * nom complet). Conséquence : un Lead avec linkedinUrl mais avec email
 * existant (ou sans nom complet pour Dropcontact) ne déclenchait JAMAIS
 * Kaspr → on perd mobile direct + work email Kaspr.
 *
 * Cas concret 28/04 : Rodz enrichContact ramène 3 nouveaux LinkedIn
 * (helios/SETELIA/NIMROD) mais comme ces leads avaient déjà un firstName
 * Pappers ET aucun email Dropcontact n'a été trouvé sur ce batch, Kaspr
 * n'a pas tourné. Résultat : LinkedIn coverage +3 mais 0 mobile/email
 * supplémentaire.
 *
 * Ce module corrige : pour chaque Lead avec
 *   - linkedinUrl valide (regex Kaspr-compatible)
 *   - kasprEnrichedAt null (jamais tenté) ou >7j (re-tentative cache TTL)
 *   - PAS déjà de mobile FR direct
 * → appelle Kaspr enrichProfile, hydrate Lead avec workEmail + phone.
 *
 * Plafond strict : KASPR_DIRECT_MAX_PER_RUN. Throttle pour respecter le
 * rate limit Kaspr (60/min, 500/h, 500/jour selon doc).
 */

const KASPR_DIRECT_MAX_PER_RUN = 30;
const THROTTLE_MS = 1500; // Kaspr accepte 60/min = 1/sec, on prend une marge

import { isFrenchMobile, isFrenchPhone } from "@/lib/phone-fr";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface KasprDirectResult {
  scanned: number;
  enriched: number;
  workEmailFound: number;
  mobileFound: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ leadId: string; error: string }>;
  creditsRemaining?: {
    workEmail: string | null;
    directEmail: string | null;
    phone: string | null;
    export: string | null;
  };
}

export async function enrichLeadsViaKasprDirect(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<KasprDirectResult> {
  const limit = Math.min(opts.limit ?? KASPR_DIRECT_MAX_PER_RUN, KASPR_DIRECT_MAX_PER_RUN);
  const result: KasprDirectResult = {
    scanned: 0,
    enriched: 0,
    workEmailFound: 0,
    mobileFound: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  // Stratégie TTL différenciée :
  //  - kasprEnrichedAt : posé UNIQUEMENT si on a trouvé phone OU workEmail
  //    → re-tentative après 7j (Kaspr peut ajouter un mobile entre temps)
  //  - kasprAttemptedAt : posé à CHAQUE tentative même si profile vide
  //    → cooldown 30j si rien trouvé (rare que Kaspr trouve à J+8 ce qu'il
  //    n'a pas trouvé à J0 sur un profil sans phone/email du tout)
  // Eligibilité = pas tenté OU dernier essai >30j (et pas enrichi <7j)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      linkedinUrl: { not: null },
      // Pas tenté OU dernier essai >30j
      AND: [
        {
          OR: [
            { kasprAttemptedAt: null },
            { kasprAttemptedAt: { lt: thirtyDaysAgo } },
          ],
        },
        // ET (jamais enrichi OU enrichi >7j → on retente pour mobile)
        {
          OR: [
            { kasprEnrichedAt: null },
            { kasprEnrichedAt: { lt: sevenDaysAgo } },
          ],
        },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      linkedinUrl: true,
      phone: true,
      kasprPhone: true,
      kasprWorkEmail: true,
    },
    take: limit,
    // Priorité : jamais tentés (kasprAttemptedAt null) en premier, puis par
    // récence. Postgres trie NULLS FIRST sur DESC par défaut → on profite
    // de ça pour mettre les jamais-tentés en tête sans avoir besoin du
    // syntax `{ sort, nulls }` qui plante sur le shadow Prisma.
    orderBy: [{ kasprAttemptedAt: "desc" }, { createdAt: "desc" }],
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    if (!lead || !lead.linkedinUrl) {
      result.skipped++;
      continue;
    }
    if (!isValidLinkedInUrl(lead.linkedinUrl)) {
      result.skipped++;
      continue;
    }
    // Skip si on a déjà mobile FR + work email Kaspr (rien à gagner)
    if (isFrenchMobile(lead.kasprPhone ?? lead.phone) && lead.kasprWorkEmail) {
      result.skipped++;
      continue;
    }

    if (i > 0) await sleep(THROTTLE_MS);

    const fullName =
      lead.fullName ?? [lead.firstName, lead.lastName].filter(Boolean).join(" ");

    if (!fullName) {
      // Kaspr exige le nom — sans, on ne peut pas enrichir
      result.skipped++;
      continue;
    }

    try {
      const kr = await enrichLinkedInProfile({
        id: lead.linkedinUrl,
        name: fullName,
        dataToGet: ["phone", "workEmail"],
      });

      if (kr.credits) {
        result.creditsRemaining = kr.credits;
      }

      if (!kr.ok) {
        if (kr.error === "no_credits_left") {
          result.errors++;
          result.errorDetails.push({ leadId: lead.id, error: "kaspr_no_credits" });
          break; // Stop le run si plus de crédits
        }
        if (kr.error === "rate_limit_exceeded") {
          await sleep(60_000);
          continue;
        }
        result.skipped++;
        continue;
      }

      const profile = kr.profile;
      if (!profile) {
        result.skipped++;
        // Marque tenté pour empêcher re-tentative <30j
        await db.lead.update({
          where: { id: lead.id },
          data: { kasprAttemptedAt: new Date() },
        }).catch(() => {});
        continue;
      }

      const kPhone = pickPhone(profile.phones ?? profile.phone ?? null) ?? null;
      // API Kaspr v2.0 renvoie workEmails (pluriel array), pas workEmail (singleton).
      // Audit 28/04 : 14 enrichis = 0 work emails car bug mapping. Fix : lire les
      // 2 formats (compat) et prendre le premier email valide non vide.
      const profileAny = profile as KasprProfile & {
        workEmails?: Array<string | { email?: string; status?: string }>;
        directEmails?: Array<string | { email?: string; status?: string }>;
        emails?: Array<string | { email?: string; status?: string }>;
      };
      const pickFirstEmail = (
        list: Array<string | { email?: string; status?: string }> | undefined,
      ): string | null => {
        if (!list || list.length === 0) return null;
        for (const item of list) {
          if (typeof item === "string" && item) return item;
          if (item && typeof item === "object" && item.email) return item.email;
        }
        return null;
      };
      const kasprWorkEmail =
        pickFirstEmail(profileAny.workEmails) ??
        (typeof profile.workEmail === "string"
          ? profile.workEmail
          : profile.workEmail?.email ?? null) ??
        pickFirstEmail(profileAny.emails);

      // kasprAttemptedAt toujours posé (cooldown 30j même sans match).
      // kasprEnrichedAt posé UNIQUEMENT si on a phone ou workEmail (cooldown 7j).
      const updates: Record<string, unknown> = {
        kasprAttemptedAt: new Date(),
      };
      let foundSomething = false;
      // Filtre FR (audit 29/04) : reject phones internationaux non-actionables
      // pour cold call B2B FR (UK/US/RO/MX/...). Décompte mobileFound seulement
      // sur mobile FR.
      if (kPhone && !lead.kasprPhone && isFrenchPhone(kPhone)) {
        updates.kasprPhone = kPhone;
        if (isFrenchMobile(kPhone)) result.mobileFound++;
        foundSomething = true;
      }
      if (kasprWorkEmail && !lead.kasprWorkEmail) {
        updates.kasprWorkEmail = kasprWorkEmail;
        result.workEmailFound++;
        foundSomething = true;
      }
      if (profile.title) {
        // Mémorise le titre Kaspr aussi (séparé de jobTitle Pappers)
        const t = typeof profile.title === "string" ? profile.title : null;
        if (t) updates.kasprTitle = t;
      }
      if (foundSomething) {
        updates.kasprEnrichedAt = new Date();
      }

      await db.lead.update({ where: { id: lead.id }, data: updates });
      // Q3 — recalcule email final + confidence si on a trouvé un workEmail.
      if (kasprWorkEmail) {
        await recomputeEmailConfidenceForLead(lead.id);
      }
      result.enriched++;
    } catch (e) {
      result.errors++;
      result.errorDetails.push({
        leadId: lead.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
