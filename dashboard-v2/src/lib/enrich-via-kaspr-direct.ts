import "server-only";
import { db } from "@/lib/db";
import { enrichLinkedInProfile, isValidLinkedInUrl, pickPhone } from "@/lib/kaspr";

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

const KASPR_DIRECT_MAX_PER_RUN = 15;
const THROTTLE_MS = 1500; // Kaspr accepte 60/min = 1/sec, on prend une marge

const FR_MOBILE_RE = /^(\+?33\s?[67]|0[67])/;

function isFrenchMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return FR_MOBILE_RE.test(phone.replace(/\s+/g, ""));
}

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

  // TTL 7j : on retente après 7j si Kaspr a échoué (ex pas de mobile dispo
  // au moment du 1er appel mais ajouté depuis dans la base Kaspr).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      linkedinUrl: { not: null },
      // Pas encore tenté OU dernier essai >7j
      OR: [
        { kasprEnrichedAt: null },
        { kasprEnrichedAt: { lt: sevenDaysAgo } },
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
    orderBy: { createdAt: "desc" },
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
        continue;
      }

      const kPhone = pickPhone(profile.phones ?? profile.phone ?? null) ?? null;
      const we = profile.workEmail;
      const kasprWorkEmail = typeof we === "string" ? we : we?.email ?? null;

      const updates: Record<string, unknown> = {
        kasprEnrichedAt: new Date(),
      };
      if (kPhone && !lead.kasprPhone) {
        updates.kasprPhone = kPhone;
        if (isFrenchMobile(kPhone)) result.mobileFound++;
      }
      if (kasprWorkEmail && !lead.kasprWorkEmail) {
        updates.kasprWorkEmail = kasprWorkEmail;
        result.workEmailFound++;
      }
      if (profile.title) {
        // Mémorise le titre Kaspr aussi (séparé de jobTitle Pappers)
        const t = typeof profile.title === "string" ? profile.title : null;
        if (t) updates.kasprTitle = t;
      }

      await db.lead.update({ where: { id: lead.id }, data: updates });
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
