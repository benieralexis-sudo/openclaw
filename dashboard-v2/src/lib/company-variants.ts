// Bug DiXiO escalation (11/05/2026) — Pure function generateCompanyVariants
// extraite de harvestapi-decision-makers.ts (qui importe `server-only`) pour
// permettre tests Vitest. Même pattern que client-scope.ts (Sprint 4 10/05).
// Aucun effet de bord, aucun fetch — string → string[].

// SAS / SARL / EURL / Société : suffixes juridiques qui polluent le matching
// LinkedIn par nom. "SOCIETE GESER BEST" est mieux matché en cherchant juste
// "Geser Best". On strip les préfixes/suffixes juridiques avant search.
const COMPANY_NORMALIZATION_NOISE =
  /\b(soci[eé]t[eé]|groupe|group|holding|sas|sasu|sarl|eurl|sa|snc|sci|consulting|services?|solutions?)\b/gi;

// Suffixes "métier" qui peuvent être strippés en variante secondaire pour
// élargir le matching. Cas Salvia Développement → "Salvia" probablement mieux
// matché sur LinkedIn. À utiliser SEULEMENT en fallback si la version verbatim
// + normalisée ont échoué (sinon on perd la précision sur les boîtes dont le
// nom commercial inclut effectivement le suffixe : "Capgemini Consulting").
const COMPANY_VARIANT_SUFFIXES =
  /\b(d[eé]veloppement|development|technologies?|technology|digital|labs?|studio|partners?|france|fr|international|global|connect|connection)\b/gi;

export function normalizeCompanyForSearch(name: string): string {
  return name
    .replace(COMPANY_NORMALIZATION_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Génère plusieurs variantes d'un nom de société pour maximiser le hit rate
 * HarvestAPI search (et Google CSE en cascade). Ordre : verbatim → normalisé
 * (sans SAS/SARL) → strippé suffixes métier (sans "Développement",
 * "Technologies", etc.) → 1er mot seul. Le dédup garantit qu'on n'essaie
 * pas la même variante 2 fois.
 *
 * Cas concrets :
 *   "Salvia Développement" → ["Salvia Développement", "Salvia"]
 *   "SOCIETE GESER BEST"   → ["SOCIETE GESER BEST", "GESER BEST", "GESER"]
 *   "Groupe Yoni"          → ["Groupe Yoni", "Yoni"]
 */
export function generateCompanyVariants(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const variants: string[] = [trimmed];

  // Variante 1 : strip préfixes/suffixes juridiques + commerciaux
  const normalized = normalizeCompanyForSearch(trimmed);
  if (normalized && normalized.toLowerCase() !== trimmed.toLowerCase()) {
    variants.push(normalized);
  }

  // Variante 2 : strip aussi suffixes métier (Développement, Technologies…)
  const stripped = normalized
    .replace(COMPANY_VARIANT_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && !variants.some((v) => v.toLowerCase() === stripped.toLowerCase())) {
    variants.push(stripped);
  }

  // Variante 3 : 1er mot seul (utile pour noms multi-mots où le brand =
  // premier mot). Ex: "Salvia Développement" → "Salvia".
  const firstWord = stripped.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 3 && !variants.some((v) => v.toLowerCase() === firstWord.toLowerCase())) {
    variants.push(firstWord);
  }

  return variants;
}
