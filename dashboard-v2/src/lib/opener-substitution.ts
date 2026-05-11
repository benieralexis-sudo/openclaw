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

/**
 * Fix B1 (11/05/2026) — Détection désynchronisation opener ↔ Lead persona.
 *
 * L'opener de briefV2 commence typiquement par `Bonjour <Prénom>,`. Quand
 * le Lead change de persona post-qualify (HarvestAPI trouve un autre
 * décideur, jobtitle-upgrade, headline-upgrade), le brief n'est pas
 * régénéré et continue de citer l'ancien prénom.
 *
 * Cas observés en prod (11/05) :
 *   - DiXiO : opener "Bonjour Thierry," mais Lead.fullName = "Adrien SICOLI"
 *   - DimoMaint : opener "Bonjour Jean-Luc," mais "Thomas Lazare Bourgeois"
 *   - Training Orchestra : opener "Bonjour Laetitia," mais "Humery Valerie"
 *
 * Si Fred copie-colle l'opener dans son email, il commence par un mauvais
 * prénom → conversation cassée d'entrée de jeu.
 *
 * Stratégie : extraire le prénom du début de l'opener via regex, comparer
 * (case-insensitive, ignore accents/tirets) à TOUS les prénoms possibles
 * du Lead (firstName, fullName parts). Si aucun match → désynchro.
 *
 * Cas spéciaux qui ne sont PAS des désynchros (return false) :
 *   - Opener commence par "(Hors ICP" ou "(Verdict ENRICH" → pas d'opener.
 *   - Opener commence par "Bonjour," (sans prénom — fix B3 nouveau prompt).
 *   - Opener commence par "Bonjour (prénom à vérifier)," — fix B3 fallback.
 *   - Pas de prénom détectable dans l'opener.
 */
export interface DesyncResult {
  isDesync: boolean;
  /** Prénom détecté dans l'opener (si présent) */
  briefName: string | null;
  /** Prénoms candidats côté Lead pour comparaison */
  leadCandidates: string[];
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-'\s]/g, "");
}

export function detectOpenerPersonaDesync(
  opener: string | null | undefined,
  lead: { firstName?: string | null; lastName?: string | null; fullName?: string | null } | null | undefined,
): DesyncResult {
  const empty: DesyncResult = { isDesync: false, briefName: null, leadCandidates: [] };
  if (!opener || !lead) return empty;

  // Cas spéciaux non-désynchros (ENRICH/NON openers + fallback B3)
  if (/^\s*\(/i.test(opener)) return empty;
  if (/^\s*Bonjour\s*,/i.test(opener)) return empty;
  if (/^\s*Bonjour\s+\(prénom\s+à\s+vérifier\)/i.test(opener)) return empty;

  // Extraire le prénom de l'opener : "Bonjour Marc," / "Bonjour Jean-Luc," / "Bonjour Marie Claire,"
  // On accepte 1 mot avec tirets, ou 2 mots (prénoms composés).
  const re = /^\s*Bonjour\s+([A-ZÀ-Ý][\wÀ-ÿ\-']{1,30}(?:\s+[A-ZÀ-Ý][\wÀ-ÿ\-']{1,30})?)\s*,/u;
  const m = opener.match(re);
  if (!m || !m[1]) return empty;

  const briefName = m[1].trim();

  // Construire la liste des candidats côté Lead
  const candidates = new Set<string>();
  if (lead.firstName?.trim()) candidates.add(lead.firstName.trim());
  if (lead.lastName?.trim()) candidates.add(lead.lastName.trim());
  if (lead.fullName?.trim()) {
    for (const part of lead.fullName.trim().split(/\s+/)) {
      if (part.length >= 2) candidates.add(part);
    }
  }
  const leadCandidates = Array.from(candidates);
  if (leadCandidates.length === 0) {
    return { isDesync: false, briefName, leadCandidates: [] };
  }

  // Match fuzzy : briefName vs chaque candidat Lead (normalisé)
  const briefNorm = normalizeName(briefName);
  for (const c of leadCandidates) {
    const cNorm = normalizeName(c);
    if (cNorm === briefNorm) {
      return { isDesync: false, briefName, leadCandidates };
    }
    // Match partiel pour prénoms composés : "Jean-Luc" matche "Jean" ou "Luc"
    if (briefNorm.includes(cNorm) || cNorm.includes(briefNorm)) {
      if (cNorm.length >= 3 && briefNorm.length >= 3) {
        return { isDesync: false, briefName, leadCandidates };
      }
    }
  }

  return { isDesync: true, briefName, leadCandidates };
}
