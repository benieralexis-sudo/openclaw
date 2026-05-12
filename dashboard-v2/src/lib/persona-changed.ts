/**
 * Fix B1 racine (12/05/2026) — Détection persona change (pure function).
 *
 * Extrait de clear-stale-briefs.ts pour être testable sans dépendance
 * `server-only`. Importable depuis composants client et server.
 *
 * Compare deux noms en ignorant la casse, les accents, les espaces et tirets.
 * Retourne true SI :
 *   - Les deux noms sont non-vides
 *   - ET ils sont *significativement* différents (la persona a changé,
 *     pas juste une variation casse/accent/séparateur).
 *
 * Retourne false SI :
 *   - Le nouveau nom est vide (rien à comparer)
 *   - L'ancien nom est vide (first-time set, pas un "change")
 *   - Les normalisations sont identiques (typo cleanup, pas une vraie persona)
 */
export function isPersonaChanged(
  oldFullName: string | null | undefined,
  newFullName: string | null | undefined,
): boolean {
  if (!newFullName?.trim()) return false;
  if (!oldFullName?.trim()) return false;
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[-'\s]/g, "");
  return norm(oldFullName) !== norm(newFullName);
}
