// Bombora FR — Jour 11 (19/05/2026) — Helpers France Travail signature topic.
//
// Logique pure : matching mots-clés + anti-vendeur + blacklist allégée pour
// Bombora FR (les collectivités sont des CIBLES, pas du bruit).
//
// On NE réutilise PAS `isFTBlacklisted` de francetravail.ts car celle-ci
// exclut "mairie", "communauté de communes", "conseil départemental",
// "métropole"… qui sont exactement les boîtes que Bombora FR cherche à
// détecter (acheteurs publics de signature électronique).

/**
 * Blacklist allégée Bombora FR :
 *   - On garde uniquement les vraies sources de bruit (agences intérim,
 *     restaurants, retail grand public)
 *   - On RETIRE les collectivités/écoles/musées qui sont des cibles
 *     légitimes pour le topic signature électronique
 *
 * Agences d'intérim ne sont jamais des prospects (elles publient pour des
 * tiers, donc l'entreprise nominale est l'agence pas la vraie boîte cible).
 */
import { countSignatureMatches } from "./signature-matching";

const STAFFING_AGENCIES_LIGHT = [
  "adecco",
  "manpower",
  "randstad",
  "crit",
  "synergie",
  "proman",
  "expectra",
  "kelly services",
  "gi group",
  "start people",
  "supplay",
  "actual",
  "domino rh",
  "partnaire",
  "temporis",
  "adia",
  "aquila rh",
  "menway",
  "ras",
  "omega interim",
  "axeo",
  "leader intérim",
  "rh intérim",
  "team emploi",
];

const NON_PROSPECT_KEYWORDS_LIGHT = [
  "interim",
  "intérim",
  "restaurant",
  "brasserie",
  " cafe",
  " café",
  "boulangerie",
  "patisserie",
  "boucherie",
  "poissonnerie",
  "mcdonald",
  "burger king",
  "subway",
  "starbucks",
  // PAS de "mairie", "conseil departemental", "métropole" — cibles pour signature
];

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, " ")
    .replace(/\s+/g, " ");
}

export function isBombloraBlacklisted(nom: string | undefined): boolean {
  if (!nom) return true;
  const n = normalize(nom);
  if (
    STAFFING_AGENCIES_LIGHT.some(
      (bad) => n === bad || n.startsWith(bad + " ") || n.startsWith(bad + "-"),
    )
  )
    return true;
  const padded = " " + n + " ";
  return NON_PROSPECT_KEYWORDS_LIGHT.some((kw) => padded.includes(kw));
}

/**
 * Compte les keywords présents dans le texte (titre + description). Insensible
 * à la casse, accent-tolérant. Logique identique aux pollers sœurs LinkedIn /
 * RSS médias signature. Duplication assumée (helpers purs sans coupling).
 */
export function countSignatureMatchesInOffer(
  text: string | undefined,
  keywords: string[],
): { count: number; labels: string[] } {
  // Jour 14 Sujet 14 (20/05) — Délégué à countSignatureMatches du module
  // signature-matching commun (stemming-aware).
  return countSignatureMatches(text, keywords);
}

/**
 * Anti-vendeur : si nom d'entreprise correspond à un produit cité dans les
 * keywords, c'est probablement le vendeur lui-même qui poste une offre.
 * Match containment bidirectionnel sur tokens de longueur ≥4.
 */
export function isVendorCompany(
  companyName: string,
  keywords: string[],
): boolean {
  const name = companyName.toLowerCase();
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length < 4) continue;
    if (!/\s/.test(k)) {
      if (name.includes(k)) return true;
      continue;
    }
    if (name.includes(k)) return true;
  }
  return false;
}
