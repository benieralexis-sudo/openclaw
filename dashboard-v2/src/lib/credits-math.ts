// Sprint Saint Graal (10/05/2026) — Logique pure credits (sans DB ni server-only).
// Extrait de credits.ts pour permettre les tests Vitest.

// Cap du rollover : on permet d'accumuler max 4× le quota mensuel pour eviter
// qu'un client n'utilise jamais et accumule a l'infini (risque cost burst).
// Avec Growth=60 → cap a 240 credits = ~4 mois de stock max.
export const ROLLOVER_CAP_MULTIPLIER = 4;

/**
 * Logique pure (sans DB) du calcul reset mensuel. Testable unitairement.
 */
export function computeMonthlyResetParams(client: {
  creditsBalance: number;
  creditsMonthlyQuota: number;
  pepitesThisMonth: number;
  pepitesGuaranteed: number;
}): {
  guaranteeTriggered: boolean;
  quotaCredited: number;
  cappedBalance: number;
  cappedAmount: number;
  netCreditedAmount: number;
} {
  const guaranteeTriggered = client.pepitesThisMonth < client.pepitesGuaranteed;
  const quotaCredited = guaranteeTriggered
    ? client.creditsMonthlyQuota * 2
    : client.creditsMonthlyQuota;
  const rolloverCap = client.creditsMonthlyQuota * ROLLOVER_CAP_MULTIPLIER;
  const naiveNewBalance = client.creditsBalance + quotaCredited;
  const cappedBalance = Math.min(naiveNewBalance, rolloverCap);
  const cappedAmount = naiveNewBalance - cappedBalance;
  const netCreditedAmount = quotaCredited - cappedAmount;
  return {
    guaranteeTriggered,
    quotaCredited,
    cappedBalance,
    cappedAmount,
    netCreditedAmount,
  };
}
