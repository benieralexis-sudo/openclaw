import "server-only";

// Sprint catalogue (16/05/2026) — Helper P2 : scan team via HarvestAPI.
//
// Utilise l'actor `harvestapi/linkedin-profile-search` (déjà branché pour
// les decision-makers) en mode "Short" (rapide + cheap, $0.10/page de 25).
//
// Stratégie 2 passes :
//   Passe A — Récupère N employés (max 50) pour mesurer la taille de la boite
//             (currentCompanies=[name], pas de filtre titre).
//   Passe B — Recherche les employés avec missing roles (currentJobTitles).
//             Si 0 résultat ET passe A >= minTeamSize → P2 confirmé.
//
// Coût indicatif : ~$0.30 par scan (Passe A 50 profils + Passe B 5 profils).
// Cache in-process 7j par (companyName, missingRolesKey) pour éviter re-scans.

import { runAndGetItems } from "@/lib/apify";
import { analyzeTeamGap, type EmployeeProfile, type TeamGapResult } from "@/lib/team-gap-detector";

const ACTOR_ID = "harvestapi/linkedin-profile-search";

// ──────────────────────────────────────────────────────────────────────
// Cache LRU 7j (les compositions d'équipe changent lentement)
// ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;
interface CacheEntry {
  result: TeamGapResult;
  ts: number;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(companyName: string, missingRoles: string[]): string {
  return `${companyName.trim().toLowerCase()}::${[...missingRoles].sort().join("|").toLowerCase()}`;
}

function cacheGet(key: string): TeamGapResult | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.result;
}

function cacheSet(key: string, result: TeamGapResult): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { result, ts: Date.now() });
}

// ──────────────────────────────────────────────────────────────────────
// Types HarvestAPI minimal
// ──────────────────────────────────────────────────────────────────────

interface HarvestPosition {
  title?: string;
  current?: boolean;
}

interface HarvestProfileItem {
  id?: string;
  linkedinUrl?: string;
  url?: string;
  profileUrl?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  currentPositions?: HarvestPosition[];
  currentPosition?: HarvestPosition;
}

function profileToEmployee(p: HarvestProfileItem): EmployeeProfile {
  // Le titre actuel est dans currentPositions[0].title ou headline
  const currentTitle =
    p.currentPositions?.[0]?.title ??
    p.currentPosition?.title ??
    p.headline ??
    null;
  return {
    title: currentTitle,
    name: p.fullName ?? (`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null),
  };
}

function profileIdentifier(p: HarvestProfileItem): string {
  return p.profileUrl ?? p.linkedinUrl ?? p.url ?? p.id ?? `${p.firstName}|${p.lastName}`;
}

// ──────────────────────────────────────────────────────────────────────
// Scan principal
// ──────────────────────────────────────────────────────────────────────

export interface ScanTeamGapOptions {
  companyName: string;
  missingRoles: string[];
  /** Taille minimale d'équipe pour considérer un gap (default 10) */
  minTeamSize?: number;
  /** Nb max profils à scanner pour la taille (default 50) */
  maxScanProfiles?: number;
  /** Force un nouvel appel API même si cache hit */
  bypassCache?: boolean;
}

/**
 * Scan une boite pour détecter un gap d'équipe sur les missingRoles.
 *
 * Retourne TeamGapResult (hasGap, totalEmployees, etc.) ou null si scan
 * impossible (companyName/missingRoles vides, ou échec API total).
 *
 * Cache 7j par (companyName, missingRoles) — les équipes évoluent lentement.
 */
export async function scanTeamGapForCompany(
  options: ScanTeamGapOptions,
): Promise<TeamGapResult | null> {
  const companyName = options.companyName?.trim();
  const missingRoles = (options.missingRoles ?? []).filter(
    (r) => typeof r === "string" && r.trim().length >= 2,
  );

  if (!companyName || missingRoles.length === 0) {
    return null;
  }

  const minTeamSize = options.minTeamSize ?? 10;
  const maxScan = options.maxScanProfiles ?? 50;
  const key = cacheKey(companyName, missingRoles);

  if (!options.bypassCache) {
    const cached = cacheGet(key);
    if (cached) {
      return cached;
    }
  }

  // ── Passe A : total employees (filtre company only) ──
  let allProfiles: HarvestProfileItem[] = [];
  try {
    const passA = await runAndGetItems<HarvestProfileItem>(
      ACTOR_ID,
      {
        currentCompanies: [companyName],
        locations: ["France"],
        maxItems: maxScan,
        profileScraperMode: "Short", // cheap : $0.10/page 25
      },
      { timeout: 180, memory: 512, itemsLimit: maxScan },
    );
    allProfiles = passA.items;
  } catch (e) {
    console.warn(
      `[harvestapi-team-scan] Passe A failed for ${companyName}:`,
      e instanceof Error ? e.message : e,
    );
    return null; // sans Passe A on peut pas conclure (faux positifs)
  }

  // Si Passe A ramène trop peu de profils, on conclut team-too-small et on
  // évite Passe B (économie API).
  if (allProfiles.length < minTeamSize) {
    const result = analyzeTeamGap(
      allProfiles.map(profileToEmployee),
      missingRoles,
      { minTeamSize },
    );
    cacheSet(key, result);
    return result;
  }

  // ── Passe B : filtre missing roles (économie : maxItems=5 suffit pour
  // confirmer présence ou non) ──
  let filteredProfiles: HarvestProfileItem[] = [];
  try {
    const passB = await runAndGetItems<HarvestProfileItem>(
      ACTOR_ID,
      {
        currentCompanies: [companyName],
        currentJobTitles: missingRoles,
        locations: ["France"],
        maxItems: 5,
        profileScraperMode: "Short",
      },
      { timeout: 180, memory: 512, itemsLimit: 5 },
    );
    filteredProfiles = passB.items;
  } catch (e) {
    console.warn(
      `[harvestapi-team-scan] Passe B failed for ${companyName}:`,
      e instanceof Error ? e.message : e,
    );
    // On peut continuer avec Passe A seule (analyse sera plus large)
  }

  // Dédup union des 2 passes par identifiant profil
  const seen = new Set<string>();
  const merged: HarvestProfileItem[] = [];
  for (const p of [...allProfiles, ...filteredProfiles]) {
    const id = profileIdentifier(p);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(p);
  }

  const employees = merged.map(profileToEmployee);
  const result = analyzeTeamGap(employees, missingRoles, { minTeamSize });

  cacheSet(key, result);
  return result;
}
