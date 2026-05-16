// Sprint catalogue (16/05/2026) — Détecteur P2 "Team sans rôle X".
//
// Signal d'achat "douleur cachée" : une boite >X employés mais 0 personne
// avec un titre cible (ex: 50 devs sans QA Engineer) = douleur structurelle
// non encore comblée. Souvent meilleur que P1 (Hire) car la boite n'a même
// pas commencé à recruter pour ce rôle.
//
// Corrélation conversion +30% (estimation conservatrice, source LeadGenius
// "hire seul" +7% × 4 pour signal douleur structurelle).
//
// Logique pure (testable trivialement, aucune I/O).

/**
 * Profil employé minimal pour le détecteur (sous-ensemble HarvestProfile).
 */
export interface EmployeeProfile {
  /** Titre du poste actuel (currentHeadline ou jobTitle). Nullable. */
  title?: string | null;
  /** Nom complet (debug/log). */
  name?: string | null;
}

/**
 * Résultat de l'analyse team-gap.
 */
export interface TeamGapResult {
  /** True si gap confirmé (assez d'employés ET 0 matchant les missingRoles). */
  hasGap: boolean;
  /** Total employees scannés (depuis HarvestAPI ou autre source). */
  totalEmployees: number;
  /** Nb d'employés matchant l'un des missingRoles patterns. */
  matchingCount: number;
  /** Liste des roles cherchés (échec du match). */
  missingRoles: string[];
  /** Si match, exemples des profils trouvés (pour debug). */
  matchedExamples: string[];
  /** Raison si pas de gap (debug). */
  reason?: string;
}

/**
 * Détecte si une équipe a un "gap" sur des rôles cibles.
 *
 * Conditions pour `hasGap = true` :
 *   - totalEmployees >= minTeamSize (sinon la boite est trop petite pour
 *     que l'absence soit significative)
 *   - matchingCount === 0 (vraiment 0 personne avec le titre cible)
 *
 * Si matchingCount > 0, on retourne le détail mais hasGap=false (le rôle
 * est présent = pas de gap, peut-être à recruter pour scale mais pas P2).
 *
 * @param employees liste des employés (depuis HarvestAPI people-search)
 * @param missingRoles array de keywords titres à chercher (case-insensitive
 *        match \bWORD\b). Ex: ["QA Engineer", "Test Engineer", "SDET"]
 * @param options.minTeamSize seuil min de total employees (default 10)
 */
export function analyzeTeamGap(
  employees: EmployeeProfile[] | null | undefined,
  missingRoles: string[] | null | undefined,
  options: { minTeamSize?: number } = {},
): TeamGapResult {
  const minTeamSize = options.minTeamSize ?? 10;
  const roles = (missingRoles ?? []).filter(
    (r) => typeof r === "string" && r.trim().length >= 2,
  );

  const empty: TeamGapResult = {
    hasGap: false,
    totalEmployees: 0,
    matchingCount: 0,
    missingRoles: roles,
    matchedExamples: [],
  };

  if (roles.length === 0) {
    return { ...empty, reason: "no-missing-roles-configured" };
  }

  if (!Array.isArray(employees)) {
    return { ...empty, reason: "no-employees-array" };
  }

  const totalEmployees = employees.length;

  if (totalEmployees < minTeamSize) {
    return {
      ...empty,
      totalEmployees,
      reason: `team-too-small (${totalEmployees} < ${minTeamSize})`,
    };
  }

  // Build regex set : \b(role1|role2)\b case-insensitive
  // Échapper les regex specials dans les roles
  const escaped = roles.map((r) =>
    r.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const combinedRegex = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");

  const matched: string[] = [];
  for (const emp of employees) {
    if (!emp || !emp.title) continue;
    if (combinedRegex.test(emp.title)) {
      matched.push(`${emp.name ?? "?"} (${emp.title})`);
    }
  }

  const matchingCount = matched.length;

  if (matchingCount > 0) {
    // Rôle présent → pas de gap
    return {
      hasGap: false,
      totalEmployees,
      matchingCount,
      missingRoles: roles,
      matchedExamples: matched.slice(0, 5),
      reason: "role-present",
    };
  }

  // Gap confirmé : assez de monde ET 0 personne sur le rôle cible
  return {
    hasGap: true,
    totalEmployees,
    matchingCount: 0,
    missingRoles: roles,
    matchedExamples: [],
  };
}
