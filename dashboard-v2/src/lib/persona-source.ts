/**
 * Fix B7 (11/05/2026) — Parser typé pour le champ Lead.personaSource.
 *
 * Le champ est stocké en DB sous forme de string concaténée :
 *   "none + jobtitle-upgrade + headline-upgrade"
 *   "pappers-rcs"
 *   "rodz-payload + harvestapi-search"
 *
 * Pour pouvoir filtrer/analyser de manière fiable ("tous les leads ayant
 * subi un headline-upgrade"), ce helper transforme la string en array
 * typé. On garde la string en DB (pas de migration), la transformation
 * se fait au point de lecture.
 *
 * À utiliser côté UI / dashboard / analytics. Côté écriture (enrichers),
 * le format string concaténée reste valide tant que les tags utilisent
 * le séparateur " + ".
 */

export const PERSONA_SOURCE_TAGS = [
  // Sources d'enrichissement primaires
  "rodz-payload",
  "theirstack-hiring-team",
  "apify-poster",
  "harvestapi-search",
  "pappers-rcs",
  "pappers-holding-fallback",
  // Sources cascade LinkedIn finder
  "rodz-contact-enrich",
  "google-cse",
  "linkedin-finder-cascade",
  // Tags d'upgrade post-enrichissement
  "jobtitle-upgrade",
  "headline-upgrade",
  // Tag legacy (avant attribution)
  "none",
] as const;

export type PersonaSourceTag = (typeof PERSONA_SOURCE_TAGS)[number];

const TAG_SET = new Set<string>(PERSONA_SOURCE_TAGS);

/**
 * Parse le champ Lead.personaSource (string concaténée) en array de tags.
 * Les tokens inconnus sont ignorés (mais loggés en debug à l'appelant).
 *
 * @returns array de tags valides (peut être vide si aucun match)
 */
export function parsePersonaSources(
  raw: string | null | undefined,
): { known: PersonaSourceTag[]; unknown: string[] } {
  if (!raw) return { known: [], unknown: [] };
  const tokens = raw
    .split("+")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const known: PersonaSourceTag[] = [];
  const unknown: string[] = [];
  for (const t of tokens) {
    if (TAG_SET.has(t)) {
      known.push(t as PersonaSourceTag);
    } else {
      unknown.push(t);
    }
  }
  return { known, unknown };
}

/**
 * Format inverse : array de tags → string concaténée pour stockage DB.
 * Utilisé seulement si on veut migrer un écriveur vers le format typé.
 */
export function formatPersonaSources(tags: readonly PersonaSourceTag[]): string {
  return tags.join(" + ");
}

/**
 * Helper : vérifier si un lead a subi un type d'attribution donné.
 * Plus lisible que `lead.personaSource?.includes("headline-upgrade")` qui
 * ferait des faux positifs sur des sous-chaînes.
 */
export function hasPersonaSourceTag(
  raw: string | null | undefined,
  tag: PersonaSourceTag,
): boolean {
  const { known } = parsePersonaSources(raw);
  return known.includes(tag);
}

/**
 * Helper UI : retourne uniquement les tags d'attribution réelle (filtre "none"
 * et les upgrade tags qui sont des dérivations post-enrichissement).
 *
 * Utile pour afficher "via Rodz + HarvestAPI" sans polluer avec "none" ou
 * les tags techniques d'upgrade.
 */
export function getPrimaryAttributionSources(
  raw: string | null | undefined,
): PersonaSourceTag[] {
  const { known } = parsePersonaSources(raw);
  const TECHNICAL_TAGS = new Set<PersonaSourceTag>([
    "none",
    "jobtitle-upgrade",
    "headline-upgrade",
  ]);
  return known.filter((t) => !TECHNICAL_TAGS.has(t));
}
