import "server-only";
import { db } from "@/lib/db";
import { enrichContact, findEmail, RodzApiError } from "@/lib/rodz";
import { recomputeEmailConfidenceForLead } from "@/lib/recompute-email-confidence";

/**
 * Enrichissement Rodz — DÉBLOQUE LE LINKEDIN COVERAGE
 * ════════════════════════════════════════════════════
 *
 * Pour chaque Lead avec `firstName + lastName + companyName` mais sans
 * LinkedIn, appelle `Rodz.enrichContact()` qui retourne :
 *  - linkedInUrl ✅ (résout le bottleneck #1)
 *  - headline (ex "CTO @ Audion") → enrichit jobTitle
 *  - activeCompany (vrai employeur, peut différer du RCS Pappers)
 *  - location, skillsList, yearsOfExperience, etc.
 *
 * Pour les leads avec firstName + lastName + companyWebsite mais sans email,
 * appelle `Rodz.findEmail()` qui retourne email + status (Valid/NotFound).
 *
 * Coût : inclus dans l'abonnement Rodz Pack Pro 200€ (one-shot 26/04).
 * Nombre de crédits par appel : à mesurer (pas exposé dans la réponse).
 *
 * Idempotent : un Lead avec linkedinUrl déjà rempli est skip. Un Lead
 * dont enrichContact a renvoyé "no match" est marqué pour skip 30j (à
 * implémenter plus tard si besoin via flag DB).
 *
 * Pipeline order:
 *   Pappers (dirigeant) → Rodz enrichContact (LinkedIn) → Dropcontact
 *   (email fallback) → Kaspr (mobile + work email)
 */

export interface EnrichRodzResult {
  scanned: number;
  enrichContactCalled: number;
  linkedinFound: number;
  jobTitleUpdated: number;
  findEmailCalled: number;
  emailFound: number;
  errors: number;
  errorDetails: Array<{ leadId: string; error: string }>;
}

const BATCH_LIMIT = 30;
const THROTTLE_MS = 2500; // 2.5s entre appels Rodz pour éviter 502 (backend rate limit)
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Retry uniquement sur 502 / timeout / network — pas sur 4xx
      const retriable = /502|503|504|timeout|ECONNRESET|aborted/i.test(msg);
      if (!retriable || attempt === MAX_RETRIES) break;
      const backoff = (attempt + 1) * 3000;
      console.warn(`[rodz/${label}] retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms: ${msg}`);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Hosts trompeurs pour deviner un domain depuis le headline ou activeCompany
