/**
 * verify-persona-coherence — bouclier anti-mismatch contact/persona.
 *
 * Pure functions (string comparison only) — pas de `server-only` pour
 * permettre tests unitaires directs. Aucun secret, aucune DB.
 *
 * Bug source (audit 04/05) : Kestra Lead créé avec firstName/lastName =
 * "Denis Marc Auguste Andre Lafont" (gérant statutaire RCS Pappers).
 * Plus tard Kaspr/FullEnrich résolvent ldehon@kestra.io (Ludovic Dehon, le
 * VRAI CTO). Aucun cross-check → on garde "Lafont" comme lead avec un email
 * qui appartient à Dehon. Pitch envoyé "Bonjour Denis" arrive chez Ludovic.
 *
 * Ce helper vérifie que le local-part de l'email OU le slug LinkedIn contient
 * au moins un token significatif (≥3 chars) du firstName OU lastName du Lead.
 * Si non → mismatch détecté, on refuse de poser cette donnée.
 *
 * Cas classiques validés :
 * - paul@collective.work + Paul Vidal → OK (paul match)
 * - paulvidal96 LinkedIn + Paul Vidal → OK (paul ET vidal matchent)
 * - ldehon@kestra.io + "Denis Marc Auguste Andre Lafont" → MISMATCH
 *   (ni 'denis', 'marc', 'auguste', 'andre', 'lafont' n'est dans 'ldehon')
 * - jean.dupont@boite.fr + Jean Dupont → OK
 * - 4+ prénoms civils Pappers ("Sebastien Amadeus Bortenlanger") → souvent
 *   indique source administrative et pas un vrai usage commercial.
 */

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function tokens(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
}

function emailLocal(email: string): string {
  return normalize(email.split("@")[0] ?? "");
}

