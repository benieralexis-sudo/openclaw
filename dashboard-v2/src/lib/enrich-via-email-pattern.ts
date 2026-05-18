import "server-only";
import { db } from "@/lib/db";
import { verifyEmailSMTP } from "@/lib/email-smtp-verifier";

/**
 * V1 18/05/2026 — Étage final waterfall : devine l'email B2B par pattern
 * `prenom.nom@domaine` ET VALIDE via SMTP probe avant de le stocker.
 *
 * 100% gratuit (zéro API externe, juste DNS MX + SMTP TCP).
 * Source pattern : ~60-70% des PME FR B2B utilisent prenom.nom@ selon Hunter.io.
 * Validation SMTP : précision 75-85% (cf. email-smtp-verifier.ts), évite les
 * bounces qui dégradent la deliverability.
 *
 * Pré-requis Lead :
 *   - firstName + lastName remplis
 *   - email / kasprWorkEmail / emailFullenrich / emailRodz / emailDropcontact
 *     tous null (= waterfall payant a échoué)
 *   - emailGuessAttemptedAt null OU > 90j (TTL)
 *   - companyName rempli
 *
 * Workflow :
 *   1. Extract domain depuis Trigger.rawPayload (websiteUrl / companyWebsite)
 *   2. Build pattern `prenom.nom@domain` (sans accents, lowercase)
 *   3. Validate via SMTP probe (DNS MX + RCPT TO + catch-all check)
 *   4. Store dans Lead.emailGuess UNIQUEMENT si VALID (sinon UNKNOWN/CATCH_ALL
 *      stocké aussi mais avec un emailGuessSource explicite pour traçabilité)
 *
 * Coût : DNS MX (gratuit) + TCP connect MX:25 (gratuit) + ~3-8s par vérif.
 * Plafond 30 leads/run pour rester < 5 min de cron.
 */

interface RunResult {
  scanned: number;
  domainFound: number;
  emailGenerated: number;
  smtpValid: number;
  smtpInvalid: number;
  smtpCatchAll: number;
  smtpUnknown: number;
  skipped_no_persona: number;
  skipped_no_domain: number;
  skipped_already_attempted: number;
  examples: Array<{ name: string; email: string; source: string; status: string }>;
}

/**
 * Normalise un prénom ou nom : enlève accents + espaces + apostrophes,
 * passe en lowercase. Conserve les tirets (compose-prenoms FR fréquents).
 */
export function normalizeForEmail(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\s+/g, "-") // "Jean Pierre" → "jean-pierre"
    .replace(/[^a-z0-9-]/g, "") // garde lettres + chiffres + tirets
    .replace(/^-+|-+$/g, "");
}

const URL_FIELD_CANDIDATES = [
  "companyWebsite",
  "websiteUrl",
  "companyUrl",
  "website",
  "companyDomain",
  "domain",
  "url",
  "webUrl",
] as const;

const PLATFORM_DOMAINS_BLACKLIST = new Set([
  "linkedin.com",
  "welcometothejungle.com",
  "indeed.com",
  "indeed.fr",
  "free-work.com",
  "francetravail.fr",
  "pole-emploi.fr",
  "monster.fr",
  "monster.com",
  "apec.fr",
  "hellowork.com",
  "talent.io",
  "michaelpage.fr",
  "jobteaser.com",
  "regionsjob.com",
  "google.com",
  "googleusercontent.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
]);

/**
 * Extrait un domaine valide depuis un payload JSON. Retourne le hostname
 * sans www. (ex: "skello.io"). Skip les plateformes recrutement/social.
 */
export function extractDomainFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const tryUrl = (raw: string): string | null => {
    const normalized = raw.startsWith("http") ? raw : `https://${raw}`;
    try {
      const u = new URL(normalized);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (host.length < 4 || host.length > 100) return null;
      // Skip TLD only (ex "fr")
      if (!host.includes(".")) return null;
      // Vérifier que le domaine racine n'est pas dans la blacklist
      const root = host.split(".").slice(-2).join(".");
      if (PLATFORM_DOMAINS_BLACKLIST.has(host) || PLATFORM_DOMAINS_BLACKLIST.has(root)) {
        return null;
      }
      return host;
    } catch {
      return null;
    }
  };

  // Level 1 — champs top-level
  for (const field of URL_FIELD_CANDIDATES) {
    const v = p[field];
    if (typeof v === "string" && v.length >= 4 && v.length < 200) {
      const host = tryUrl(v);
      if (host) return host;
    }
  }
  // Level 2 — nested 1 deep (ex rodz.contact.companyWebsite)
  for (const v of Object.values(p)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      for (const field of URL_FIELD_CANDIDATES) {
        const nv = nested[field];
        if (typeof nv === "string" && nv.length >= 4 && nv.length < 200) {
          const host = tryUrl(nv);
          if (host) return host;
        }
      }
    }
  }
  return null;
}

