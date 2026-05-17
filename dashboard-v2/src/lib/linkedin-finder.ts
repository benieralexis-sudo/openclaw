import "server-only";

/**
 * LinkedIn Finder — étage 3-bis du waterfall (30/04/2026)
 * ──────────────────────────────────────────────────────────────────────
 *
 * Trouve le LinkedIn URL pour les Leads avec persona connue
 * (firstName+lastName+companyName) mais sans linkedinUrl. Cascade :
 *
 *   1. HarvestAPI Profile Search par nom+société (~$0.005/lookup, ~70% hit)
 *   2. Google CSE site:linkedin.com/in/ "Nom" "Société" (gratuit, ~50% résidu)
 *
 * Note : Rodz enrichContact tourne déjà AVANT (lib/enrich-via-rodz.ts) — on
 * ne le re-déclenche pas ici. Le finder cible uniquement les leads que Rodz
 * a déjà tenté ET ratés (rodzAttemptedAt IS NOT NULL et linkedinUrl IS NULL).
 *
 * Gate : Triggers avec score >= 6 uniquement (Qualifiés + Pépites).
 * Les leads marginaux/faibles ne sont pas enrichis (économie crédits).
 */

import { runAndGetItems } from "@/lib/apify";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type LinkedInFinderSource =
  | "harvestapi-profile-search";
// "google-cse" retiré 17/05 — 0 lead résolu en historique, fallback Google CSE
// supprimé (cf find-tech-leader-cascade.ts également supprimé).

export interface LinkedInFinderResult {
  linkedinUrl: string;
  source: LinkedInFinderSource;
  confidence: number; // 0-100
  raw?: unknown;
}

interface FindArgs {
  firstName: string;
  lastName: string;
  companyName: string;
  // Si fourni, sert au scoring (matcher CTO contre CFO non pertinent)
  jobTitleHint?: string;
}

// ──────────────────────────────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────────────────────────────

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLinkedInProfileUrl(u: string): boolean {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return /(^|\.)linkedin\.com$/.test(url.hostname) && /^\/in\//.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeLinkedInUrl(u: string): string {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    // Force https + www + drop query/hash
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

function scoreNameMatch(
  expectedFirst: string,
  expectedLast: string,
  candidateFull: string,
): number {
  const cf = normalize(candidateFull);
  const ef = normalize(expectedFirst);
  const el = normalize(expectedLast);
  if (!cf) return 0;

  // STRICT MODE (30/04 v2) — éviter Antoine→Romain Bidault MAIS accepter les
  // firstNames composés (ex "Denis Marc Auguste Andre Lafont" doit matcher un
  // profil LinkedIn affichant juste "Denis Lafont").
  // Règle : le PREMIER token significatif (>=3 chars) du firstName attendu
  // DOIT être présent dans le candidat. Sinon rejet hard.
  const firstToken = ef.split(" ").find((t) => t.length >= 3);
  if (firstToken && !cf.includes(firstToken)) return 0;

  let s = 0;
  // +40 si le 1er token du firstName match (cas commun, robuste aux noms composés)
  if (firstToken && cf.includes(firstToken)) s += 40;
  // Bonus +10 si le firstName complet match (ef long et présent en cf)
  if (ef.length >= 4 && cf.includes(ef)) s += 10;
  // +50 si le lastName match
  if (cf.includes(el) && el.length >= 2) s += 50;
  // Si le full name candidat contient firstToken + lastName dans l'ordre
  if (firstToken && el) {
    const sequence = `${firstToken} ${el}`;
    if (cf.includes(sequence)) s += 10;
  }
  return s;
}

function scoreCompanyMatch(expectedCompany: string, candidate: string): number {
  const ec = normalize(expectedCompany);
  const cc = normalize(candidate);
  if (!ec || !cc) return 0;
  if (cc === ec) return 30;
  if (cc.includes(ec) || ec.includes(cc)) return 25;
  // Match sur le 1er mot significatif (ex "Davidson Consulting" → "Davidson")
  const firstWord = ec.split(" ").find((w) => w.length >= 4);
  if (firstWord && cc.includes(firstWord)) return 15;
  return 0;
}

// ──────────────────────────────────────────────────────────────────────
// Source 1 — HarvestAPI Profile Search (Apify)
// ──────────────────────────────────────────────────────────────────────

const HARVEST_ACTOR = "harvestapi/linkedin-profile-search";

interface HarvestProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  url?: string;
  profileUrl?: string;
  publicIdentifier?: string;
  headline?: string;
  currentPosition?: { companyName?: string; title?: string };
  currentPositions?: Array<{ companyName?: string; title?: string; current?: boolean }>;
  location?: string;
}

