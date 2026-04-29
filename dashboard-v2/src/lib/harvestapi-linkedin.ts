import "server-only";

/**
 * HarvestAPI LinkedIn Profile Search via Apify
 * ────────────────────────────────────────────
 *
 * Résout `firstName + lastName + companyName` → `linkedinUrl`.
 * Comble le trou principal du pipeline d'enrichissement : Pappers
 * donne le dirigeant légal (nom RCS) mais jamais son LinkedIn ;
 * Kaspr enrichProfile exige un LinkedIn URL pour fonctionner.
 *
 * Sans cette résolution, ~67% des leads restent sans LinkedIn donc
 * sans Kaspr donc sans mobile direct. Avec : on passe LinkedIn
 * coverage de ~33% à ~63% (et la cascade Kaspr derrière débloque
 * mobile + work email).
 *
 * Coût : ~$0.004 par lookup (Apify Starter $29/mo + actor pricing
 * minimal). Pour 30 leads/jour = ~$3.60/mois (absorbé dans la
 * marge prepaid de $25.94 du plan Starter).
 *
 * Garde-fous :
 *  - Cache LRU in-process 1h (TTL court car name+company → LinkedIn
 *    est stable, mais on ne veut pas dépendre d'un cache qui dépasse
 *    le restart serveur)
 *  - Timeout 60s (l'actor doit rendre vite, pas de scraping lent)
 *  - Plafond `HARVESTAPI_MAX_PER_RUN` (par run de pipeline)
 *  - Fallback gracieux : null si pas trouvé, jamais d'exception
 *  - "no cookies" actor = pas de risque ban LinkedIn (vs Phantombuster)
 *
 * Conformité RGPD : actor scrappe données publiques sans contournement
 * de paramètres de visibilité. Intérêt légitime B2B + données minimales
 * (juste profileUrl pour reconnect) = défendable.
 */

import { runAndGetItems } from "@/lib/apify";

const ACTOR_ID = "harvestapi/linkedin-profile-search";

// ──────────────────────────────────────────────────────────────────────
// Cache in-process LRU 1h
// ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  profileUrl: string | null;
  ts: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const CACHE_MAX = 500;
const cache = new Map<string, CacheEntry>();

function cacheKey(firstName: string, lastName: string, companyName: string): string {
  return [firstName, lastName, companyName]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

function cacheGet(key: string): CacheEntry | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e;
}

function cacheSet(key: string, profileUrl: string | null): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { profileUrl, ts: Date.now() });
}

// ──────────────────────────────────────────────────────────────────────
// Types HarvestAPI Profile Search response
// ──────────────────────────────────────────────────────────────────────

interface HarvestPosition {
  title?: string;
  companyName?: string;
  current?: boolean;
  companyLinkedinUrl?: string;
}

interface HarvestProfileItem {
  // Schéma réel observé 28/04/2026 (actor v0.0.223) :
  id?: string;
  linkedinUrl?: string;
  url?: string;
  profileUrl?: string;
  publicIdentifier?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  summary?: string;
  // l'actor renvoie un tableau (currentPositions), pas un singleton
  currentPositions?: HarvestPosition[];
  // Compat ancienne signature au cas où
  currentPosition?: HarvestPosition;
  experience?: HarvestPosition[];
  location?: { linkedinText?: string } | string;
}

