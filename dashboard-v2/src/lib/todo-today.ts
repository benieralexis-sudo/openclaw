/**
 * Helpers Widget "Ma todo du jour" — chantier D3 (01/05/2026)
 * ────────────────────────────────────────────────────────────
 * Combine priorityScore (v3.9) et fitScore (v4.2) en un score composite
 * pour ordonner la todo commerciale du jour.
 *
 * Formule défendue : `priority + fit*0.3` (priority dominante car elle
 * intègre la fraîcheur temporelle = signal commercial réel ; fit pondéré
 * 0.3 pour départager 2 leads à priorité comparable).
 *
 * Module 100% PUR : zéro dépendance React/DB. Testable unitairement.
 */

export interface TodoItem {
  id: string;
  companyName: string;
  companySiret: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  title: string;
  score: number;
  priorityScore: number | null;
  freshnessScore: number | null;
  multiSourceBoost: number | null;
  fitScore: number | null;
  capturedAt: string;
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedin: boolean;
}

/**
 * Score composite pour tri todo commerciale.
 *
 * Justification de la pondération 0.3 sur fit :
 *  - priority est borné 0-130 (typique 0-50)
 *  - fit est borné 0-100
 *  - Sans pondération, fit dominerait à tort (un lead "fit 100 mais priority 5"
 *    n'est pas actionnable maintenant)
 *  - Avec 0.3, fit max (30) peut départager 2 leads à priority similaire mais
 *    ne renverse jamais l'ordre principal de priority
 *
 * priority null OU 0 → composite = 0 (pas actionnable, fit seul ne suffit pas)
 */
export function combineScores(
  priority: number | null,
  fit: number | null,
): number {
  if (priority === null || priority === undefined || priority === 0) {
    // Si pas de priority (lead non recomputé) ou 0, le fit seul ne justifie
    // pas une place dans la todo. On retourne 0 pour le placer en bas.
    return 0;
  }
  const fitContribution = fit !== null && fit !== undefined ? fit * 0.3 : 0;
  return Math.round(priority + fitContribution);
}

/**
 * Dédupe les items par société (siret prioritaire, fallback companyName).
 * Garde le 1er item de chaque société (assume input pré-trié par caller).
 * Case-insensitive. Skip les companyName vides.
 */
export function dedupTodoByCompany<T extends Pick<TodoItem, "companyName" | "companySiret">>(
  items: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = (item.companySiret ?? item.companyName ?? "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
