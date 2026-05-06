import "server-only";

/**
 * Bonus C (05/05/2026) — Google CSE layoffs/PSE/restructuration news.
 *
 * Pourquoi : Sprint 9 a posé NEGATIVE SIGNALS via Pappers RCS dépôts. Bon
 * mais lag 3-7 jours (le RCS publie après l'événement). La presse FR
 * (Les Echos, Maddyness, BFM) capte les annonces J+0/+1.
 *
 * Réutilise pattern Google CSE existant (linkedin-finder.ts:259-330).
 *
 * Architecture re-call (cf. plan investigation Bonus C) :
 * 1er Opus call → si score >= 8 ET pas déjà hard-negative-cap (Sprint 9) →
 * searchLayoffsNews → si hits ≥1 source distincte ET dateRestrict m3 →
 * 2e Opus call avec bloc NEGATIVE_NEWS injecté → soft cap score ≤ 5.
 *
 * Coût estimé :
 * - ~5-10 leads/jour DTL avec score Opus >= 8
 * - ~5-10 calls Google CSE/jour (large dans free tier 100/jour)
 * - +15% Anthropic (~$2-3/jour) sur ces leads
 *
 * Anti-faux-positifs :
 * - dateRestrict=m3 (3 mois max — articles vieux ignorés)
 * - Whitelist sources FR business : Les Echos, Maddyness, BFM, Légifrance
 * - 2 sources distinctes minimum (single-source = rumeur)
 * - Patterns query : "{company}" + (layoffs|plan social|PSE|licenciement collectif)
 */

const TRUSTED_FR_SOURCES = [
  "lesechos.fr",
  "maddyness.com",
  "bfmtv.com",
  "legifrance.gouv.fr",
  "latribune.fr",
  "lefigaro.fr/economie",
  "challenges.fr",
  "frenchweb.fr",
  "usinenouvelle.com",
];

interface GoogleCSEItem {
  title: string;
  link: string;
  snippet?: string;
  displayLink?: string;
}

interface GoogleCSEResponse {
  items?: GoogleCSEItem[];
  error?: { code: number; message: string };
  searchInformation?: { totalResults?: string };
}

export interface LayoffsNewsResult {
  found: boolean;
  hitsCount: number;
  distinctSources: number;
  topHits: Array<{ title: string; source: string; snippet: string }>;
  /** Raw query used (debug) */
  query: string;
}

/**
 * Cherche des news layoffs/PSE/restructuration récentes (3 mois) sur cette boîte.
 * Retourne `found=true` si ≥1 hit dans ≥1 source whitelist trustée.
 *
 * Si Google CSE non configuré ou erreur réseau → retourne found=false (best-effort).
 */
