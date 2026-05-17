// Sprint catalogue (16/05/2026) — Helper de lecture ClientSignalConfig.
// Pas de `import "server-only"` car ce module est testé via Vitest avec
// vi.mock("@/lib/db"). Le module reste server-only en pratique car db
// (Prisma) l'est. Si un jour on l'importe côté client par erreur, Next.js
// bloquera via le import server-only de db.ts.
//
// Permet aux pollers d'interroger proprement le catalogue universel
// paramétrable pour savoir si un signal donné est activé pour un client,
// avec ses paramètres custom.
//
// Pattern config-driven multi-tenant. Remplace progressivement
// icp.disabledSources (qui reste en place pour rétro-compat tant que
// tous les pollers ne sont pas wired).
//
// Cache in-memory 5 min : les configs changent rarement (édition manuelle
// admin ou via wizard onboarding). 5 min couvre un cycle de cron entier
// sans recharger la DB à chaque check.

import { db } from "@/lib/db";

export interface SignalConfig {
  enabled: boolean;
  parameters: Record<string, unknown>;
  isPillar: boolean;
  /** Si le signal n'existe pas en DB pour ce client (jamais configuré),
   *  on retourne `enabled: true` par défaut (rétro-compat : un signal
   *  du catalogue tourne pour tous les clients sauf désactivation explicite).
   */
  isDefault: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
interface CacheEntry {
  configs: Map<string, SignalConfig>; // key = signalCode
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>(); // key = clientId

/**
 * Retourne true si le signal `signalCode` (ex "P3", "B1") est activé pour
 * ce client. Par défaut true (rétro-compat) si aucune config explicite.
 */
export async function isSignalEnabled(
  clientId: string,
  signalCode: string,
): Promise<boolean> {
  const cfg = await getSignalConfig(clientId, signalCode);
  return cfg.enabled;
}

/**
 * Retourne la config complète {enabled, parameters, isPillar} pour un
 * signal donné. Si la config n'existe pas en DB, retourne les defaults
 * du catalogue avec enabled=true et isDefault=true.
 */
export async function getSignalConfig(
  clientId: string,
  signalCode: string,
): Promise<SignalConfig> {
  const clientCache = await loadClientCache(clientId);
  return (
    clientCache.get(signalCode) ?? {
      enabled: true,
      parameters: {},
      isPillar: false,
      isDefault: true,
    }
  );
}

/**
 * Charge toutes les configs d'un client en une requête + cache.
 * Pré-loaded pour éviter N+1 quand un poller checke plusieurs signaux.
 */
async function loadClientCache(clientId: string): Promise<Map<string, SignalConfig>> {
  const now = Date.now();
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > now) {
    return cached.configs;
  }

  const rows = await db.clientSignalConfig.findMany({
    where: { clientId },
    select: {
      enabled: true,
      parameters: true,
      isPillar: true,
      signal: { select: { code: true } },
    },
  });

  const configs = new Map<string, SignalConfig>();
  for (const r of rows) {
    configs.set(r.signal.code, {
      enabled: r.enabled,
      parameters: (r.parameters as Record<string, unknown>) ?? {},
      isPillar: r.isPillar,
      isDefault: false,
    });
  }

  cache.set(clientId, { configs, expiresAt: now + CACHE_TTL_MS });
  return configs;
}

/**
 * Invalide le cache pour un client (à appeler après une modification UI/API).
 * Pas de cache global → si on update via Prisma direct (script CLI), il faudra
 * que le service redémarre OU attendre 5 min.
 */
export function invalidateSignalConfigCache(clientId?: string): void {
  if (clientId) {
    cache.delete(clientId);
  } else {
    cache.clear();
  }
}

/**
 * Sprint catalogue P1.3 (17/05/2026) — Helpers de lecture paramètres
 * signal-specific avec fallback icp legacy.
 *
 * Pendant la migration progressive, chaque paramètre lu côté poller passe
 * par ces helpers : on lit d'abord ClientSignalConfig.parameters.X, si
 * absent on retombe sur Client.icp.legacyKey (lifeline). Quand tous les
 * clients auront leur ClientSignalConfig backfillé, on supprimera le
 * fallback.
 */

interface IcpLegacy {
  keywordsHiring?: string[];
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  titleFilterInclude?: string | string[];
  titleFilterExclude?: string | string[];
  francetravailRomeCodes?: string[];
}

/**
 * Lit les keywords métier (P1.parameters.keywords).
 * Fallback : icp.keywordsHiring (legacy).
 */
export async function getP1Keywords(
  clientId: string,
  icp: IcpLegacy | null,
): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P1");
  const fromCatalog = (cfg.parameters as { keywords?: unknown }).keywords;
  if (Array.isArray(fromCatalog) && fromCatalog.length > 0) {
    return fromCatalog.filter((k): k is string => typeof k === "string");
  }
  return icp?.keywordsHiring ?? [];
}

/**
 * Lit les regions ciblées (P1.parameters.regions).
 * Fallback : icp.regions (legacy).
 */
export async function getP1Regions(
  clientId: string,
  icp: IcpLegacy | null,
): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P1");
  const fromCatalog = (cfg.parameters as { regions?: unknown }).regions;
  if (Array.isArray(fromCatalog) && fromCatalog.length > 0) {
    return fromCatalog.filter((r): r is string => typeof r === "string");
  }
  return icp?.regions ?? [];
}

/**
 * Lit le titleFilter (P1.parameters.titleFilterInclude/Exclude).
 * Fallback : icp.titleFilterInclude/Exclude (legacy).
 */
