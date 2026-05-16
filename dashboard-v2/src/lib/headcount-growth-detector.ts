// Sprint catalogue (16/05/2026) — Détecteur P5 "Effectif +X% en 90j".
//
// Signal d'achat : croissance d'effectif rapide = expansion, structuration
// en cours, besoin d'outils. Corrélation conversion +38% (LeadGenius).
//
// Source : table CompanyHeadcountSnapshot historisée à chaque enrichissement
// Pappers (tranche_effectif) ou HarvestAPI Company (staffCount).
//
// Logique pure (testable trivialement, aucune I/O).

/**
 * Snapshot Pappers/HarvestAPI minimal pour le détecteur.
 */
export interface HeadcountSnapshot {
  effectifMin: number;
  effectifMax?: number | null;
  snapshotAt: Date;
  source: string;
}

/**
 * Résultat du calcul de croissance.
 */
export interface GrowthResult {
  hasGrowth: boolean;
  /** % de croissance basé sur effectifMin (conservateur). null si N/A. */
  growthPct: number | null;
  fromEffectifMin: number;
  toEffectifMin: number;
  fromSnapshotAt: Date;
  toSnapshotAt: Date;
  /** Nb de jours entre les 2 snapshots utilisés pour le calcul. */
  daysBetween: number;
  /** Raison si pas de growth détectée (debug). */
  reason?: string;
}

/**
 * Format Pappers `tranche_effectif` (INSEE) → [min, max] estimé.
 * Sentinel max=null pour la tranche "53"=10000+ (pas de borne supérieure).
 *
 * Exporté pour pouvoir snapshotter à partir d'une tranche brute Pappers
 * sans dupliquer la table de mapping.
 */
export const TRANCHE_TO_RANGE: Record<string, { min: number; max: number | null }> = {
  "00": { min: 0, max: 0 },
  "01": { min: 1, max: 2 },
  "02": { min: 3, max: 5 },
  "03": { min: 6, max: 9 },
  "11": { min: 10, max: 19 },
  "12": { min: 20, max: 49 },
  "21": { min: 50, max: 99 },
  "22": { min: 100, max: 199 },
  "31": { min: 200, max: 249 },
  "32": { min: 250, max: 499 },
  "41": { min: 500, max: 999 },
  "42": { min: 1000, max: 1999 },
  "51": { min: 2000, max: 4999 },
  "52": { min: 5000, max: 9999 },
  "53": { min: 10000, max: null },
};

/**
 * Calcule [effectifMin, effectifMax] depuis une tranche Pappers.
 * Retourne null si tranche inconnue.
 */
export function parseTrancheEffectif(
  tranche: string | null | undefined,
): { min: number; max: number | null } | null {
  if (!tranche) return null;
  const range = TRANCHE_TO_RANGE[tranche.trim()];
  return range ?? null;
}

/**
 * Détecte si une société a connu une croissance d'effectif >= thresholdPct
 * dans une fenêtre [now - windowDays, now].
 *
 * Stratégie :
 *   - On prend le snapshot le plus ancien dans la fenêtre comme baseline.
 *   - On prend le snapshot le plus récent comme état actuel.
 *   - Si effectifMin a augmenté, on calcule le % de croissance basé sur min.
 *     (Conservateur : on évite les faux positifs sur les tranches larges où
 *     min change beaucoup mais max ne change pas.)
 *
 * Cas spéciaux :
 *   - Moins de 2 snapshots dans la fenêtre → pas de growth calculable.
 *   - effectifMin baisse ou stagne → pas de growth.
 *   - effectifMin part de 0 → on évite la division /0 (pas de growth).
 *
 * @param snapshots Liste des snapshots de la société (n'importe quel ordre)
 * @param options.windowDays Fenêtre d'observation en jours (default 90)
 * @param options.thresholdPct Seuil min de croissance pour être positif (default 10)
 * @param options.now Horloge injectable pour tests
 */
export function detectHeadcountGrowth(
  snapshots: HeadcountSnapshot[] | null | undefined,
  options: { windowDays?: number; thresholdPct?: number; now?: Date } = {},
): GrowthResult {
  const windowDays = options.windowDays ?? 90;
  const thresholdPct = options.thresholdPct ?? 10;
  const now = options.now ?? new Date();

  const empty: GrowthResult = {
    hasGrowth: false,
    growthPct: null,
    fromEffectifMin: 0,
    toEffectifMin: 0,
    fromSnapshotAt: now,
    toSnapshotAt: now,
    daysBetween: 0,
  };

  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { ...empty, reason: "less-than-2-snapshots" };
  }

  // Filtre : garder seulement les snapshots dans la fenêtre
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  const inWindow = snapshots.filter((s) => {
    if (!s || !s.snapshotAt) return false;
    return s.snapshotAt >= cutoff && s.snapshotAt <= now;
  });
  if (inWindow.length < 2) {
    return { ...empty, reason: "less-than-2-in-window" };
  }

  // Tri chronologique
  const sorted = [...inWindow].sort(
    (a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime(),
  );
  const baseline = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;

  const fromMin = baseline.effectifMin;
  const toMin = latest.effectifMin;
  const daysBetween = Math.floor(
    (latest.snapshotAt.getTime() - baseline.snapshotAt.getTime()) / 86_400_000,
  );

  if (fromMin <= 0) {
    return {
      ...empty,
      fromEffectifMin: fromMin,
      toEffectifMin: toMin,
      fromSnapshotAt: baseline.snapshotAt,
      toSnapshotAt: latest.snapshotAt,
      daysBetween,
      reason: "baseline-zero",
    };
  }

  if (toMin <= fromMin) {
    return {
      ...empty,
      fromEffectifMin: fromMin,
      toEffectifMin: toMin,
      fromSnapshotAt: baseline.snapshotAt,
      toSnapshotAt: latest.snapshotAt,
      daysBetween,
      reason: "no-increase",
    };
  }

  const growthPct = ((toMin - fromMin) / fromMin) * 100;
  const hasGrowth = growthPct >= thresholdPct;

  return {
    hasGrowth,
    growthPct: Math.round(growthPct * 10) / 10, // 1 décimale
    fromEffectifMin: fromMin,
    toEffectifMin: toMin,
    fromSnapshotAt: baseline.snapshotAt,
    toSnapshotAt: latest.snapshotAt,
    daysBetween,
    reason: hasGrowth ? undefined : "below-threshold",
  };
}
