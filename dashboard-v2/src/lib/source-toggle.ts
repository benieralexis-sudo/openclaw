// Sprint catalogue (16/05/2026) — Kill-switch par signal pour chaque client.
//
// Préfigure le catalogue universel paramétrable : chaque client peut
// désactiver un signal du catalogue via icp.disabledSources sans toucher
// au code. Pattern config-driven multi-tenant.
//
// Utilisé par les pollers (theirstack-poller, apify-poller, etc.) et le
// dispatcher (run-pollers/route.ts) pour skip une source avant tout appel
// payant.
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
