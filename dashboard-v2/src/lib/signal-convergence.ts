import "server-only";
import { db } from "@/lib/db";
import { getSourceCodesForSignal } from "@/lib/signal-mapping";

/**
 * Stratégie V1 (17/05/2026) — Mécaniques de convergence entre signaux.
 *
 * Deux notions distinctes :
 *
 * 1. **Combo entre piliers** (cross-pillar convergence) :
 *    Quand 2 signaux DIFFÉRENTS du client trouvent la même boîte = Pépite.
 *    Quand 3+ signaux différents convergent = Diamant.
 *    C'est l'argument commercial fort ("votre boîte est qualifiée sous
 *    plusieurs angles indépendants").
 *
 * 2. **Multi-source intra-signal** (confidence boost) :
 *    Quand le MÊME signal est détecté par plusieurs sources techniques
 *    indépendantes (ex S6 Levée détecté par Rodz + RSS + BODACC) = +50%
 *    confiance. Réduit les faux positifs : si Rodz se trompe, BODACC
 *    corrige. C'est de la qualité de détection, pas du combo commercial.
 */

// V1 18/05/2026 — Fenêtre élargie 14j → 30j après audit.
// Constat : avec 14j, 0 combo cross-pillar détecté sur iFIND (179 boîtes
// distinctes sur 183 triggers) ni DTL (166/170). Les sources frappent des
// boîtes presque disjointes (LinkedIn jobs ≠ RSS levées). Pour augmenter
// les chances qu'une boîte voie 2+ signaux converger, on étend la mémoire à
// 30j (correspond au cycle billing iFIND Growth de toute façon).
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Pour une boîte (clé = SIRET ou companyName), retourne la liste des signaux
 * pilier du client qui ont produit un Trigger dans la fenêtre.
 *
 * Combo Pépite : 2+ piliers distincts.
 * Combo Diamant : 3+ piliers distincts.
 */
export async function getCrossPillarConvergence(
  clientId: string,
  options: {
    activePillars: string[];
    siret?: string | null;
    companyName?: string;
    windowDays?: number;
  },
): Promise<{
  pillarsConverged: string[];
  isPepite: boolean;
  isDiamant: boolean;
}> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  // Identifie la boîte : SIRET en priorité, sinon companyName (case-insensitive)
  const whereCompany = options.siret
    ? { companySiret: options.siret }
    : options.companyName
    ? { companyName: { equals: options.companyName, mode: "insensitive" as const } }
    : null;

  if (!whereCompany) {
    return { pillarsConverged: [], isPepite: false, isDiamant: false };
  }

  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      capturedAt: { gte: since },
      signalCode: { in: options.activePillars },
      ...whereCompany,
    },
    select: { signalCode: true },
  });

  const pillarsConverged = [...new Set(triggers.map((t) => t.signalCode).filter(Boolean) as string[])];

  return {
    pillarsConverged,
    isPepite: pillarsConverged.length >= 2,
    isDiamant: pillarsConverged.length >= 3,
  };
}

/**
 * Pour un trigger donné, retourne le boost de confiance lié au nombre de
 * sources techniques INDÉPENDANTES qui ont confirmé le même signal sur la
 * même boîte dans la fenêtre.
 *
 *  - 1 source seule → 0 (pas de boost)
 *  - 2 sources distinctes → +25
 *  - 3+ sources distinctes → +50 (cap)
 *
 * Note : différent de multiSourceBoost actuel (qui compte n'importe quelles
 * sources, même de signaux différents). Ici on compte SEULEMENT les sources
 * qui mappent au même signalCode.
 */
export async function getIntraSignalConfidenceBoost(
  clientId: string,
  options: {
    signalCode: string;
    siret?: string | null;
    companyName?: string;
    windowDays?: number;
  },
): Promise<number> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const validSources = getSourceCodesForSignal(options.signalCode);
  if (validSources.length === 0) return 0;

  const whereCompany = options.siret
    ? { companySiret: options.siret }
    : options.companyName
    ? { companyName: { equals: options.companyName, mode: "insensitive" as const } }
    : null;

  if (!whereCompany) return 0;

  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      capturedAt: { gte: since },
      sourceCode: { in: validSources },
      ...whereCompany,
    },
    select: { sourceCode: true },
  });

  const distinctSources = new Set(triggers.map((t) => t.sourceCode));
  if (distinctSources.size <= 1) return 0;
  if (distinctSources.size === 2) return 25;
  return 50;
}

