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
