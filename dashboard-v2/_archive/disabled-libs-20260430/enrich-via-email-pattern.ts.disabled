import "server-only";
import { db } from "@/lib/db";
import { findValidEmail } from "@/lib/email-pattern";
import { getEntreprise } from "@/lib/pappers";

/**
 * Enrichissement email DIY — pattern + MX check
 * ═══════════════════════════════════════════════
 *
 * Pour chaque Lead avec firstName + lastName + companyName/SIRET mais
 * SANS email, on :
 *   1. Résout le domain (kaspr work email > Pappers website > guess company.fr)
 *   2. Vérifie le MX du domain (gratuit, RGPD-safe)
 *   3. Génère le pattern le plus probable (prenom.nom@ ~50% PME FR)
 *   4. Stocke comme UNVERIFIED (le commercial vérifie via 1er email + bounce)
 *
 * Mode probe (off par défaut) : SMTP RCPT TO probe → status VERIFIED si OK.
 * Désactivé par défaut pour préserver la réputation IP du serveur (Primeforge
 * warmup en cours). À activer une fois Primeforge stabilisé OU on bascule
 * sur MillionVerifier (20€/mo, prochain achat).
 */

export interface EmailPatternResult {
  scanned: number;
  domainResolved: number;
  mxFound: number;
  emailGuessed: number;
  emailVerified: number; // mode probe uniquement
  skipped: number;
  errors: number;
}

const BATCH_LIMIT = 30;

// Hosts génériques à exclure quand on guess (on tape un fournisseur SaaS au lieu de la boîte)
const GENERIC_HOSTS = new Set(["gmail.com", "outlook.com", "yahoo.fr", "yahoo.com", "free.fr", "wanadoo.fr", "orange.fr", "laposte.net", "hotmail.fr", "hotmail.com", "icloud.com"]);

function extractDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain || GENERIC_HOSTS.has(domain)) return null;
  return domain;
}

function extractDomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (GENERIC_HOSTS.has(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function guessDomainFromCompany(name: string): string | null {
  if (!name) return null;
  const cleaned = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sas|sasu|sarl|sa|sci|holding|group|groupe|inc|corp|ltd|ai)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  if (!cleaned || cleaned.length < 3) return null;
  return `${cleaned}.fr`;
}

/**
 * Résout le domaine d'une boîte via plusieurs sources :
 *   1. Lead.kasprWorkEmail (si Kaspr a déjà donné un work email)
 *   2. Pappers `site_internet` via getEntreprise(siren) — illimité forfait
 *   3. Guess `companyname.fr` (fallback)
 */
async function resolveDomain(args: {
  kasprWorkEmail: string | null;
  companyName: string;
  companySiret: string | null;
}): Promise<string | null> {
  const fromKaspr = extractDomainFromEmail(args.kasprWorkEmail);
  if (fromKaspr) return fromKaspr;

  // Pappers site_internet — coût 0€ (forfait illimité)
  if (args.companySiret) {
    const siren = args.companySiret.replace(/\s+/g, "").slice(0, 9);
    if (/^\d{9}$/.test(siren)) {
      try {
        const ent = await getEntreprise(siren, {});
        // L'objet PappersEntreprise n'inclut pas site_internet par défaut, mais
        // il est dans le payload brut comme `domaine`. Si Pappers le retourne,
        // on l'utilise. Sinon on continue.
        const e = ent as unknown as { site_internet?: string | null; domaine?: string | null };
        const fromPappers = extractDomainFromUrl(e.site_internet ?? e.domaine ?? null);
        if (fromPappers) return fromPappers;
      } catch {
        // skip silencieux
      }
    }
  }

  // Fallback guess
  return guessDomainFromCompany(args.companyName);
}

export async function enrichLeadsViaEmailPattern(
  clientId: string,
  opts: { limit?: number; probe?: boolean } = {},
): Promise<EmailPatternResult> {
  const limit = Math.min(opts.limit ?? BATCH_LIMIT, BATCH_LIMIT);
  const result: EmailPatternResult = {
    scanned: 0,
    domainResolved: 0,
    mxFound: 0,
    emailGuessed: 0,
    emailVerified: 0,
    skipped: 0,
    errors: 0,
  };

  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      OR: [{ email: null }, { email: "" }],
      firstName: { not: null },
      lastName: { not: null },
      companyName: { not: "" },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      companySiret: true,
      kasprWorkEmail: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  for (const lead of candidates) {
    if (!lead.firstName || !lead.lastName || !lead.companyName) {
      result.skipped++;
      continue;
    }

    let domain: string | null;
    try {
      domain = await resolveDomain({
        kasprWorkEmail: lead.kasprWorkEmail,
        companyName: lead.companyName,
        companySiret: lead.companySiret,
      });
    } catch {
      result.errors++;
      continue;
    }

    if (!domain) {
      result.skipped++;
      continue;
    }
    result.domainResolved++;

    try {
      const r = await findValidEmail({
        firstName: lead.firstName,
        lastName: lead.lastName,
        domain,
        probe: opts.probe ?? false,
        maxProbes: 5,
      });

      if (r.mxFound) result.mxFound++;
      if (!r.email) {
        result.skipped++;
        continue;
      }

      // Mapping vers enum EmailStatus Prisma : UNVERIFIED | VALID | RISKY | INVALID | BOUNCED
      // - "verified" (SMTP probe OK) → VALID
      // - "catch-all" → RISKY (le serveur accepte tout, on ne peut pas vraiment vérifier)
      // - "unverified" / autre → UNVERIFIED
      const emailStatus =
        r.status === "verified" ? "VALID" : r.status === "catch-all" ? "RISKY" : "UNVERIFIED";
      await db.lead.update({
        where: { id: lead.id },
        data: {
          email: r.email,
          emailStatus,
        },
      });
      result.emailGuessed++;
      if (r.status === "verified") result.emailVerified++;
    } catch (e) {
      result.errors++;
      console.warn(`[email-pattern] err ${lead.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return result;
}