async function findViaHarvestAPI(
  args: FindArgs,
): Promise<LinkedInFinderResult | null> {
  const search = `${args.firstName} ${args.lastName}`.trim();
  if (!search) return null;

  // 1ère tentative : recherche stricte avec filtre company
  let items: HarvestProfile[] = [];
  try {
    const result = await runAndGetItems<HarvestProfile>(
      HARVEST_ACTOR,
      {
        search,
        currentCompanies: [args.companyName],
        locations: ["France"],
        maxItems: 8,
        profileScraperMode: "Short",
      },
      { timeout: 120, memory: 512, itemsLimit: 8 },
    );
    items = result.items;
  } catch (e) {
    console.warn(
      `[linkedin-finder] HarvestAPI strict failed for "${search}" @ "${args.companyName}":`,
      e instanceof Error ? e.message : e,
    );
  }

  // 2ème tentative : sans filtre company, on filtre côté scoring (cas où
  // nom commercial ≠ nom légal RCS, ex "Linkup Partner" vs "Linkup", ou
  // "PRECIA" vs "Precia Molen", ou "BA France" vs "Bull Atos")
  if (items.length === 0) {
    try {
      const result = await runAndGetItems<HarvestProfile>(
        HARVEST_ACTOR,
        {
          search: `${search} ${args.companyName}`,
          locations: ["France"],
          maxItems: 8,
          profileScraperMode: "Short",
        },
        { timeout: 120, memory: 512, itemsLimit: 8 },
      );
      items = result.items;
    } catch (e) {
      console.warn(
        `[linkedin-finder] HarvestAPI loose failed for "${search}":`,
        e instanceof Error ? e.message : e,
      );
      return null;
    }
  }

  if (items.length === 0) return null;

  // Score chaque candidat : nom (90 max) + société (30 max) = 120 max
  const scored = items
    .map((p) => {
      const fullName =
        p.fullName?.trim() ||
        `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
      const currentCo =
        p.currentPositions?.find((cp) => cp.current !== false)?.companyName ??
        p.currentPosition?.companyName ??
        "";
      const nameScore = scoreNameMatch(args.firstName, args.lastName, fullName);
      const coScore = scoreCompanyMatch(args.companyName, currentCo);
      return { profile: p, nameScore, coScore, total: nameScore + coScore };
    })
    .filter((s) => s.nameScore >= 50) // au moins le nom de famille match
    .sort((a, b) => b.total - a.total);

  const best = scored[0];
  if (!best) return null;

  const url =
    best.profile.linkedinUrl ??
    best.profile.url ??
    best.profile.profileUrl ??
    (best.profile.publicIdentifier
      ? `https://www.linkedin.com/in/${best.profile.publicIdentifier}`
      : null);
  if (!url || !isLinkedInProfileUrl(url)) return null;

  // Confidence : 100% si nom+société matchent, dégradé sinon
  const confidence = Math.min(100, Math.round((best.total / 120) * 100));
  if (confidence < 60) return null; // pas assez sûr → on laisse Google CSE essayer

  return {
    linkedinUrl: normalizeLinkedInUrl(url),
    source: "harvestapi-profile-search",
    confidence,
    raw: best.profile,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Cascade publique
// ──────────────────────────────────────────────────────────────────────
//
// Note 17/05/2026 — Google CSE fallback retiré (0 lead résolu en historique,
// confirmé par Alexis). On reste sur HarvestAPI seul. Si HarvestAPI échoue
// pour un lead avec persona connue mais sans LinkedIn URL, on accepte
// l'absence — Phase 4 Haiku fallback gère la résolution persona en amont
// si nécessaire.

export async function findLinkedInUrl(
  args: FindArgs,
): Promise<LinkedInFinderResult | null> {
  if (!args.firstName || !args.lastName || !args.companyName) return null;
  // HarvestAPI Profile Search (~70% hit, $0.005/lookup absorbé Apify)
  return findViaHarvestAPI(args);
}