export async function searchLayoffsNews(
  companyName: string,
): Promise<LayoffsNewsResult> {
  const empty: LayoffsNewsResult = {
    found: false,
    hitsCount: 0,
    distinctSources: 0,
    topHits: [],
    query: "",
  };

  if (!companyName || companyName.trim().length < 3) return empty;

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    console.warn("[layoffs-news] GOOGLE_API_KEY or GOOGLE_CSE_ID missing — skip");
    return empty;
  }

  // Pattern : "{company}" combo négatifs FR + EN. Limite aux sources whitelistées via OR.
  // dateRestrict=m3 = 3 derniers mois (filtre articles vieux qui restent indexés).
  const sourcesFilter = TRUSTED_FR_SOURCES.map((s) => `site:${s}`).join(" OR ");
  const negativeKeywords = `(layoffs OR "plan social" OR PSE OR "licenciement collectif" OR "licenciement économique" OR restructuration OR "cession totale" OR "fermeture" OR "redressement judiciaire")`;
  const q = `"${companyName}" ${negativeKeywords} (${sourcesFilter})`;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", q);
  url.searchParams.set("num", "10");
  url.searchParams.set("gl", "fr");
  url.searchParams.set("hl", "fr");
  url.searchParams.set("dateRestrict", "m3"); // Anti faux positifs anciens

  let json: GoogleCSEResponse;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
    json = (await res.json()) as GoogleCSEResponse;
  } catch (e) {
    console.warn(
      `[layoffs-news] Google CSE failed for "${companyName}":`,
      e instanceof Error ? e.message : e,
    );
    return { ...empty, query: q };
  }

  if (json.error) {
    console.warn(
      `[layoffs-news] Google CSE error ${json.error.code}: ${json.error.message}`,
    );
    return { ...empty, query: q };
  }

  const items = json.items ?? [];
  if (items.length === 0) return { ...empty, query: q };

  // Compte sources distinctes (sécurité : 2+ sources requises pour valider)
  const sourcesSeen = new Set<string>();
  const topHits: LayoffsNewsResult["topHits"] = [];
  for (const item of items) {
    const source = (item.displayLink ?? "").toLowerCase();
    if (!source) continue;
    // On accepte uniquement les sources whitelist (le query OR site: limite déjà,
    // mais defensive coding pour Google qui parfois match malgré le filtre)
    const matchesWhitelist = TRUSTED_FR_SOURCES.some((s) => source.includes(s));
    if (!matchesWhitelist) continue;
    sourcesSeen.add(source);
    if (topHits.length < 3) {
      topHits.push({
        title: item.title.slice(0, 120),
        source,
        snippet: (item.snippet ?? "").slice(0, 200),
      });
    }
  }

  const found = sourcesSeen.size >= 2;

  if (found) {
    console.log(
      `[layoffs-news] HITS for "${companyName}": ${topHits.length} hits / ${sourcesSeen.size} sources distinctes`,
    );
  }

  return {
    found,
    hitsCount: items.length,
    distinctSources: sourcesSeen.size,
    topHits,
    query: q,
  };
}

/**
 * Format pour injection dans userPrompt qualify-trigger comme bloc
 * NEGATIVE NEWS. Compact : ~150-300 chars selon nombre de hits.
 */
