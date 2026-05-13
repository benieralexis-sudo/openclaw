/**
 * Multi-tenant title filter — partagé entre apify-poller et francetravail-poller.
 *
 * Construit un filtre titre (match include + reject exclude) à partir de
 * l'ICP d'un client. Default DTL = QA strict, surchargeable via
 * icp.titleFilterInclude / titleFilterExclude.
 *
 * Format icp :
 *   - string : pattern regex direct (ex "\\b(qa|test)\\b")
 *   - string[] : array de mots-clés bruts (assemblés en \b(kw1|kw2|...)\b)
 */

export const DEFAULT_TITLE_INCLUDE_REGEX =
  /\b(qa|q\.a\.|test(?:eur|ing|er|s)?|quality\s*assurance|automaticien|sdet|qualiticien|recette|validation\s+log)/i;

export const DEFAULT_TITLE_EXCLUDE_REGEX =
  /\b(m[ée]canique|cvc|a[eé]rospatial|a[eé]ronautique|industriel(?!le.*qa)|paqa\b|chimie|bio[mt]|process(?!.*qa)|cadre\s+de\s+sant)/i;

export interface IcpTitleFilterConfig {
  titleFilterInclude?: string | string[];
  titleFilterExclude?: string | string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePattern(
  pattern: string | string[] | undefined,
  fallback: RegExp,
): RegExp {
  if (!pattern) return fallback;
  if (Array.isArray(pattern)) {
    if (pattern.length === 0) return fallback;
    return new RegExp(`\\b(${pattern.map(escapeRegex).join("|")})\\b`, "i");
  }
  return new RegExp(pattern, "i");
}

/**
 * Construit la fonction de filtre titre pour un client.
 * Renvoie true si le titre matche l'include ET ne matche pas l'exclude.
 */
export function buildTitleFilterForClient(
  icp: IcpTitleFilterConfig,
): (title: string | undefined | null) => boolean {
  const includeRegex = compilePattern(icp.titleFilterInclude, DEFAULT_TITLE_INCLUDE_REGEX);
  const excludeRegex = compilePattern(icp.titleFilterExclude, DEFAULT_TITLE_EXCLUDE_REGEX);
  return (title) => {
    if (!title) return false;
    if (excludeRegex.test(title)) return false;
    return includeRegex.test(title);
  };
}