function liSlug(url: string): string {
  const m = url.match(/\/in\/([^/?#]+)/);
  if (!m) return "";
  return normalize(m[1]!.replace(/-[a-z0-9]{6,}$/i, ""));
}

export interface CoherenceCheck {
  ok: boolean;
  reason?:
    | "email_mismatch"
    | "linkedin_mismatch"
    | "both_mismatch";
  details?: string;
}

/**
 * Vérifie qu'au moins UN token significatif (≥3 chars) du firstName OU
 * lastName est présent dans le local-part de l'email ET/OU le slug LinkedIn.
 *
 * Logique tolérante : un seul match suffit (email OU LinkedIn). On ne refuse
 * que si AUCUN des canaux fournis ne match — auquel cas c'est presque
 * toujours un mismatch d'identité (cf cas Kestra Lafont vs Dehon).
 *
 * Si aucun firstName/lastName fourni → ok=true (rien à vérifier).
 */
export function verifyPersonaCoherence(args: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  email?: string | null;
  linkedinUrl?: string | null;
}): CoherenceCheck {
  const fnTokens = tokens(args.firstName);
  const lnTokens = tokens(args.lastName);
  if (fnTokens.length === 0 && lnTokens.length === 0) return { ok: true };

  const allNameTokens = [...fnTokens, ...lnTokens];

  let emailChecked = false;
  let emailMatch = false;
  if (args.email && args.email.includes("@")) {
    emailChecked = true;
    const local = emailLocal(args.email);
    emailMatch = allNameTokens.some((t) => local.includes(t));
  }

  let liChecked = false;
  let liMatch = false;
  if (args.linkedinUrl) {
    const slug = liSlug(args.linkedinUrl);
    if (slug) {
      liChecked = true;
      liMatch = allNameTokens.some((t) => slug.includes(t));
      // Garde renforcée (15/05/2026 — bug Collective Rodz) : pour un firstName
      // multi-token (≥2 prénoms civils), un seul token peut matcher un slug
      // d'homonyme par chance. Cas observé : "Jean Marie François De Rauglaudre"
      // → slug "marieouttier" → "marie" match par coïncidence. On exige donc
      // que le lastName soit AUSSI dans le slug pour confirmer la cohérence.
      // Garde inactive sur firstName mono-token (Pierre HORNUS / pierre-hornus
      // OK même si slug ne contient que le prénom).
      if (liMatch && fnTokens.length >= 2 && lnTokens.length > 0) {
        const lnInSlug = lnTokens.some((t) => slug.includes(t));
        if (!lnInSlug) liMatch = false;
      }
    }
  }

  if (!emailChecked && !liChecked) return { ok: true };

  if (emailChecked && liChecked) {
    if (emailMatch || liMatch) return { ok: true };
    return {
      ok: false,
      reason: "both_mismatch",
      details: `email=${args.email} li=${args.linkedinUrl} firstName=${args.firstName} lastName=${args.lastName}`,
    };
  }
  if (emailChecked) {
    if (emailMatch) return { ok: true };
    return {
      ok: false,
      reason: "email_mismatch",
      details: `email=${args.email} firstName=${args.firstName} lastName=${args.lastName}`,
    };
  }
  if (liMatch) return { ok: true };
  return {
    ok: false,
    reason: "linkedin_mismatch",
    details: `li=${args.linkedinUrl} firstName=${args.firstName} lastName=${args.lastName}`,
  };
}

/**
 * Détecte un firstName issu d'extraction Pappers RCS administrative
 * (4+ prénoms civils du KBis = "Denis Marc Auguste Andre"). Indice fort
 * que la donnée est une attribution juridique, pas un usage commercial.
 */
export function looksAdministrativeFirstName(firstName: string | null | undefined): boolean {
  if (!firstName) return false;
  const parts = firstName.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 4;
}

/**
 * Vérifie que le DOMAINE d'un email correspond bien à la boîte cible.
 *
 * Bug source (audit edge case Cas 5, 04/05/2026) : 6 leads pollués en DB :
 * - Maeva Courtois CEO helios → email maeva.courtois@younited-credit.fr
 *   (Younited Credit = ANCIEN employeur, pas chez helios)
 * - Nouredine Abboud Co-Founder Novaquark → email @taragaming.com
 * - Jean-loup Wirotius LYNX RH → email @mistertemp-group.com
 * - Eudes Fontenoy eXalt → email @compass-group.fr
 * - Jonathan Marin Shape It → email @teledyne.com
 * - Eric Lacomblez Insitoo → email @ouidesk.com
 *
 * Si Fred envoie "Bonjour Maeva, je vois que helios..." → arrive chez
 * Younited Credit. Réputation Primeforge cassée + embarras commercial.
 *
 * Logique : extraire le domaine (sans TLD) et comparer aux tokens
 * significatifs du companyName normalisé. Tolère :
 * - Variantes case/accents
 * - Abréviations (ex: GitGuardian → "gitguardian")
 * - Séparateurs (& -, espaces)
 * - Sufixes "group", "tech", "labs" qu'on ignore
 *
 * Refuse :
 * - Domaines perso bien connus (gmail, outlook, etc.)
 * - Domaines totalement étrangers au nom de la boîte
 *
 * Exceptions (return true même si pas de match strict) :
 * - Sous-domaines connus de la boîte (ex: dastra.eu pour Dastra → OK)
 * - Si companyName contient "Group" et le domaine matche un mot du nom
 *   ex: "Mister Temp Group" + "mistertemp-group.com" → OK
 *   MAIS "LYNX RH" + "mistertemp-group.com" → REFUS (rien en commun)
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr",
  "outlook.com", "outlook.fr", "live.com", "live.fr", "icloud.com",
  "me.com", "orange.fr", "free.fr", "wanadoo.fr", "laposte.net",
  "sfr.fr", "neuf.fr", "bbox.fr", "aol.com", "protonmail.com",
  "proton.me", "tutanota.com", "tuta.com", "gmx.com", "gmx.fr",
  "fastmail.com", "yopmail.com", "msn.com",
]);

const COMPANY_NAME_STOPWORDS = new Set([
  "group", "groupe", "sa", "sas", "sarl", "sasu", "eurl", "snc", "sci",
  "consulting", "conseil", "tech", "labs", "lab", "studio", "studios",
  "solutions", "solution", "services", "service", "international", "france",
  "paris", "lyon", "the", "le", "la", "les", "de", "du", "des", "et", "and",
]);

function extractDomainRoot(email: string): { full: string; root: string } | null {
  const domainMatch = email.match(/@([^@]+)$/);
  if (!domainMatch) return null;
  const full = domainMatch[1]!.toLowerCase().trim();
  // Retire le TLD (dernier .xxx)
  const parts = full.split(".");
  if (parts.length < 2) return null;
  // root = avant-dernier segment (ex: weward.com → weward, sub.weward.com → weward)
  const root = parts[parts.length - 2]!;
  return { full, root };
}

export interface DomainCheck {
  ok: boolean;
  reason?: "personal_email" | "domain_mismatch" | "no_email" | "no_company";
  details?: string;
}

export function domainMatchesCompany(args: {
  email: string | null | undefined;
  companyName: string | null | undefined;
}): DomainCheck {
  if (!args.email || !args.email.includes("@")) {
    return { ok: false, reason: "no_email" };
  }
  if (!args.companyName) {
    return { ok: false, reason: "no_company" };
  }

  const domain = extractDomainRoot(args.email);
  if (!domain) return { ok: false, reason: "no_email" };

  // Email perso (gmail, etc.) → refuse pour outreach B2B pro
  if (PERSONAL_EMAIL_DOMAINS.has(domain.full)) {
    return {
      ok: false,
      reason: "personal_email",
      details: `email perso ${domain.full} pour ${args.companyName}`,
    };
  }

  // Tokens significatifs du companyName (sans stopwords, ≥3 chars)
  const companyTokens = args.companyName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !COMPANY_NAME_STOPWORDS.has(t));

  if (companyTokens.length === 0) return { ok: true }; // company tokens trop génériques

  const domainNormalized = domain.root.replace(/[^a-z0-9]/g, "");
  const fullNormalized = domain.full.replace(/[.\-_]/g, "");

  // Match si AU MOINS un token significatif (≥3 chars) est dans le domain root OU full
  const match = companyTokens.some(
    (t) => domainNormalized.includes(t) || fullNormalized.includes(t),
  );

  if (!match) {
    return {
      ok: false,
      reason: "domain_mismatch",
      details: `domain=${domain.full} ne contient aucun token de "${args.companyName}" (tokens: ${companyTokens.join(",")})`,
    };
  }

  return { ok: true };
}