function guessDomainFromCompany(company: string): string | null {
  // Stratégie minimaliste : on prend le mot principal en lowercase + .fr
  // Ex: "Audion" → "audion.fr". Trop simpliste pour prod réel mais OK
  // pour un fallback quand companyWebsite n'est pas fourni par Rodz.
  if (!company) return null;
  const cleaned = company
    .toLowerCase()
    .replace(/\b(sas|sarl|sa|sasu|sci|holding|group|groupe|inc|corp|ltd)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  if (!cleaned || cleaned.length < 3) return null;
  return `${cleaned}.fr`;
}

function extractDomainFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function enrichLeadsViaRodz(
  clientId: string,
  opts: { limit?: number; dryRun?: boolean } = {},
): Promise<EnrichRodzResult> {
  const limit = Math.min(opts.limit ?? BATCH_LIMIT, BATCH_LIMIT);
  const result: EnrichRodzResult = {
    scanned: 0,
    enrichContactCalled: 0,
    linkedinFound: 0,
    jobTitleUpdated: 0,
    findEmailCalled: 0,
    emailFound: 0,
    errors: 0,
    errorDetails: [],
  };

  // Eligibilité : Lead avec nom + entreprise mais SANS LinkedIn URL,
  // jamais tenté Rodz (ou tenté >14j → Rodz a peut-être ajouté le profil
  // depuis). Sans ce filtre, les leads "no match" étaient re-tentés à
  // chaque cron 6h → latence + 502 cumul + bruit log.
  // On priorise les Leads les plus récents (createdAt DESC) pour traiter
  // les derniers signaux d'achat en priorité.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      OR: [{ linkedinUrl: null }, { linkedinUrl: "" }],
      firstName: { not: null },
      lastName: { not: null },
      companyName: { not: "" },
      AND: [
        {
          OR: [
            { rodzAttemptedAt: null },
            { rodzAttemptedAt: { lt: fourteenDaysAgo } },
          ],
        },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      jobTitle: true,
      email: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    if (!lead || !lead.firstName || !lead.lastName || !lead.companyName) continue;

    if (opts.dryRun) {
      result.enrichContactCalled++;
      continue;
    }

    // Throttle entre appels (sauf le premier) — Rodz backend renvoie 502
    // au-delà de ~10 calls/sec en burst.
    if (i > 0) await sleep(THROTTLE_MS);

    // ─────────────────────────────────────────────
    // 1. enrichContact (firstName + lastName + companyName) → LinkedIn + headline
    // ─────────────────────────────────────────────
    let linkedinUrl: string | null = null;
    let headline: string | null = null;
    let companyWebsite: string | null = null;

    try {
      result.enrichContactCalled++;
      const fn = lead.firstName!;
      const ln = lead.lastName!;
      const cn = lead.companyName!;
      const rsp = await withRetry(
        () => enrichContact({ firstName: fn, lastName: ln, companyName: cn }),
        "enrichContact",
      );
      const person = rsp?.data?.person;
      if (person?.linkedInUrl) {
        // Normalize URL https://
        const url = person.linkedInUrl.startsWith("http")
          ? person.linkedInUrl
          : `https://${person.linkedInUrl}`;
        linkedinUrl = url;
      }
      if (person?.headline) headline = person.headline;
      if (person?.companyWebsite) companyWebsite = person.companyWebsite;
    } catch (e) {
      // SERVICE_ERROR Rodz est récurrent — on log doucement, on continue
      const msg = e instanceof RodzApiError ? `${e.code}: ${e.message}` : String(e);
      result.errors++;
      result.errorDetails.push({ leadId: lead.id, error: `enrichContact: ${msg}` });
    }

    // ─────────────────────────────────────────────
    // 2. findEmail (si pas d'email + on a un domaine plausible)
    // ─────────────────────────────────────────────
    let emailFound: string | null = null;
    if (!lead.email) {
      const domain =
        extractDomainFromUrl(companyWebsite ?? undefined) ?? guessDomainFromCompany(lead.companyName);
      if (domain) {
        try {
          result.findEmailCalled++;
          const fn = lead.firstName!;
          const ln = lead.lastName!;
          const rsp = await withRetry(
            () => findEmail({ firstName: fn, lastName: ln, domain }),
            "findEmail",
          );
          if (rsp?.data?.status === "Valid" && rsp.data.email) {
            emailFound = rsp.data.email;
          }
        } catch (e) {
          const msg = e instanceof RodzApiError ? `${e.code}: ${e.message}` : String(e);
          result.errors++;
          result.errorDetails.push({ leadId: lead.id, error: `findEmail: ${msg}` });
        }
      }
    }

    // ─────────────────────────────────────────────
    // 3. Update Lead avec ce qu'on a trouvé
    // ─────────────────────────────────────────────
    // On pose TOUJOURS rodzAttemptedAt (même sans match) pour empêcher la
    // re-tentative au prochain cron 6h. TTL 14j (cf. query plus haut).
    const updates: Record<string, unknown> = {
      rodzAttemptedAt: new Date(),
    };
    if (linkedinUrl) {
      updates.linkedinUrl = linkedinUrl;
      result.linkedinFound++;
    }
    if (headline && (!lead.jobTitle || lead.jobTitle.length < headline.length)) {
      // On garde un jobTitle riche : "CTO @ Audion" écrase "Président" si Rodz est plus précis
      updates.jobTitle = headline;
      result.jobTitleUpdated++;
    }
    if (emailFound) {
      // Q3 — stocke dans `emailRodz` (source-tagged). Le champ `email` final
      // est calculé par recomputeEmailConfidenceForLead à partir des 3 sources.
      updates.emailRodz = emailFound;
    }
    try {
      await db.lead.update({
        where: { id: lead.id },
        data: updates,
      });
      if (emailFound) {
        await recomputeEmailConfidenceForLead(lead.id);
        result.emailFound++;
      }
    } catch (e) {
      result.errors++;
      result.errorDetails.push({
        leadId: lead.id,
        error: `db.update: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return result;
}
