/**
 * Fix B3 (11/05/2026) — Substitution défensive des placeholders dans l'opener.
 *
 * Opus 4.7 invente parfois `[Prénom]` (ou `[Nom]`) dans l'opener quand le
 * dossier reçu au moment du qualify avait `Décideur identifié : non résolu`
 * (i.e. Lead pas encore enrichi avec fullName/firstName). Le brief stocké
 * en DB contient alors le placeholder brut. Cas observé en prod : ViaXoft
 * Eric Barthélémy le 11/05.
 *
 * Stratégie défensive (safety net, en complément de la règle prompt) :
 *   - Si Lead.firstName disponible → on substitue par le vrai prénom.
 *   - Sinon → on remplace par "(prénom à vérifier)" pour signaler
 *     clairement au commercial qu'il doit compléter avant envoi.
 *
 * Important : la fonction doit être appliquée PARTOUT où l'opener est
 * affiché ou exporté vers Fred : composant UI, email digest, alerte
 * temps réel, digest hebdo. Sinon le placeholder ressort par une autre
 * voie et Fred peut le copier-coller dans un email.
 */
export function substituteOpenerPlaceholders(
  opener: string | null | undefined,
  firstName: string | null | undefined,
): string {
  if (!opener) return "";
  if (!opener.includes("[Prénom]") && !opener.includes("[Nom]")) {
    return opener;
  }
  const fallback = "(prénom à vérifier)";
  const trimmedFirstName = firstName?.trim();
  const replacement = trimmedFirstName && trimmedFirstName.length >= 2
    ? trimmedFirstName
    : fallback;
  return opener
    .replace(/\[Prénom\]/g, replacement)
    .replace(/\[Nom\]/g, replacement);
}

/**
 * Helper : extrait le firstName depuis un Lead-like object qui peut avoir
 * soit `firstName` direct, soit seulement `fullName` ("Eric Barthélémy" → "Eric").
 */
export function deriveFirstName(
  lead: { firstName?: string | null; fullName?: string | null } | null | undefined,
): string | null {
  if (!lead) return null;
  if (lead.firstName?.trim()) return lead.firstName.trim();
  const firstWord = lead.fullName?.trim().split(/\s+/)[0];
  return firstWord && firstWord.length >= 2 ? firstWord : null;
}