export async function getP1TitleFilter(
  clientId: string,
  icp: IcpLegacy | null,
): Promise<{ include?: string | string[]; exclude?: string | string[] }> {
  const cfg = await getSignalConfig(clientId, "P1");
  const params = cfg.parameters as { titleFilterInclude?: unknown; titleFilterExclude?: unknown };
  const include = (params.titleFilterInclude as string | string[] | undefined) ?? icp?.titleFilterInclude;
  const exclude = (params.titleFilterExclude as string | string[] | undefined) ?? icp?.titleFilterExclude;
  return { include, exclude };
}

/**
 * Lit les codes ROME France Travail (P1.parameters.romeCodes).
 * Fallback : icp.francetravailRomeCodes (legacy).
 */
export async function getP1RomeCodes(
  clientId: string,
  icp: IcpLegacy | null,
): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P1");
  const fromCatalog = (cfg.parameters as { romeCodes?: unknown }).romeCodes;
  if (Array.isArray(fromCatalog) && fromCatalog.length > 0) {
    return fromCatalog.filter((c): c is string => typeof c === "string");
  }
  return icp?.francetravailRomeCodes ?? [];
}

/**
 * Lit les industries cibles (P3.parameters.industries).
 * Fallback : icp.industries (legacy).
 */
export async function getP3Industries(
  clientId: string,
  icp: IcpLegacy | null,
): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P3");
  const fromCatalog = (cfg.parameters as { industries?: unknown }).industries;
  if (Array.isArray(fromCatalog) && fromCatalog.length > 0) {
    return fromCatalog.filter((i): i is string => typeof i === "string");
  }
  return icp?.industries ?? [];
}

/**
 * Lit les tranches taille cibles (P3.parameters.sizes).
 * Fallback : icp.sizes (legacy).
 */
export async function getP3Sizes(
  clientId: string,
  icp: IcpLegacy | null,
): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P3");
  const fromCatalog = (cfg.parameters as { sizes?: unknown }).sizes;
  if (Array.isArray(fromCatalog) && fromCatalog.length > 0) {
    return fromCatalog.filter((s): s is string => typeof s === "string");
  }
  return icp?.sizes ?? [];
}

/**
 * Sprint catalogue P1bis (17/05/2026) — Helper d'enrichissement icp pour les
 * call sites synchrones (rodz-provision, theirstack-provision). Retourne
 * un icp "résolu" où chaque champ signal-specific est remplacé par la valeur
 * du catalogue si disponible.
 *
 * Champs résolus depuis catalogue :
 *   - keywordsHiring ← P1.parameters.keywords
 *   - regions ← P1.parameters.regions
 *   - industries ← P3.parameters.industries
 *   - sizes ← P3.parameters.sizes
 *   - titleFilterInclude/Exclude ← P1.parameters
 *   - francetravailRomeCodes ← P1.parameters.romeCodes
 *
 * Les champs CLIENT-TRANSVERSAUX (antiPersonas, naf_codes, country_codes,
 * personaTitles, redFlags*, freshnessByTrigger, signalPrimary/Secondary,
 * etc.) sont conservés tels quels — ils relèvent du profil client global,
 * pas d'un signal du catalogue.
 */
export async function enrichIcpWithCatalog<T extends IcpLegacy>(
  clientId: string,
  icp: T,
): Promise<T> {
  const [p1Keywords, p1Regions, p1RomeCodes, p1TitleFilter, p3Industries, p3Sizes] =
    await Promise.all([
      getP1Keywords(clientId, icp),
      getP1Regions(clientId, icp),
      getP1RomeCodes(clientId, icp),
      getP1TitleFilter(clientId, icp),
      getP3Industries(clientId, icp),
      getP3Sizes(clientId, icp),
    ]);

  return {
    ...icp,
    keywordsHiring: p1Keywords.length > 0 ? p1Keywords : icp.keywordsHiring,
    regions: p1Regions.length > 0 ? p1Regions : icp.regions,
    francetravailRomeCodes: p1RomeCodes.length > 0 ? p1RomeCodes : icp.francetravailRomeCodes,
    titleFilterInclude: p1TitleFilter.include ?? icp.titleFilterInclude,
    titleFilterExclude: p1TitleFilter.exclude ?? icp.titleFilterExclude,
    industries: p3Industries.length > 0 ? p3Industries : icp.industries,
    sizes: p3Sizes.length > 0 ? p3Sizes : icp.sizes,
  };
}

/**
 * Retourne les signaux désactivés explicitement (utilisé par le digest /
 * audit / dashboard admin). Ne renvoie PAS les defaults (signaux non
 * configurés explicitement).
 */
export async function getDisabledSignalCodes(clientId: string): Promise<string[]> {
  const clientCache = await loadClientCache(clientId);
  const codes: string[] = [];
  for (const [code, cfg] of clientCache.entries()) {
    if (!cfg.enabled) codes.push(code);
  }
  return codes;
}

/**
 * Retourne les 3 piliers actifs du client (PILLAR avec isPillar=true et enabled=true).
 * Le wizard onboarding garantit isPillar=true sur 3 max.
 */
export async function getActivePillars(clientId: string): Promise<string[]> {
  const clientCache = await loadClientCache(clientId);
  const pillars: string[] = [];
  for (const [code, cfg] of clientCache.entries()) {
    if (cfg.isPillar && cfg.enabled) pillars.push(code);
  }
  return pillars;
}
