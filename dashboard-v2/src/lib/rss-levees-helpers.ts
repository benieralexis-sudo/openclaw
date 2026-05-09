// Sprint 1 (10/05/2026) — Helpers RSS-levees migrés du bot trigger-engine.
//
// Logique pure : detection funding via regex + extraction nom entreprise +
// extraction montant. Portée TS depuis skills/trigger-engine/sources/rss-levees.js
// (logique éprouvée 2 mois en prod, ~2300 events captés).
//
// Aucun I/O ici. Le poller (rss-levees-poller.ts) orchestre fetch + DB.

/**
 * Patterns regex de détection levée (FR + EN). Au moins 1 match = candidat funding.
 */
const FUNDING_PATTERNS: RegExp[] = [
  /\bl[èe]ve[nt]?\b/i,
  /\blev[ée]e de fonds\b/i,
  /\b(s[ée]curise|boucle|annonce|obtient|d[ée]croche|r[ée]alise)[a-z]*\s+(une|sa|son|un)?\s*(tour|lev[ée]e|round|financement|investissement)\b/i,
  /\braises?\s+[\$€£]?\s*\d/i,
  /\bs[ée]rie\s+[A-E]\b/i,
  /\bseed(\s+round)?\b/i,
  /\b(pre.?seed|pr[ée].?amor[çc]age|amor[çc]age)\b/i,
  /\b\d+[,\.]?\d*\s*(m€|meur|m euros|million[s]?|k€|keur|k euros|\$m|m\$)/i,
  /\bmillions?\s+(d['e]\s*)?euros?\b/i,
];

/**
 * Stopwords pour le 1er token candidat extrait du titre. Évite les triggers
 * fantômes type "Les startups françaises lèvent..." → companyName="Les".
 *
 * Ported from bot rss-levees.js (Fix A1 du 05/05).
 */
const FIRST_TOKEN_STOPWORDS = new Set<string>([
  // Articles / déterminants
  "le", "la", "les", "un", "une", "des", "ce", "cette", "ces", "mon", "ton", "son",
  // Mots éditoriaux
  "funding", "news", "scoop", "exclusif", "exclusive", "alerte", "alert",
  "annonce", "annonces", "interview", "tribune", "podcast", "edito",
  "edition", "édition", "weekly", "daily", "hebdo", "matin", "soir",
  // Pays / régions
  "france", "français", "francaise", "française", "français", "europe", "europeen",
  "uk", "us", "usa", "états", "etats", "états-unis", "etats-unis",
  "canada", "brésil", "bresil", "russie", "afrique", "asie", "amérique",
  "amerique", "africa", "asia", "america", "china", "chine", "india", "germany",
  "japan", "japon", "allemagne", "italie", "espagne", "royaume",
  // Mois
  "janvier", "février", "fevrier", "mars", "avril", "mai", "juin", "juillet",
  "août", "aout", "septembre", "octobre", "novembre", "décembre", "decembre",
  // Generic
  "startup", "scaleup", "scale-up", "fintech", "deeptech", "biotech",
]);

/**
 * Détecte si un titre+description évoque une levée de fonds.
 */
export function looksLikeFunding(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return FUNDING_PATTERNS.some((rx) => rx.test(text));
}

/**
 * Extrait un nom d'entreprise depuis un titre RSS.
 * Plusieurs heuristiques en cascade. Renvoie null si rien de plausible.
 */
export function extractCompanyName(title: string): string | null {
  if (!title) return null;
  let t = title.trim();

  // Strip prefix bracket "[Funding]", "[Levée]", etc. (fix M7 04/05)
  t = t.replace(/^\s*\[[^\]]{1,30}\]\s*/i, "");

  const tryReturn = (candidate: string | null): string | null => {
    if (!candidate) return null;
    const trimmed = candidate.trim();
    const firstTok = (trimmed.split(/\s+/)[0] || "").toLowerCase();
    if (FIRST_TOKEN_STOPWORDS.has(firstTok)) return null;
    return trimmed;
  };

  // Pattern: "La startup/scaleup/fintech X ..."
  const mStartup = t.match(
    /\b(?:la startup|la scaleup|la scale-up|la fintech|l'entreprise|la soci[ée]t[ée]|le groupe)\s+([A-Z][A-Za-zÀ-ÿ0-9\-\.']+(?:\s+[A-Z][A-Za-zÀ-ÿ0-9\-\.']+){0,2})/i,
  );
  if (mStartup) {
    const out = tryReturn(mStartup[1] ?? null);
    if (out) return out;
  }

  // Pattern: "<Company> lève/boucle/annonce/..."
  const mBefore = t.match(
    /^([A-Z][A-Za-zÀ-ÿ0-9\-\.' ]{1,40}?)\s+(?:l[èe]ve|boucle|annonce|s[ée]curise|obtient|d[ée]croche|r[ée]alise|raises?|raises|secures|closes|bags)/,
  );
  if (mBefore) {
    const out = tryReturn(mBefore[1] ?? null);
    if (out) return out;
  }

  // Pattern "5M€ pour <Company>" (fix M7 04/05)
  const mAfterAmount = t.match(
    /\d+[\.\,]?\d*\s*(?:m€|m\$|millions?|k€)\s+(?:pour|for|to|à)\s+([A-Z][A-Za-zÀ-ÿ0-9\-\.']+(?:\s+[A-Z][A-Za-zÀ-ÿ0-9\-\.']+){0,2})/i,
  );
  if (mAfterAmount) {
    const out = tryReturn(mAfterAmount[1] ?? null);
    if (out) return out;
  }

  // Pattern "[Company]" en tête avant ":" ou "-"
  const mPrefix = t.match(
    /^([A-Z][A-Za-zÀ-ÿ0-9\-\.']{1,30}(?:\s+[A-Z][A-Za-zÀ-ÿ0-9\-\.']+){0,2})\s*[:|\-–—]/,
  );
  if (mPrefix) {
    const out = tryReturn(mPrefix[1] ?? null);
    if (out) return out;
  }

  // Fallback : 1er token capitalisé non-stopword (>=4 chars)
  const tokens = t.split(/\s+/);
  for (const tok of tokens) {
    if (
      /^[A-Z][A-Za-zÀ-ÿ0-9\-\.']{3,}$/.test(tok) &&
      !FIRST_TOKEN_STOPWORDS.has(tok.toLowerCase())
    ) {
      return tok;
    }
  }

  return null;
}

/**
 * Validation post-extraction : un nom plausible si SIRENE résolu, sinon doit
 * ressembler à un vrai nom (≥4 chars, contient une voyelle, pas un acronyme).
 * Ported from bot rss-levees.js (fix A1 du 05/05).
 */
export function isPlausibleCompanyName(
  name: string | null,
  sireneResolved: boolean,
): boolean {
  if (!name) return false;
  if (sireneResolved) return true;
  const trimmed = name.trim();
  if (trimmed.length < 4) return false;
  if (!/[aeiouyàèéêëïî]/i.test(trimmed)) return false;
  if (trimmed.length <= 6 && trimmed === trimmed.toUpperCase()) return false;
  return true;
}

/**
 * Extrait le montant levé en euros (best effort).
 */
export function extractAmount(text: string): number | null {
  if (!text) return null;
  let m = text.match(
    /(\d+[,\.]?\d*)\s*(m€|meur|million|mn|k€|keur|m\$|\$m)/i,
  );
  if (m) {
    let value = parseFloat((m[1] ?? "0").replace(",", "."));
    const unit = (m[2] ?? "").toLowerCase();
    if (unit.startsWith("m") || unit.includes("million")) value *= 1_000_000;
    else if (unit.startsWith("k")) value *= 1_000;
    return Math.round(value);
  }
  m = text.match(/(\d+[,\.]?\d*)\s*millions?\s+(d['e]\s*)?euros?/i);
  if (m) {
    return Math.round(parseFloat((m[1] ?? "0").replace(",", ".")) * 1_000_000);
  }
  return null;
}

/**
 * Détecte le sous-type de funding pour catégorisation business.
 */
export type FundingType = "funding_seed" | "funding_series" | "funding";
export function detectFundingType(text: string): FundingType {
  const t = text.toLowerCase();
  if (/\b(pre.?seed|pr[ée].?amor[çc]age|amor[çc]age)\b/.test(t))
    return "funding_seed";
  if (/\bseed(\s+round)?\b/.test(t)) return "funding_seed";
  if (/\bs[ée]rie\s+[a-eA-E]\b/.test(t)) return "funding_series";
  return "funding";
}

/**
 * Feeds RSS sources actives. Maddyness = #1 (startup FR), Frenchweb = backup.
 * Bot avait testé Les Echos / La Tribune / BFM → trop généralistes, faible signal.
 */
export const RSS_FEEDS: Array<{ name: string; url: string }> = [
  { name: "maddyness", url: "https://www.maddyness.com/feed/" },
  { name: "frenchweb", url: "https://www.frenchweb.fr/feed" },
];
