import "server-only";
import { db } from "@/lib/db";
import { getActivePillars } from "@/lib/signal-config";
import { SIGNAL_NAMES } from "@/lib/signal-mapping";

/**
 * V1 17/05/2026 — Détecte les signaux pilier "froids" d'un client.
 *
 * Un pilier est "froid" si :
 *   - C'est un pilier actif du client (isPillar=true, enabled=true)
 *   - Aucun Trigger n'a été créé pour ce signal sur la fenêtre (default 14j)
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

const DEFAULT_WINDOW_DAYS = 14;

export interface ColdPillarReport {
  clientId: string;
  pillarsActive: string[];
  pillarsCold: Array<{
    code: string;
    name: string;
    daysSinceLastTrigger: number | null; // null = jamais aucun trigger
  }>;
  windowDays: number;
}

export async function detectColdPillars(
  clientId: string,
  options: { windowDays?: number } = {},
): Promise<ColdPillarReport> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const activePillars = await getActivePillars(clientId);

  const cold: ColdPillarReport["pillarsCold"] = [];
  for (const code of activePillars) {
    const recent = await db.trigger.count({
      where: {
        clientId,
        deletedAt: null,
        signalCode: code,
        capturedAt: { gte: since },
      },
    });
    if (recent === 0) {
      const latest = await db.trigger.findFirst({
        where: { clientId, deletedAt: null, signalCode: code },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      });
      const days = latest
        ? Math.floor((Date.now() - latest.capturedAt.getTime()) / 86_400_000)
        : null;
      cold.push({
        code,
        name: SIGNAL_NAMES[code] ?? code,
        daysSinceLastTrigger: days,
      });
    }
  }

  return {
    clientId,
    pillarsActive: activePillars,
    pillarsCold: cold,
    windowDays,
  };
}

/**
 * Variante pour le dashboard admin : balaye tous les clients ACTIVE,
 * retourne uniquement ceux qui ont au moins un pilier froid.
 */
export async function detectColdPillarsAllClients(
  options: { windowDays?: number } = {},
): Promise<ColdPillarReport[]> {
  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  const reports: ColdPillarReport[] = [];
  for (const c of clients) {
    const r = await detectColdPillars(c.id, options);
    if (r.pillarsCold.length > 0) {
      reports.push(r);
    }
  }
  return reports;
}
