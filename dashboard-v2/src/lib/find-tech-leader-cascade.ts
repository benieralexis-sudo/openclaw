import "server-only";

/**
 * Find Tech Leader by Company — Cascade Google CSE
 * ──────────────────────────────────────────────────────────────────────
 *
 * Quand HarvestAPI search-by-company retourne 0 résultat (ou 0 tier 1-2 en
 * mode strict pour qa-hire/tech-hire), on tape Google CSE :
 *
 *   site:linkedin.com/in/ "Salvia Développement" (CTO OR "Head of Engineering"
 *   OR "Tech Lead" OR "VP Engineering" OR "Engineering Manager" OR DSI
 *   OR "Head of QA" OR "QA Manager")
 *
 * On extrait les profils LinkedIn dans les résultats, on parse le titre/
 * snippet pour identifier le rôle, et on retourne le meilleur candidat tier
 * 1-2 (CTO > Head of Eng > Tech Lead > Eng Manager > Head of QA > DSI).
 *
 * Coût : 100 queries/jour gratuites sur Google CSE (puis $5/1000). Pour ~30
 * cas/mois en escalation : ~$0.15/mois.
 *
 * Audit Fred 11/05/2026 — Levier 2 du plan escalade pour passer 92% → 97%
 * de bons contacts. Le Levier 1 (variantes nom de société) est intégré dans
 * harvestapi-decision-makers. Levier 3 (bouton dashboard manuel) couvre les
 * 3% résiduels.
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface TechLeaderCandidate {
  /** URL LinkedIn du profil trouvé (toujours sous forme https://...) */
  linkedinUrl: string;
  /** Nom complet extrait du titre de la SERP Google */
  fullName: string;
  firstName: string;
  lastName: string;
  /** Rôle extrait depuis le titre/snippet (ex: "CTO @ Salvia") */
  jobTitle: string;
  /** Tier 1=CTO/Head Eng, 2=Eng Manager/Tech Lead/Head QA, 3=Architect/Sr Eng */
  tier: 1 | 2 | 3;
  /** Source de la résolution */
  source: "google-cse-tech-search";
  /** Confidence 0-100 (titre + boîte matchés) */
  confidence: number;
}

interface FindByCompanyArgs {
  companyName: string;
  /** Variantes du nom à essayer en cas de 0 résultat (ex: ["Salvia Développement", "Salvia"]) */
  companyVariants?: string[];
  /** "qa-hire" priorise Head of QA > CTO ; "tech-hire" priorise CTO > Head Eng. Default tech-hire. */
  signalType?: "qa-hire" | "tech-hire";
}

// ──────────────────────────────────────────────────────────────────────
// Google CSE
// ──────────────────────────────────────────────────────────────────────

interface GoogleCSEItem {
  link: string;
  title: string;
  snippet?: string;
  pagemap?: Record<string, unknown>;
}

interface GoogleCSEResponse {
  items?: GoogleCSEItem[];
  searchInformation?: { totalResults?: string };
  error?: { code?: number; message?: string };
}

const QA_QUERY_ROLES = [
  '"Head of QA"',
  '"QA Manager"',
  '"QA Director"',
  '"QA Lead"',
  '"Test Manager"',
  "CTO",
  '"Head of Engineering"',
  '"Tech Lead"',
  '"Engineering Manager"',
  "DSI",
];

const TECH_QUERY_ROLES = [
  "CTO",
  '"Chief Technology Officer"',
  '"Head of Engineering"',
  '"VP Engineering"',
  '"Tech Lead"',
  '"Engineering Manager"',
  '"Directeur Technique"',
  "DSI",
];

