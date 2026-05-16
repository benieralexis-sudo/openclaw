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
