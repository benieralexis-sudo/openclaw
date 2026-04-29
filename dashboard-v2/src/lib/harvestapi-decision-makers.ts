import "server-only";

/**
 * HarvestAPI LinkedIn Profile Search — Find Decision-Makers by Company
 * ────────────────────────────────────────────────────────────────────
 *
 * Comble le trou principal du pipeline : pour les triggers qui livrent
 * SEULEMENT l'entreprise (Apify Indeed/LinkedIn-jobs, TheirStack sans
 * hiring_team rempli, trigger-engine.tech-hiring), Pappers récursion
 * holdings produit 24% de pollution ("Président via XXX HOLDING") avec
 * un décideur qui n'a rien à voir avec le poste opérationnel cible.
 *
 * Audit empirique 29/04/2026 sur 12 boîtes polluées :
 *   - Pappers actuel : 0/12 décideurs pertinents (CEO holdings, etc.)
 *   - HarvestAPI search-by-company + filtre titre tech : 7/12 (58%)
 *   - Avec regex tech élargi (Chef de Projet, DSI, Lead, Architect) : ~80%
 *
 * Coût marginal : ~$0.16/boîte en mode Full (= $0.10 page + 12×$0.004 profile).
 * Pour 50 nouveaux signaux/mois nécessitant cette résolution : ~$8 = 7€/mois,
 * absorbé dans le Plan Apify Starter $29/mo.
 *
 * Conformité RGPD : actor scrappe données publiques LinkedIn sans contournement
 * de paramètres de visibilité. Intérêt légitime B2B + données minimales
 * (juste le profile dirigeant pour outreach commercial) = défendable.
 *
 * Usage typique :
 *   const dm = await findDecisionMakerByCompany({
 *     companyName: "Davidson Consulting",
 *     signalType: "qa-hire",  // → préférence : Head of QA > CTO > Eng Manager
 *     locations: ["France"],
 *   });
 *   // → { fullName: "Bertrand Bailly", title: "CEO @ Davidson Consulting", ... }
 */

import { runAndGetItems } from "@/lib/apify";

const ACTOR_ID = "harvestapi/linkedin-profile-search";

// ──────────────────────────────────────────────────────────────────────
// Cache in-process LRU 24h (search-by-company résultats stables sur 24h)
// ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: ResolvedDecisionMaker | null;
  ts: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, CacheEntry>();

function cacheKey(companyName: string, signalType: string): string {
  return `${companyName.trim().toLowerCase()}|${signalType}`;
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

function cacheSet(key: string, result: ResolvedDecisionMaker | null): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { result, ts: Date.now() });
}

// ──────────────────────────────────────────────────────────────────────
// Types HarvestAPI Profile Search (Full mode)
// ──────────────────────────────────────────────────────────────────────

interface HarvestPosition {
  title?: string;
  companyName?: string;
  current?: boolean;
  companyLinkedinUrl?: string;
}

interface HarvestProfile {
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
  currentPositions?: HarvestPosition[];
  currentPosition?: HarvestPosition;
  location?: { linkedinText?: string } | string;
}

export type SignalType =
  | "qa-hire"           // priorité Head of QA > CTO > Eng Manager > VP Eng > Founder
  | "fundraising"       // priorité CEO > Founder > CFO
  | "tech-hire"         // priorité CTO > VP Eng > Eng Manager > Founder
  | "expansion"         // priorité CEO > COO > Founder > VP Sales
  | "default";          // priorité CTO > CEO > Founder > Director