export function formatNegativeNewsBlock(result: LayoffsNewsResult): string | null {
  if (!result.found || result.topHits.length === 0) return null;
  const lines: string[] = [];
  lines.push(
    `NEGATIVE NEWS (Google CSE, ${result.distinctSources} sources FR distinctes <90j) :`,
  );
  for (const h of result.topHits) {
    lines.push(`- [${h.source}] ${h.title}`);
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Sprint C.2 (06/05/2026) — Recherche news GÉNÉRALISTE 30j (positif + négatif)
// ────────────────────────────────────────────────────────────────────────
// Complète searchLayoffsNews (focus négatif uniquement) avec une recherche
// élargie aux signaux POSITIFS récents (levée, expansion, partenariat, M&A).
// Injecté dans userPrompt qualify comme bloc COMPANY NEWS (différent de
// NEGATIVE NEWS du Bonus C qui sert au soft-cap score).
// ────────────────────────────────────────────────────────────────────────

export interface CompanyNewsResult {
  positive: Array<{ title: string; source: string; snippet: string; tags: string[] }>;
  negative: Array<{ title: string; source: string; snippet: string }>;
  hasContent: boolean;
  query: string;
}

const POSITIVE_KEYWORDS_TAGS: Array<{ keyword: string; tag: string }> = [
  { keyword: "levée", tag: "fundraising" },
  { keyword: "funding", tag: "fundraising" },
  { keyword: "tour de table", tag: "fundraising" },
  { keyword: "série a", tag: "fundraising" },
  { keyword: "série b", tag: "fundraising" },
  { keyword: "seed", tag: "fundraising" },
  { keyword: "expansion", tag: "expansion" },
  { keyword: "ouverture bureau", tag: "expansion" },
  { keyword: "partenariat", tag: "partnership" },
  { keyword: "acquisition", tag: "m-a" },
  { keyword: "rachat", tag: "m-a" },
  { keyword: "lance", tag: "product-launch" },
  { keyword: "lancement", tag: "product-launch" },
  { keyword: "recrute", tag: "hiring-spree" },
  { keyword: "embauche", tag: "hiring-spree" },
];

/**
 * Recherche news positives + négatives <30j sur la boîte (whitelist FR).
 * Sépare les hits par sentiment via tagging keyword. Best-effort (silent
 * fail si Google CSE down ou quota épuisé).
 */
export async function searchCompanyNews(
  companyName: string,
  opts: { dateRestrict?: string } = {},
): Promise<CompanyNewsResult> {
  const empty: CompanyNewsResult = {
    positive: [],
    negative: [],
    hasContent: false,
    query: "",
  };

  if (!companyName || companyName.trim().length < 3) return empty;

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) return empty;

  const dateRestrict = opts.dateRestrict ?? "m1"; // 1 mois par défaut
  const sourcesFilter = TRUSTED_FR_SOURCES.map((s) => `site:${s}`).join(" OR ");
  // Query large : entre guillemets pour précision sur le nom, pas de filtre keyword
  // (on classifie après via POSITIVE_KEYWORDS_TAGS et le pattern négatif de search-layoffs)
  const q = `"${companyName}" (${sourcesFilter})`;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", q);
  url.searchParams.set("num", "10");
  url.searchParams.set("gl", "fr");
  url.searchParams.set("hl", "fr");
  url.searchParams.set("dateRestrict", dateRestrict);

  let json: GoogleCSEResponse;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
    json = (await res.json()) as GoogleCSEResponse;
  } catch (e) {
    console.warn(
      `[company-news] Google CSE failed for "${companyName}":`,
      e instanceof Error ? e.message : e,
    );
    return { ...empty, query: q };
  }

  if (json.error || !json.items) return { ...empty, query: q };

  const negativeRegex =
    /layoffs|plan social|\bPSE\b|licenciement|restructuration|cession totale|fermeture|redressement|liquidation|cessation/i;

  for (const item of json.items) {
    const source = (item.displayLink ?? "").toLowerCase();
    if (!source) continue;
    const matchesWhitelist = TRUSTED_FR_SOURCES.some((s) => source.includes(s));
    if (!matchesWhitelist) continue;

    const text = `${item.title} ${item.snippet ?? ""}`.toLowerCase();

    if (negativeRegex.test(text)) {
      if (empty.negative.length < 3) {
        empty.negative.push({
          title: item.title.slice(0, 120),
          source,
          snippet: (item.snippet ?? "").slice(0, 180),
        });
      }
      continue;
    }

    const tags = POSITIVE_KEYWORDS_TAGS.filter(({ keyword }) =>
      text.includes(keyword.toLowerCase()),
    ).map((p) => p.tag);

    if (tags.length > 0 && empty.positive.length < 3) {
      empty.positive.push({
        title: item.title.slice(0, 120),
        source,
        snippet: (item.snippet ?? "").slice(0, 180),
        tags: Array.from(new Set(tags)),
      });
    }
  }

  empty.hasContent = empty.positive.length > 0 || empty.negative.length > 0;
  empty.query = q;

  if (empty.hasContent) {
    console.log(
      `[company-news] "${companyName}": +${empty.positive.length} positive / -${empty.negative.length} negative news <${dateRestrict}`,
    );
  }
  return empty;
}

/**
 * Format pour injection dans userPrompt qualify comme bloc COMPANY NEWS.
 * Sépare positifs (signal d'achat) et négatifs (red flag à investiguer).
 */
export function formatCompanyNewsBlock(result: CompanyNewsResult): string | null {
  if (!result.hasContent) return null;
  const lines: string[] = [];
  if (result.positive.length > 0) {
    lines.push(`COMPANY NEWS positives (Google CSE FR <30j) :`);
    for (const h of result.positive) {
      lines.push(`- [${h.source}] ${h.tags.join("/")} → ${h.title}`);
    }
  }
  if (result.negative.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`COMPANY NEWS négatives (Google CSE FR <30j, à pondérer dans scoring) :`);
    for (const h of result.negative) {
      lines.push(`- [${h.source}] ${h.title}`);
    }
  }
  return lines.join("\n");
}