/**
 * Génère l'email pattern `prenom.nom@domain` à partir du firstName / lastName
 * normalisés. Si le nom est composé (ex "Marie-Anne" + "De La Tour"), on
 * normalise les composantes en gardant les tirets.
 */
export function buildEmailPattern(
  firstName: string,
  lastName: string,
  domain: string,
): string {
  const first = normalizeForEmail(firstName);
  const last = normalizeForEmail(lastName);
  if (!first || !last || !domain) return "";
  return `${first}.${last}@${domain}`;
}

const TTL_DAYS = 90;

export async function enrichLeadsViaEmailPattern(
  clientId: string,
  options: { limit?: number } = {},
): Promise<RunResult> {
  const limit = options.limit ?? 30;
  const ttlAgo = new Date(Date.now() - TTL_DAYS * 86_400_000);

  const r: RunResult = {
    scanned: 0,
    domainFound: 0,
    emailGenerated: 0,
    smtpValid: 0,
    smtpInvalid: 0,
    smtpCatchAll: 0,
    smtpUnknown: 0,
    skipped_no_persona: 0,
    skipped_no_domain: 0,
    skipped_already_attempted: 0,
    examples: [],
  };

  // Critères pour candidat email pattern :
  // - firstName + lastName + companyName non null
  // - tous les emails sources null (waterfall payant a échoué)
  // - emailGuess null + emailGuessAttemptedAt null OU > TTL
  // - lead pas archivé
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: { not: "ARCHIVED" },
      firstName: { not: null },
      lastName: { not: null },
      // companyName est String non-null sur Lead → pas de filter nécessaire
      // Tous les emails sources doivent être null
      email: null,
      kasprWorkEmail: null,
      emailFullenrich: null,
      emailRodz: null,
      emailDropcontact: null,
      emailGuess: null,
      OR: [
        { emailGuessAttemptedAt: null },
        { emailGuessAttemptedAt: { lt: ttlAgo } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      trigger: {
        select: { rawPayload: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  for (const lead of candidates) {
    r.scanned += 1;

    if (!lead.firstName || !lead.lastName || !lead.companyName) {
      r.skipped_no_persona += 1;
      continue;
    }

    const domain = extractDomainFromPayload(lead.trigger?.rawPayload);
    if (!domain) {
      // On marque attempted=now pour ne pas re-tenter avant 90j (on n'a pas
      // de domaine, ça ne marchera pas la prochaine fois sans un trigger
      // enrichi entretemps).
      await db.lead.update({
        where: { id: lead.id },
        data: { emailGuessAttemptedAt: new Date() },
      });
      r.skipped_no_domain += 1;
      continue;
    }
    r.domainFound += 1;

    const email = buildEmailPattern(lead.firstName, lead.lastName, domain);
    if (!email || !email.includes("@")) {
      await db.lead.update({
        where: { id: lead.id },
        data: { emailGuessAttemptedAt: new Date() },
      });
      r.skipped_no_persona += 1;
      continue;
    }

    // V1 18/05 — Validation SMTP avant de stocker. On évite les bounces qui
    // dégradent la deliverability. INVALID = on stocke pas l'email mais on
    // marque emailGuessAttemptedAt pour éviter de re-tenter pendant 90j.
    let smtpResult;
    try {
      smtpResult = await verifyEmailSMTP(email);
    } catch (e) {
      console.warn(`[enrich-email-pattern] SMTP verify failed for ${email}:`, e instanceof Error ? e.message : e);
      smtpResult = { status: "UNKNOWN" as const, detail: "verifier threw", durationMs: 0 };
    }

    const status = smtpResult.status;
    const source = `pattern.first.last.smtp.${status.toLowerCase()}`;

    // INVALID = on ne stocke PAS l'email (faux positif clair).
    // VALID / CATCH_ALL / UNKNOWN = on stocke avec le statut SMTP dans la source.
    const storeEmail = status !== "INVALID";

    await db.lead.update({
      where: { id: lead.id },
      data: {
        emailGuess: storeEmail ? email : null,
        emailGuessAttemptedAt: new Date(),
        emailGuessSource: source,
      },
    });

    if (status === "VALID") r.smtpValid += 1;
    else if (status === "INVALID") r.smtpInvalid += 1;
    else if (status === "CATCH_ALL") r.smtpCatchAll += 1;
    else r.smtpUnknown += 1;

    if (storeEmail) r.emailGenerated += 1;
    if (r.examples.length < 5) {
      r.examples.push({
        name: `${lead.firstName} ${lead.lastName}`,
        email,
        source: domain,
        status,
      });
    }
  }

  console.log(
    `[enrich-email-pattern] client=${clientId} scanned=${r.scanned} smtp_valid=${r.smtpValid} catch_all=${r.smtpCatchAll} unknown=${r.smtpUnknown} invalid=${r.smtpInvalid} no_domain=${r.skipped_no_domain}`,
  );
  return r;
}