export interface ResolvedDecisionMaker {
  profileUrl: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  headline?: string;
  currentCompany?: string;
  /** Score de pertinence 0-100 (plus haut = mieux matché au signalType) */
  confidence: number;
  /** Tier du décideur trouvé (1=meilleur, 4=fallback) */
  tier: 1 | 2 | 3 | 4;
  /** Titre catégorisé pour analytics */
  matchedTitle: string;
  fromCache: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Catalogues de titres par signal — du plus prio au moins prio
// ──────────────────────────────────────────────────────────────────────

interface TitleRule {
  pattern: RegExp;
  tier: 1 | 2 | 3 | 4;
  category: string;
}

const RULES_QA_HIRE: TitleRule[] = [
  { pattern: /\b(head of (qa|quality|test)|qa manager|qa lead|test manager|qa director|directeur qa|directeur (?:de )?(?:la )?qualité|directeur (?:de )?test)\b/i, tier: 1, category: "head-of-qa" },
  { pattern: /\b(cto|chief tech(?:nology)? officer|directeur technique|responsable technique)\b/i, tier: 1, category: "cto" },
  { pattern: /\b(head of (engineering|tech|product|development)|vp (engineering|tech|product))\b/i, tier: 1, category: "head-of-eng" },
  { pattern: /\b(engineering manager|tech lead|tech manager|software development manager|dev manager)\b/i, tier: 2, category: "eng-manager" },
  { pattern: /\b(dsi|cio|chief information officer|directeur (des )?systèmes? d['']?information)\b/i, tier: 2, category: "dsi" },
  { pattern: /\b(co.?founder|cofondateur|fondateur|founder)\b/i, tier: 2, category: "founder" },
  { pattern: /\b(ceo|chief executive officer|directeur général|président|gérant)\b/i, tier: 3, category: "ceo" },
];

const RULES_FUNDRAISING: TitleRule[] = [
  { pattern: /\b(ceo|chief executive officer|directeur général|président|gérant)\b/i, tier: 1, category: "ceo" },
  { pattern: /\b(co.?founder|cofondateur|fondateur|founder)\b/i, tier: 1, category: "founder" },
  { pattern: /\b(cfo|chief financial officer|directeur financier)\b/i, tier: 2, category: "cfo" },
  { pattern: /\b(coo|chief operating officer|directeur opérationnel)\b/i, tier: 2, category: "coo" },
  { pattern: /\b(cto|chief tech(?:nology)? officer|directeur technique)\b/i, tier: 3, category: "cto" },
];

const RULES_TECH_HIRE: TitleRule[] = [
  { pattern: /\b(cto|chief tech(?:nology)? officer|directeur technique|responsable technique)\b/i, tier: 1, category: "cto" },
  { pattern: /\b(head of (engineering|tech|product)|vp (engineering|tech|product))\b/i, tier: 1, category: "head-of-eng" },
  { pattern: /\b(engineering manager|tech lead|tech manager|software development manager|dev manager)\b/i, tier: 2, category: "eng-manager" },
  { pattern: /\b(dsi|cio|chief information officer)\b/i, tier: 2, category: "dsi" },
  { pattern: /\b(co.?founder|cofondateur|fondateur|founder)\b/i, tier: 2, category: "founder" },
  { pattern: /\b(ceo|chief executive officer|directeur général|président)\b/i, tier: 3, category: "ceo" },
];

const RULES_EXPANSION: TitleRule[] = [
  { pattern: /\b(ceo|chief executive officer|directeur général|président)\b/i, tier: 1, category: "ceo" },
  { pattern: /\b(coo|chief operating officer|directeur opérationnel)\b/i, tier: 1, category: "coo" },
  { pattern: /\b(co.?founder|cofondateur|fondateur|founder)\b/i, tier: 1, category: "founder" },
  { pattern: /\b(vp sales|head of sales|chief revenue officer|cro|directeur commercial)\b/i, tier: 2, category: "vp-sales" },
];

const RULES_DEFAULT: TitleRule[] = [
  { pattern: /\b(cto|chief tech(?:nology)? officer|directeur technique)\b/i, tier: 1, category: "cto" },
  { pattern: /\b(ceo|chief executive officer|directeur général|président)\b/i, tier: 1, category: "ceo" },
  { pattern: /\b(co.?founder|cofondateur|fondateur|founder)\b/i, tier: 1, category: "founder" },
  { pattern: /\b(head of |vp |director|directeur)\b/i, tier: 3, category: "director" },
];

const RULES_BY_SIGNAL: Record<SignalType, TitleRule[]> = {
  "qa-hire": RULES_QA_HIRE,
  "fundraising": RULES_FUNDRAISING,
  "tech-hire": RULES_TECH_HIRE,
  "expansion": RULES_EXPANSION,
  "default": RULES_DEFAULT,
};

// Filtre anti-bruit : ces titres = pas un décideur
const NON_DM_RE = /\b(stagiaire|intern|apprentice|alternant|consultant|business analyst|chargé de recrutement|recruiter|talent acquisition|recruitment|business development representative|sdr|account executive|junior|chargée? de mission|assistante?)\b/i;

// ──────────────────────────────────────────────────────────────────────
// Resolver principal
// ──────────────────────────────────────────────────────────────────────

export async function findDecisionMakerByCompany(args: {
  companyName: string;
  signalType?: SignalType;
  locations?: string[];
  bypassCache?: boolean;
  /** Plafond de profils à scanner (mode Full, $0.004/profile). Default 12. */
  maxItems?: number;
}): Promise<ResolvedDecisionMaker | null> {
  const companyName = args.companyName?.trim();
  if (!companyName) return null;

  const signalType: SignalType = args.signalType ?? "default";
  const key = cacheKey(companyName, signalType);

  if (!args.bypassCache) {
    const cached = cacheGet(key);
    if (cached) {
      return cached.result ? { ...cached.result, fromCache: true } : null;
    }
  }

  let items: HarvestProfile[] = [];
  try {
    const result = await runAndGetItems<HarvestProfile>(
      ACTOR_ID,
      {
        currentCompanies: [companyName],
        locations: args.locations ?? ["France"],
        maxItems: args.maxItems ?? 12,
        profileScraperMode: "Full",
      },
      { timeout: 180, memory: 512, itemsLimit: args.maxItems ?? 12 },
    );
    items = result.items;
  } catch (e) {
    console.warn(
      `[harvestapi-dm] search failed for "${companyName}":`,
      e instanceof Error ? e.message : e,
    );
    cacheSet(key, null);
    return null;
  }

  if (items.length === 0) {
    cacheSet(key, null);
    return null;
  }

  const rules = RULES_BY_SIGNAL[signalType];

  // Score chaque profil : tier le plus bas = meilleur, +bonus si company match exact
  const scored = items
    .map((p) => scoreProfile(p, rules, companyName))
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => {
      // Tier ascendant (1 = meilleur), puis confidence descendant
      if (a.tier !== b.tier) return a.tier - b.tier;
      return b.confidence - a.confidence;
    });

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
  const normalized = url.startsWith("http") ? url : `https://${url}`;