async function queryGoogleCSE(
  company: string,
  signalType: "qa-hire" | "tech-hire",
): Promise<GoogleCSEItem[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    console.warn("[tech-leader-cascade] GOOGLE_API_KEY ou GOOGLE_CSE_ID manquant — skip");
    return [];
  }

  const roles = signalType === "qa-hire" ? QA_QUERY_ROLES : TECH_QUERY_ROLES;
  const roleQuery = roles.join(" OR ");
  const q = `site:linkedin.com/in/ "${company}" (${roleQuery})`;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", q);
  url.searchParams.set("num", "10");
  url.searchParams.set("gl", "fr");
  url.searchParams.set("hl", "fr");

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as GoogleCSEResponse;
    if (json.error) {
      console.warn(
        `[tech-leader-cascade] Google CSE error ${json.error.code}: ${json.error.message}`,
      );
      return [];
    }
    return json.items ?? [];
  } catch (e) {
    console.warn(
      `[tech-leader-cascade] Google CSE failed for "${company}":`,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────
// Scoring & parsing
// ──────────────────────────────────────────────────────────────────────

function normalize(s: string | undefined | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function isLinkedInProfileUrl(url: string): boolean {
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url);
}

function normalizeLinkedInUrl(url: string): string {
  // Strip query params + force HTTPS
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

interface RoleRule {
  pattern: RegExp;
  tier: 1 | 2 | 3;
  category: string;
}

const QA_ROLE_RULES: RoleRule[] = [
  { pattern: /\b(head of (qa|quality|test)|qa manager|qa lead|qa director|test manager|directeur (de la |des )?qualit[eé])\b/i, tier: 1, category: "head-of-qa" },
  { pattern: /\b(cto|chief tech(?:nology)? officer|directeur technique|responsable technique)\b/i, tier: 1, category: "cto" },
  { pattern: /\b(head of (engineering|tech|product|development)|vp (engineering|tech|product))\b/i, tier: 1, category: "head-of-eng" },
  { pattern: /\b(engineering manager|tech lead|tech manager|software development manager|dev manager)\b/i, tier: 2, category: "eng-manager" },
  { pattern: /\b(dsi|cio|chief information officer)\b/i, tier: 2, category: "dsi" },
  { pattern: /\b(senior (qa|test) engineer|qa automation|test automation)\b/i, tier: 3, category: "sr-qa" },
];

const TECH_ROLE_RULES: RoleRule[] = [
  { pattern: /\b(cto|chief tech(?:nology)? officer|directeur technique|responsable technique)\b/i, tier: 1, category: "cto" },
  { pattern: /\b(head of (engineering|tech|product)|vp (engineering|tech|product))\b/i, tier: 1, category: "head-of-eng" },
  { pattern: /\b(engineering manager|tech lead|tech manager|software development manager|dev manager)\b/i, tier: 2, category: "eng-manager" },
  { pattern: /\b(dsi|cio|chief information officer)\b/i, tier: 2, category: "dsi" },
  { pattern: /\b(staff engineer|principal engineer|architecte|architect)\b/i, tier: 3, category: "staff-eng" },
];

interface ScoredCandidate {
  item: GoogleCSEItem;
  tier: 1 | 2 | 3;
  category: string;
  matchedTitle: string;
  fullName: string;
  firstName: string;
  lastName: string;
  companyMatch: boolean;
  confidence: number;
}

function parseFullNameFromTitle(title: string): {
  fullName: string;
  firstName: string;
  lastName: string;
} {
  // Format SERP Google : "Prénom Nom - Rôle - Société | LinkedIn"
  // Ou : "Prénom Nom | LinkedIn"
  const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const beforeDash = cleaned.split(/\s+[-–—]\s+/)[0]?.trim() ?? "";

  if (!beforeDash) return { fullName: "", firstName: "", lastName: "" };

  const parts = beforeDash.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { fullName: beforeDash, firstName: parts[0] ?? "", lastName: "" };
  }
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { fullName: beforeDash, firstName, lastName };
}

function extractRoleFromTitle(title: string): string {
  // "Prénom Nom - CTO - Société | LinkedIn" → "CTO"
  const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  return parts[1]?.trim() ?? "";
}

function scoreCandidate(
  item: GoogleCSEItem,
  company: string,
  rules: RoleRule[],
): ScoredCandidate | null {
  if (!isLinkedInProfileUrl(item.link)) return null;

  const titleRole = extractRoleFromTitle(item.title);
  const haystack = `${item.title} ${item.snippet ?? ""}`;

  // Trouve la première règle qui matche
  let matchedRule: RoleRule | null = null;
  for (const rule of rules) {
    if (rule.pattern.test(haystack)) {
      matchedRule = rule;
      break;
    }
  }
  if (!matchedRule) return null;

  // Vérifie que la société est bien mentionnée (anti-faux positif sur ancien
  // employé qui a "Salvia" dans son historique).
  const companyNorm = normalize(company);
  const haystackNorm = normalize(haystack);
  const companyMatch = companyNorm.length >= 3 && haystackNorm.includes(companyNorm);
  if (!companyMatch) return null;

  const { fullName, firstName, lastName } = parseFullNameFromTitle(item.title);
  if (!fullName) return null;

  // Confidence : tier (1=100, 2=80, 3=60) + bonus si titre exact match
  let confidence = 100 - (matchedRule.tier - 1) * 20;
  if (titleRole && matchedRule.pattern.test(titleRole)) confidence = Math.min(100, confidence + 5);

  return {
    item,
    tier: matchedRule.tier,
    category: matchedRule.category,
    matchedTitle: titleRole || extractRoleFromTitle(item.title) || "tech leader",
    fullName,
    firstName,
    lastName,
    companyMatch,
    confidence,
  };
}

// ──────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────

export async function findTechLeaderByCompany(
  args: FindByCompanyArgs,
): Promise<TechLeaderCandidate | null> {
  const company = args.companyName?.trim();
  if (!company) return null;

  const signalType = args.signalType ?? "tech-hire";
  const variants = args.companyVariants && args.companyVariants.length > 0
    ? args.companyVariants
    : [company];

  const rules = signalType === "qa-hire" ? QA_ROLE_RULES : TECH_ROLE_RULES;

  // Essaie chaque variante jusqu'à trouver tier 1-2
  for (const variant of variants) {
    const items = await queryGoogleCSE(variant, signalType);
    if (items.length === 0) continue;

    const scored = items
      .map((it) => scoreCandidate(it, variant, rules))
      .filter((s): s is ScoredCandidate => s !== null)
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return b.confidence - a.confidence;
      });

    // Mode strict tech : on n'accepte que tier 1-2 (pas tier 3)
    const tier12 = scored.filter((s) => s.tier <= 2);
    const best = tier12[0];
    if (best) {
      console.log(
        `[tech-leader-cascade] HIT "${variant}" (signalType=${signalType}) → ${best.fullName} (${best.matchedTitle}) tier=${best.tier} confidence=${best.confidence}`,
      );
      return {
        linkedinUrl: normalizeLinkedInUrl(best.item.link),
        fullName: best.fullName,
        firstName: best.firstName,
        lastName: best.lastName,
        jobTitle: best.matchedTitle,
        tier: best.tier,
        source: "google-cse-tech-search",
        confidence: best.confidence,
      };
    }
  }

  console.log(
    `[tech-leader-cascade] 0 tech leader trouvé pour "${company}" (variants=${variants.length}, signalType=${signalType})`,
  );
  return null;
}
