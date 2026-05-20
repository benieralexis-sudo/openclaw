/**
 * Pilier 3 (20/05/2026) — variantes du nom d'entreprise pour la recherche
 * inverse (méthode B : chercher le nom de la boîte dans les pages clients
 * des concurrents).
 *
 * Exemple : "UCANSS" → ["ucanss", "u.c.a.n.s.s", "u c a n s s",
 *   "union des caisses nationales de sécurité sociale"]
 * Exemple : "Centre Hospitalier de Lens" → ["ch lens", "ch de lens",
 *   "centre hospitalier de lens", "hopital de lens"]
 *
 * On utilise ensuite ces variantes pour matcher dans les HTML des pages
 * customers des concurrents.
 */

/**
 * Stop words FR/EN à ignorer dans la normalisation
 */
const STOP_WORDS = new Set([
  "de",
  "du",
  "des",
  "le",
  "la",
  "les",
  "l",
  "d",
  "et",
  "the",
  "a",
  "an",
  "of",
  "for",
  "by",
  "to",
  "with",
  "sarl",
  "sas",
  "sa",
  "eurl",
  "snc",
  "scop",
  "sci",
  "scic",
  "ltd",
  "llc",
  "gmbh",
  "inc",
  "corp",
  "co",
]);

/**
 * Génère des variantes acceptables d'un nom d'entreprise pour la recherche
 * dans du HTML brut. Retourne un Set<string> de strings tous lowercase,
 * uniques, longueur ≥ 3 chars (évite les faux positifs sur tokens courts).
 */
export function buildCompanyNameVariants(companyName: string): string[] {
  if (!companyName || companyName.trim().length < 2) return [];

  const variants = new Set<string>();
  const raw = companyName.trim();
  const lower = raw.toLowerCase();

  // Forme brute
  variants.add(lower);

  // Sans ponctuation
  const noPunct = lower.replace(/[.,;:!?()\[\]"']/g, " ").replace(/\s+/g, " ").trim();
  variants.add(noPunct);

  // Sans suffixes corporate (SAS, SARL, GmbH, Ltd, etc.)
  const tokens = noPunct.split(/\s+/);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  if (filtered.length >= 1) {
    variants.add(filtered.join(" "));
  }

  // Forme sans espaces (utile pour matching URL/slug)
  if (filtered.length >= 2) {
    variants.add(filtered.join(""));
    variants.add(filtered.join("-"));
  }

  // Si le nom est uniquement un sigle (lettres + points/espaces) → essaie aussi
  // sans points/espaces : "U.C.A.N.S.S." → "ucanss"
  const isAcronym = /^[A-Z][\.\s\-]*([A-Z][\.\s\-]*){1,8}$/.test(raw);
  if (isAcronym) {
    const compact = lower.replace(/[\s\-\.]/g, "");
    if (compact.length >= 3) variants.add(compact);
  }

  // Garde les variantes ≥ 3 chars uniquement (évite "ch", "ca", "le")
  return [...variants].filter((v) => v.length >= 3);
}

/**
 * Normalise un texte HTML pour la recherche : tout lowercase, sans accents
 * étendus, espaces normalisés. On compare ensuite via includes() qui est
 * O(n) très rapide.
 */
export function normalizeTextForCompanySearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cherche les variantes du nom dans un texte normalisé. Retourne le 1er
 * match (la variante trouvée + contexte ±80 chars) ou null.
 */
export function findCompanyMentionInText(
  text: string,
  companyVariants: string[],
): { matchedVariant: string; snippet: string } | null {
  const normalized = normalizeTextForCompanySearch(text);

  for (const variant of companyVariants) {
    const normalizedVariant = normalizeTextForCompanySearch(variant);
    if (normalizedVariant.length < 3) continue;

    // On veut éviter les faux positifs : "qonto" ne doit pas matcher
    // "quinto", "edf" ne doit pas matcher "kedf"). On force word-boundary
    // permissif (chars non-alphanum avant/après).
    const re = new RegExp(
      `(^|[^a-z0-9])${normalizedVariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
      "i",
    );
    const m = normalized.match(re);
    if (m && m.index !== undefined) {
      const start = Math.max(0, m.index - 80);
      const end = Math.min(normalized.length, m.index + m[0].length + 80);
      return {
        matchedVariant: normalizedVariant,
        snippet: normalized.slice(start, end).trim().slice(0, 240),
      };
    }
  }
  return null;
}