  const firstName = (best.profile.firstName ?? "").trim();
  const lastName = (best.profile.lastName ?? "").trim();
  const fullName =
    best.profile.fullName?.trim() || `${firstName} ${lastName}`.trim();

  const currentCo =
    best.profile.currentPositions?.find((p) => p.current !== false)?.companyName ??
    best.profile.currentPosition?.companyName;

  const result: ResolvedDecisionMaker = {
    profileUrl: normalized,
    firstName,
    lastName,
    fullName,
    jobTitle: best.titleText,
    headline: best.profile.headline,
    currentCompany: currentCo,
    confidence: best.confidence,
    tier: best.tier,
    matchedTitle: best.category,
    fromCache: false,
  };

  cacheSet(key, result);
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Scoring
// ──────────────────────────────────────────────────────────────────────

function normalize(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function scoreProfile(
  p: HarvestProfile,
  rules: TitleRule[],
  targetCompany: string,
): {
  profile: HarvestProfile;
  tier: 1 | 2 | 3 | 4;
  category: string;
  titleText: string;
  confidence: number;
} | null {
  const headline = (p.headline ?? "").trim();
  const cps = p.currentPositions ?? [];
  // Texte de référence pour le matching titre = headline + tous les currentPositions
  const titleSources = [headline, ...cps.map((cp) => cp.title ?? "")].filter(Boolean);
  const fullTitleText = titleSources.join(" | ");

  // Bypass profils "junior/intern/recruiter" = pas un décideur
  if (NON_DM_RE.test(fullTitleText) && !/(head|director|directeur|chief|cto|ceo|cfo|coo|founder|fondateur)/i.test(fullTitleText)) {
    return null;
  }

  // Match company exact (le profil bosse-t-il vraiment dans la boîte cible ?)
  const targetNorm = normalize(targetCompany);
  const cpNorm = cps.map((cp) => normalize(cp.companyName));
  const headlineNorm = normalize(headline);
  const companyMatch =
    cpNorm.includes(targetNorm) ||
    cpNorm.some((c) => c.includes(targetNorm) || targetNorm.includes(c)) ||
    headlineNorm.includes(targetNorm);

  // Si pas du tout dans la boîte → reject (probablement un faux positif)
  // Tolérance : on accepte si headline mentionne un mot signifiant de la boîte
  if (!companyMatch) return null;

  // Match titre via les rules
  for (const rule of rules) {
    if (rule.pattern.test(fullTitleText)) {
      // Confidence : tier (1=100, 2=80, 3=60, 4=40) + bonus company match exact (+10)
      let confidence = 100 - (rule.tier - 1) * 20;
      if (cpNorm.includes(targetNorm)) confidence = Math.min(100, confidence + 10);
      // Trouve le titre exact qui a matché pour le retourner
      const match = fullTitleText.match(rule.pattern);
      const titleText =
        cps[0]?.title ??
        match?.[0] ??
        headline.slice(0, 120);
      return {
        profile: p,
        tier: rule.tier,
        category: rule.category,
        titleText: titleText.trim() || "Décideur",
        confidence,
      };
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers : signal type inference depuis le sourceCode du Trigger
// ──────────────────────────────────────────────────────────────────────

export function inferSignalType(sourceCode: string, triggerTitle?: string): SignalType {
  const text = `${sourceCode ?? ""} ${triggerTitle ?? ""}`.toLowerCase();
  // QA-specific (signal #1 DTL — recrutement testeur/QA Engineer)
  if (/\b(qa|test\s*engineer|test\s*manager|quality\s*assurance|testeur|recette)\b/i.test(text)) return "qa-hire";
  if (/fundraising|funding|levée|levee|seed|series\s*[abc]/i.test(text)) return "fundraising";
  if (/merger|acquisition|m&a/i.test(text)) return "expansion";
  if (/hire|hiring|job|emploi|tech-hiring/i.test(text)) return "tech-hire";
  return "default";
}

// ──────────────────────────────────────────────────────────────────────
// Pipeline integration — enrichDecisionMakersForClient
// ──────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";

export interface EnrichDecisionMakersResult {
  scanned: number;
  found: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ leadId: string; error: string }>;
}

const HARVESTAPI_MAX_PER_RUN = 15;
const HARVESTAPI_TTL_DAYS = 30;

/**
 * Pipeline étape 3 : trouver le décideur tech pour les Leads sans persona.
 * S'exécute APRÈS ensureLeadsForAllTriggers (qui pose la persona si signal
 * Rodz/Apify-poster/TheirStack-hiring_team présent) et AVANT enrichDirigeantsForClient
 * (qui fallback sur Pappers récursion holdings).
 *
 * Sélection : Leads sans firstName/lastName (= signal n'a pas livré la personne),
 * non tentés HarvestAPI <30j, avec companyName non vide.
 */
export async function enrichDecisionMakersForClient(
  clientId: string,
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<EnrichDecisionMakersResult> {
  const limit = Math.min(options.limit ?? HARVESTAPI_MAX_PER_RUN, HARVESTAPI_MAX_PER_RUN);
  const result: EnrichDecisionMakersResult = {
    scanned: 0, found: 0, skipped: 0, errors: 0, errorDetails: [],
  };

  const ttlAgo = new Date(Date.now() - HARVESTAPI_TTL_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      companyName: { not: "" },
      AND: [
        // Leads sans persona identifiée
        {
          OR: [
            { firstName: null },
            { firstName: "" },
            { lastName: null },
            { lastName: "" },
          ],
        },
        // Pas tenté <30j
        {
          OR: [
            { harvestapiAttemptedAt: null },
            { harvestapiAttemptedAt: { lt: ttlAgo } },
          ],
        },
      ],
      trigger: { score: { gte: 5 } }, // skip leads bas-score (économie credits)
    },
    select: {
      id: true,
      companyName: true,
      trigger: { select: { sourceCode: true, title: true } },
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  for (const lead of candidates) {
    if (options.dryRun) continue;

    const sourceCode = lead.trigger?.sourceCode ?? "";
    const triggerTitle = lead.trigger?.title ?? "";
    const signalType = inferSignalType(sourceCode, triggerTitle);

    try {
      const dm = await findDecisionMakerByCompany({
        companyName: lead.companyName,
        signalType,
        maxItems: 12,
      });

      // Pose toujours `harvestapiAttemptedAt` (TTL 30j) pour éviter retry
      const updates: Record<string, unknown> = {
        harvestapiAttemptedAt: new Date(),
      };

      if (dm) {
        updates.firstName = dm.firstName;
        updates.lastName = dm.lastName;
        updates.fullName = dm.fullName;
        updates.jobTitle = dm.jobTitle;
        updates.linkedinUrl = dm.profileUrl;
        updates.personaTier = dm.tier;
        updates.personaSource = "harvestapi-search";
        result.found += 1;
      } else {
        result.skipped += 1;
      }

      await db.lead.update({
        where: { id: lead.id },
        data: updates,
      });
    } catch (e) {
      result.errors += 1;
      result.errorDetails.push({
        leadId: lead.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
