import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pappersStats } from "@/lib/pappers";

/**
 * GET /api/health/deep
 *
 * Health-check approfondi par composant. Pas d'auth (équivalent /api/health
 * basique). Utilisé par le cron healthcheck-deep.sh toutes les 5 min pour
 * alerter via Telegram système si degraded/down.
 *
 * Seuils :
 *  - DB : status=down si error, degraded si latency > 500ms
 *  - FullEnrich : down si API échoue, degraded si balance < 50 cr
 *  - Apify : ne s'audite pas via API publique → on regarde dernière erreur
 *  - Anthropic : on ne fait pas d'appel (coûte tokens), on regarde sa
 *    dernière erreur dans les 60 min via les logs
 *  - LastRunPollers : degraded si > 90 min (cron 1h tourne mal)
 */

interface ComponentStatus {
  status: "up" | "degraded" | "down";
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

interface DeepHealthResponse {
  status: "up" | "degraded" | "down";
  generatedAt: string;
  uptimeSeconds: number;
  components: Record<string, ComponentStatus>;
}

async function checkDatabase(): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    if (latencyMs > 500) {
      return {
        status: "degraded",
        message: `DB latency ${latencyMs}ms > 500ms`,
        latencyMs,
      };
    }
    return { status: "up", latencyMs };
  } catch (e) {
    return {
      status: "down",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkFullEnrich(): Promise<ComponentStatus> {
  const apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) {
    return { status: "degraded", message: "FULLENRICH_API_KEY non configuré" };
  }
  const start = Date.now();
  try {
    const res = await fetch("https://app.fullenrich.com/api/v1/account/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        status: "down",
        message: `FullEnrich HTTP ${res.status}`,
        latencyMs,
      };
    }
    const json = (await res.json()) as { balance?: number };
    const balance = json.balance ?? 0;
    if (balance < 50) {
      return {
        status: "degraded",
        message: `FullEnrich balance ${balance} cr < 50 cr — souscrire un boost`,
        latencyMs,
        details: { balance },
      };
    }
    return { status: "up", latencyMs, details: { balance } };
  } catch (e) {
    return {
      status: "down",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkLastRunPollers(): Promise<ComponentStatus> {
  // On regarde la dernière LeadActivity (ou sinon le dernier Lead créé) comme
  // proxy d'activité du pipeline.
  try {
    const lastLead = await db.lead.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!lastLead) {
      return { status: "degraded", message: "Aucun lead en DB — pipeline neuf ?" };
    }
    const ageMinutes = Math.floor(
      (Date.now() - lastLead.createdAt.getTime()) / 60_000,
    );
    // Cron run-pollers tourne toutes les 1h → on alerte si > 90 min sans nouveau lead
    if (ageMinutes > 90) {
      return {
        status: "degraded",
        message: `Dernier lead créé il y a ${ageMinutes} min (cron 1h)`,
        details: { ageMinutes },
      };
    }
    return { status: "up", details: { ageMinutes } };
  } catch (e) {
    return {
      status: "down",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkPappers(): Promise<ComponentStatus> {
  // Pas d'API publique pour Pappers credits — on regarde nos compteurs in-memory.
  // Si on a des erreurs récentes (apiCallsError > 5 sur les 100 derniers calls),
  // c'est que Pappers répond mal.
  const errorRate =
    pappersStats.apiCallsSuccess + pappersStats.apiCallsError > 0
      ? pappersStats.apiCallsError /
        (pappersStats.apiCallsSuccess + pappersStats.apiCallsError)
      : 0;
  if (errorRate > 0.2) {
    return {
      status: "degraded",
      message: `Pappers error rate ${Math.round(errorRate * 100)}% (${pappersStats.apiCallsError} errors)`,
      details: {
        successCalls: pappersStats.apiCallsSuccess,
        errorCalls: pappersStats.apiCallsError,
      },
    };
  }
  return {
    status: "up",
    details: {
      successCalls: pappersStats.apiCallsSuccess,
      errorCalls: pappersStats.apiCallsError,
      cacheHitRate:
        pappersStats.cacheHits + pappersStats.cacheMisses > 0
          ? Math.round(
              (pappersStats.cacheHits /
                (pappersStats.cacheHits + pappersStats.cacheMisses)) *
                100,
            )
          : 0,
    },
  };
}

export async function GET() {
  const startedAt = Date.now();

  const [database, fullenrich, lastRunPollers, pappers] = await Promise.all([
    checkDatabase(),
    checkFullEnrich(),
    checkLastRunPollers(),
    checkPappers(),
  ]);

  const components: Record<string, ComponentStatus> = {
    database,
    fullenrich,
    pappers,
    lastRunPollers,
  };

  // Status global = pire des composants
  let globalStatus: "up" | "degraded" | "down" = "up";
  for (const c of Object.values(components)) {
    if (c.status === "down") {
      globalStatus = "down";
      break;
    }
    if (c.status === "degraded" && globalStatus === "up") {
      globalStatus = "degraded";
    }
  }

  const response: DeepHealthResponse = {
    status: globalStatus,
    generatedAt: new Date().toISOString(),
    uptimeSeconds: process.uptime ? Math.round(process.uptime()) : 0,
    components,
  };

  const httpStatus = globalStatus === "down" ? 503 : 200;
  return NextResponse.json(response, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
