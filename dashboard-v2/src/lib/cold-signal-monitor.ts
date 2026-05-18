import "server-only";
import { db } from "@/lib/db";
import { getActivePillars } from "@/lib/signal-config";
import { SIGNAL_NAMES } from "@/lib/signal-mapping";

/**
 * V1 17/05/2026 — Santé des 3 piliers actifs d'un client.
 *
 * Système à 2 niveaux (validé Alexis 17/05 ~minuit) :
 *   - OK     : dernier lead pilier < 3j (signal vivant)
 *   - TEPID  : 3-6j sans lead (warning visible dashboard)
 *   - COLD   : 7j+ sans lead (alerte rouge visible dashboard)
 *
 * Pas de notification externe (Telegram, email). Tout est affiché sur le
 * dashboard pour ne pas spammer l'utilisateur.
 *
 * Use case : alerter le client (et l'admin) quand l'un de ses 3 signaux ne
 * remonte rien. Possible causes :
 *   - Source technique cassée (Apify timeout, TheirStack quota...)
 *   - Mauvais paramétrage (keywords trop restrictifs)
 *   - Signal naturellement rare pour son ICP
 *
 * Action attendue : workshop avec le client pour soit ajuster les keywords,
 * soit pivoter sur un autre pilier.
 */

export type PillarHealthStatus = "ok" | "tepid" | "cold" | "warming-up";

export const PILLAR_HEALTH_THRESHOLDS = {
  tepidDays: 3, // 3-6j sans lead = warning orange
  coldDays: 7, // 7j+ sans lead = alerte rouge
} as const;

/**
 * V1 18/05 — Signaux "naturellement lents" : leur détection demande
 * d'accumuler de la donnée historique avant de produire leur premier lead.
 *
 * Pour ces signaux, le statut "Froid" est trompeur les premiers 30-90 jours
 * — c'est normal qu'il n'y ait pas de lead, pas un dysfonctionnement.
 * On surface un statut spécifique "warming-up" qui ne déclenche pas d'alerte.
 *
 * P5 (Croissance effectif) : nécessite 2 snapshots Pappers avec ≥10% de
 *   croissance sur 90j → premier lead possible ~30j après onboarding,
 *   stable à partir de J+90.
 */
const NATURALLY_SLOW_SIGNALS: Record<string, { warmingUpDays: number; reason: string }> = {
  P5: {
    warmingUpDays: 30,
    reason: "Signal lent — compare l'effectif entre 2 snapshots espacés de 30-90j",
  },
};

/**
 * Âge en jours de la configuration du pilier (depuis l'activation client OU
 * depuis la création de la config signal). Utilisé pour savoir si on est
 * encore dans la fenêtre "warming-up" pour les signaux lents.
 */
function isWithinWarmingUp(code: string, clientAgeDays: number): boolean {
  const slow = NATURALLY_SLOW_SIGNALS[code];
  if (!slow) return false;
  return clientAgeDays < slow.warmingUpDays;
}

export interface PillarHealth {
  code: string;
  name: string;
  status: PillarHealthStatus;
  daysSinceLastTrigger: number | null; // null = jamais aucun trigger
  leadCountWindow: number; // nb leads sur les 30j (volume info)
  warmingUpReason?: string; // texte explicatif si status = "warming-up"
}

export interface PillarHealthReport {
  clientId: string;
  pillars: PillarHealth[];
  hasIssue: boolean; // true si au moins un pilier tepid ou cold
}

function classifyStatus(daysSince: number | null): PillarHealthStatus {
  if (daysSince === null) return "cold"; // jamais aucun trigger = cold direct
  if (daysSince >= PILLAR_HEALTH_THRESHOLDS.coldDays) return "cold";
  if (daysSince >= PILLAR_HEALTH_THRESHOLDS.tepidDays) return "tepid";
  return "ok";
}

/**
 * Retourne la santé des 3 piliers du client. Pour chaque pilier :
 *   - le statut (ok / tepid / cold)
 *   - le nombre de jours depuis le dernier trigger
 *   - le volume mesuré sur 30j (info)
 */
export async function getPillarHealth(clientId: string): Promise<PillarHealthReport> {
  const activePillars = await getActivePillars(clientId);
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  // V1 18/05 — Calcule l'âge du client (depuis activatedAt, sinon createdAt).
  // Sert à savoir si on est encore dans la fenêtre "warming-up" des signaux
  // naturellement lents comme P5 (Croissance effectif).
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { activatedAt: true, createdAt: true },
  });
  const refDate = client?.activatedAt ?? client?.createdAt ?? new Date();
  const clientAgeDays = Math.floor((Date.now() - refDate.getTime()) / 86_400_000);

  const pillars: PillarHealth[] = [];
  for (const code of activePillars) {
    const latest = await db.trigger.findFirst({
      where: { clientId, deletedAt: null, signalCode: code },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    });
    const days = latest
      ? Math.floor((Date.now() - latest.capturedAt.getTime()) / 86_400_000)
      : null;
    const leadCount30d = await db.trigger.count({
      where: {
        clientId,
        deletedAt: null,
        signalCode: code,
        capturedAt: { gte: since30d },
      },
    });

    // V1 18/05 — Si le signal est naturellement lent ET qu'on est dans la
    // fenêtre warming-up depuis l'activation client : statut spécial.
    // Le statut "cold" reste utilisé seulement quand le client a eu le temps
    // d'accumuler la donnée historique nécessaire.
    let status = classifyStatus(days);
    let warmingUpReason: string | undefined;
    if (status === "cold" && isWithinWarmingUp(code, clientAgeDays)) {
      status = "warming-up";
      warmingUpReason = NATURALLY_SLOW_SIGNALS[code]?.reason;
    }

    pillars.push({
      code,
      name: SIGNAL_NAMES[code] ?? code,
      status,
      daysSinceLastTrigger: days,
      leadCountWindow: leadCount30d,
      ...(warmingUpReason ? { warmingUpReason } : {}),
    });
  }

  // V1 18/05 — hasIssue ignore "warming-up" : pas une alerte.
  const hasIssue = pillars.some((p) => p.status === "tepid" || p.status === "cold");
  return { clientId, pillars, hasIssue };
}

/**
 * Variante pour le dashboard admin : balaye tous les clients ACTIVE et
 * retourne ceux qui ont au moins un pilier tepid ou cold.
 */
export async function getPillarHealthAllClients(): Promise<PillarHealthReport[]> {
  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  const reports: PillarHealthReport[] = [];
  for (const c of clients) {
    const r = await getPillarHealth(c.id);
    if (r.hasIssue) reports.push(r);
  }
  return reports;
}