// ────────────────────────────────────────────────────────────────────────
// V1 18/05/2026 — Batch helpers (fix N+1 query priority-scoring-runner)
// ────────────────────────────────────────────────────────────────────────
//
// Avant : pour chaque Trigger d'un client (jusqu'à ~300/client), le runner
// appelait getCrossPillarConvergence + getIntraSignalConfidenceBoost = 2
// queries DB par trigger = ~600 queries DB/client/cycle, ~24× cycles/jour =
// ~14k queries DB/jour évitables.
//
// Maintenant : 2 queries DB par client (1 pour la convergence, 1 pour la
// confidence) puis tout calcul fait en mémoire via maps. O(1) par trigger.
// ────────────────────────────────────────────────────────────────────────

export interface ClientConvergenceIndex {
  /** map companyKey (siret OR lower companyName) → ensemble des signalCode présents */
  byCompanyPillars: Map<string, Set<string>>;
  /** map (companyKey, signalCode) → ensemble des sourceCode distincts */
  byCompanySignalSources: Map<string, Map<string, Set<string>>>;
}

/**
 * Construit l'index complet de convergence pour un client en 1 seule query.
 * À appeler une fois en début de cycle de scoring, puis lookup O(1) par
 * trigger via lookupCrossPillarFromIndex + lookupConfidenceBoostFromIndex.
 */
export async function buildClientConvergenceIndex(
  clientId: string,
  activePillars: string[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ClientConvergenceIndex> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  // 1 seule query : tous les triggers du client sur la fenêtre, avec leur
  // signalCode (pour combo) et leur sourceCode (pour confidence boost).
  const rows = await db.trigger.findMany({
    where: { clientId, deletedAt: null, capturedAt: { gte: since } },
    select: {
      companySiret: true,
      companyName: true,
      signalCode: true,
      sourceCode: true,
    },
  });

  const byCompanyPillars = new Map<string, Set<string>>();
  const byCompanySignalSources = new Map<string, Map<string, Set<string>>>();
  const pillarSet = new Set(activePillars);

  for (const t of rows) {
    const key = ((t.companySiret || t.companyName) ?? "").trim().toLowerCase();
    if (!key) continue;

    // Combo cross-pillar : on garde seulement les signaux qui sont piliers du client
    if (t.signalCode && pillarSet.has(t.signalCode)) {
      let set = byCompanyPillars.get(key);
      if (!set) {
        set = new Set();
        byCompanyPillars.set(key, set);
      }
      set.add(t.signalCode);
    }

    // Confidence boost intra-signal : tous les triggers ayant un signalCode
    if (t.signalCode) {
      let inner = byCompanySignalSources.get(key);
      if (!inner) {
        inner = new Map();
        byCompanySignalSources.set(key, inner);
      }
      let srcSet = inner.get(t.signalCode);
      if (!srcSet) {
        srcSet = new Set();
        inner.set(t.signalCode, srcSet);
      }
      srcSet.add(t.sourceCode);
    }
  }

  return { byCompanyPillars, byCompanySignalSources };
}

/** Lookup O(1) du résultat combo cross-pillar pour un trigger. */
export function lookupCrossPillarFromIndex(
  index: ClientConvergenceIndex,
  siret: string | null,
  companyName: string | null,
): { pillarsConverged: string[]; isPepite: boolean; isDiamant: boolean } {
  const key = ((siret || companyName) ?? "").trim().toLowerCase();
  if (!key) return { pillarsConverged: [], isPepite: false, isDiamant: false };
  const set = index.byCompanyPillars.get(key);
  if (!set || set.size === 0) return { pillarsConverged: [], isPepite: false, isDiamant: false };
  const pillarsConverged = [...set];
  return {
    pillarsConverged,
    isPepite: pillarsConverged.length >= 2,
    isDiamant: pillarsConverged.length >= 3,
  };
}

/** Lookup O(1) du confidence boost intra-signal pour un trigger. */
export function lookupConfidenceBoostFromIndex(
  index: ClientConvergenceIndex,
  signalCode: string | null,
  siret: string | null,
  companyName: string | null,
): number {
  if (!signalCode) return 0;
  const key = ((siret || companyName) ?? "").trim().toLowerCase();
  if (!key) return 0;
  const inner = index.byCompanySignalSources.get(key);
  if (!inner) return 0;
  const srcSet = inner.get(signalCode);
  if (!srcSet || srcSet.size <= 1) return 0;
  if (srcSet.size === 2) return 25;
  return 50;
}
