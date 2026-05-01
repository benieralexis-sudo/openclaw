/**
 * Humanizers chiffres société — chantier D9 (01/05/2026)
 * ──────────────────────────────────────────────────────
 * Traduit les données Pappers brutes en labels lisibles par un commercial
 * non-tech : pas de "63 000 000" mais "63 M€ — solide".
 *
 * Module 100% PUR : zéro dépendance React/DB.
 */

// ──────────────────────────────────────────────────────────────────────
// Taille société (etabsCount + fallback sizeText, comparé à l'ICP)
// ──────────────────────────────────────────────────────────────────────

export interface CompanySizeArgs {
  etabsCount: number | null;
  sizeText: string | null;
  icpMin: number | undefined;
  icpMax: number | undefined;
}

function parseSizeText(text: string | null): number | null {
  if (!text) return null;
  const plus = text.match(/(\d+)\s*\+/);
  if (plus) return parseInt(plus[1]!, 10);
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return parseInt(range[2]!, 10);
  const num = text.match(/^\s*(\d+)\s*$/);
  if (num) return parseInt(num[1]!, 10);
  return null;
}

export function humanizeCompanySize(args: CompanySizeArgs): string {
  const size = args.etabsCount ?? parseSizeText(args.sizeText);
  if (size === null) return "—";
  const min = args.icpMin;
  const max = args.icpMax;

  if (max !== undefined && size > max * 3) {
    return `Grand groupe (~${size}p) — hors cible ${min ?? "?"}-${max}p`;
  }
  if (max !== undefined && size > max) {
    return `Grosse société (~${size}p) — au-dessus de la cible ${min ?? "?"}-${max}p`;
  }
  if (min !== undefined && size < min) {
    return `Trop petite (~${size}p) — en dessous de la cible ${min}-${max ?? "?"}p`;
  }
  return `Société ~${size}p — dans la cible ${min ?? "?"}-${max ?? "?"}p`;
}

// ──────────────────────────────────────────────────────────────────────
// Revenue (CA en €)
// ──────────────────────────────────────────────────────────────────────

function formatMillions(amount: number): string {
  const m = amount / 1_000_000;
  if (m >= 100) return `${Math.round(m)} M€`;
  if (m >= 10) return `${m.toFixed(0)} M€`;
  if (m >= 1) return `${m.toFixed(1)} M€`;
  return `${Math.round(amount / 1000)} k€`;
}

export function humanizeRevenue(amount: number | null): string {
  if (amount === null || amount === undefined || amount === 0) return "—";
  const formatted = formatMillions(amount);
  if (amount >= 100_000_000) return `${formatted} — grand groupe établi`;
  if (amount >= 30_000_000) return `${formatted} — solide financièrement`;
  if (amount >= 5_000_000) return `${formatted} — scale-up en croissance`;
  if (amount >= 1_000_000) return `${formatted} — petit acteur établi`;
  return `${formatted} — early stage / < 1 M€`;
}

// ──────────────────────────────────────────────────────────────────────
// Résultat net
// ──────────────────────────────────────────────────────────────────────

export function humanizeResultNet(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  const sign = amount >= 0 ? "+" : "-";
  const formatted = formatMillions(Math.abs(amount));
  if (amount > 0) return `${sign}${formatted} — rentable`;
  if (amount < 0) return `${sign}${formatted} — déficit / perte`;
  return `${formatted}`;
}

// ──────────────────────────────────────────────────────────────────────
// Nombre d'établissements actifs
// ──────────────────────────────────────────────────────────────────────

export function humanizeEtabsCount(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n === 1) return "Mono-site (1 établissement)";
  if (n <= 5) return `${n} établissements`;
  return `Multi-sites (${n} établissements actifs)`;
}