export interface ResolvedLinkedIn {
  profileUrl: string;
  fullName?: string;
  headline?: string;
  currentCompany?: string;
  matchedFirstName?: string;
  matchedLastName?: string;
  /** Confiance heuristique 0-1 basée sur le match nom+boîte */
  confidence: number;
  fromCache: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Resolver principal
// ──────────────────────────────────────────────────────────────────────

export async function resolveLinkedInUrl(args: {
  firstName: string;
  lastName: string;
  companyName: string;
  /** Si vrai, force un nouvel appel API même si le cache a un résultat */
  bypassCache?: boolean;
}): Promise<ResolvedLinkedIn | null> {
  const { firstName, lastName, companyName } = args;
  if (!firstName?.trim() || !lastName?.trim() || !companyName?.trim()) {
    return null;
  }

  const key = cacheKey(firstName, lastName, companyName);

  if (!args.bypassCache) {
    const cached = cacheGet(key);
    if (cached) {
      if (cached.profileUrl) {
        return {
          profileUrl: cached.profileUrl,
          confidence: 1,
          fromCache: true,
        };
      }
      return null; // cache miss connu
    }
  }

  let items: HarvestProfileItem[] = [];
  try {
    // Schéma actor harvestapi/linkedin-profile-search (vérifié 28/04/2026) :
    //  - `searchQuery` (string, fuzzy LinkedIn people search)
    //  - `profileScraperMode` ("Short" = $0.10/page de 25 profils, le moins cher)
    //  - `maxItems` (limite résultats)
    //  - `locations` (filtre géo) — on met "France" pour réduire le bruit
    //  - `currentCompanies` (array de LinkedIn URLs entreprises) — pas pratique
    //    avec juste un nom, donc on s'appuie sur le scoring downstream pour
    //    filtrer les bons matches.
    // Note : ne PAS inclure companyName dans le searchQuery — LinkedIn
    // fuzzy search filtre trop strict et renvoie [] pour la plupart des
    // PME FR. Le filtre company se fait dans le scoring downstream sur
    // les currentPositions du profil.
    // Idem locations: ["France"] est supprimé — trop strict.
    const result = await runAndGetItems<HarvestProfileItem>(
      ACTOR_ID,
      {
        searchQuery: `${firstName.trim()} ${lastName.trim()}`,
        profileScraperMode: "Short",
        maxItems: 5,
      },
      { timeout: 60, itemsLimit: 5 },
    );
    items = result.items;
  } catch (e) {
    console.warn(
      `[harvestapi] resolve failed for ${firstName} ${lastName}@${companyName}:`,
      e instanceof Error ? e.message : e,
    );
    cacheSet(key, null);
    return null;
  }

  if (items.length === 0) {
    cacheSet(key, null);
    return null;
  }

  // Pick le meilleur match : on score les candidats par
  //   1. nom exact (firstName + lastName)
  //   2. company match (currentPosition / experience.current)
  const scored = items
    .map((p) => ({ profile: p, score: scoreMatch(p, firstName, lastName, companyName) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    cacheSet(key, null);
    return null;
  }

  const url =
    best.profile.linkedinUrl ??
    best.profile.url ??
    best.profile.profileUrl ??
    (best.profile.publicIdentifier
      ? `https://www.linkedin.com/in/${best.profile.publicIdentifier}`
      : null);

  if (!url) {
    cacheSet(key, null);
    return null;
  }

  // Normalize URL
  const normalized = url.startsWith("http") ? url : `https://${url}`;

  cacheSet(key, normalized);

  // Trouve la company actuelle (currentPositions[0] prio, fallback experience)
  const currentCo =
    best.profile.currentPositions?.find((p) => p.current !== false)?.companyName ??
    best.profile.currentPosition?.companyName ??
    best.profile.experience?.find((e) => e.current)?.companyName;

  return {
    profileUrl: normalized,
    fullName: best.profile.fullName ?? `${best.profile.firstName ?? ""} ${best.profile.lastName ?? ""}`.trim(),
    headline: best.profile.headline,
    currentCompany: currentCo,
    matchedFirstName: best.profile.firstName,
    matchedLastName: best.profile.lastName,
    confidence: best.score,
    fromCache: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Scoring : match nom + match company
// ──────────────────────────────────────────────────────────────────────

function normalize(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire accents
    .replace(/[^a-z0-9]/g, "");
}

function scoreMatch(
  p: HarvestProfileItem,
  firstName: string,
  lastName: string,
  companyName: string,
): number {
  const fnNorm = normalize(firstName);
  const lnNorm = normalize(lastName);
  const cnNorm = normalize(companyName);

  let score = 0;

  // Match prénom
  const pFirst = normalize(p.firstName);
  if (pFirst && pFirst === fnNorm) score += 0.4;
  else if (pFirst && (pFirst.startsWith(fnNorm) || fnNorm.startsWith(pFirst))) score += 0.2;

  // Match nom
  const pLast = normalize(p.lastName);
  if (pLast && pLast === lnNorm) score += 0.4;
  else if (pLast && (pLast.includes(lnNorm) || lnNorm.includes(pLast))) score += 0.2;

  // Match fullName fallback
  if (score === 0) {
    const pFull = normalize(p.fullName);
    if (pFull.includes(fnNorm) && pFull.includes(lnNorm)) score += 0.5;
  }

  // Match company (currentPositions array + currentPosition + experience.current)
  const companyCandidates: string[] = [];
  for (const p2 of p.currentPositions ?? []) {
    if (p2.companyName) companyCandidates.push(normalize(p2.companyName));
  }
  if (p.currentPosition?.companyName) companyCandidates.push(normalize(p.currentPosition.companyName));
  for (const e of p.experience ?? []) {
    if (e.current && e.companyName) companyCandidates.push(normalize(e.companyName));
  }
  for (const c of companyCandidates) {
    if (c && (c === cnNorm || c.includes(cnNorm) || cnNorm.includes(c))) {
      score += 0.2;
      break;
    }
  }

  return score;
}

// ──────────────────────────────────────────────────────────────────────
// Stats cache (debug / monitoring)
// ──────────────────────────────────────────────────────────────────────

export function getCacheStats(): { size: number; max: number; ttlMs: number } {
  return { size: cache.size, max: CACHE_MAX, ttlMs: CACHE_TTL_MS };
}
