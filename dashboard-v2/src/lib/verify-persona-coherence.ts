import "server-only";

/**
 * verify-persona-coherence — bouclier anti-mismatch contact/persona.
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
