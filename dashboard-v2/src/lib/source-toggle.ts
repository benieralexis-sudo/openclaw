// Sprint catalogue (16/05/2026) — Kill-switch par signal pour chaque client.
//
// @deprecated Remplacé par src/lib/signal-config.ts (isSignalEnabled).
// Conservé pendant la transition (legacy defense-in-depth) tant que tous
// les pollers ne sont pas wired sur le helper catalogue. À supprimer
// avec icp.disabledSources quand la migration est complète.
//
// Logique pure, testable trivialement (aucune I/O).

export interface IcpWithDisabledSources {
  disabledSources?: string[];
}

/**
 * Retourne true si le `sourceCode` (ex: "theirstack.buying-intent") fait
 * partie de la liste icp.disabledSources du client.
 *
 * - ICP null/undefined → false (source active par défaut, retro-compat)
 * - disabledSources absent → false
 * - sourceCode dans la liste → true
 *
 * Convention sourceCode : "<provider>.<signal>" (cf. Trigger.sourceCode).
 * Match exact, pas de regex.
 */
export function isSourceDisabled(
  icp: IcpWithDisabledSources | null | undefined,
  sourceCode: string,
): boolean {
  if (!icp?.disabledSources) return false;
  return icp.disabledSources.includes(sourceCode);
}
