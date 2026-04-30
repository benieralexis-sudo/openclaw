import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pappersStats } from "@/lib/pappers";

/**
 * GET /api/internal/tool-usage-report
 *
 * Vue unifiée de la conso des 4 outils payants :
 *   - Apify Starter $50/mo (lookups HarvestAPI + pollers + posts)
 *   - FullEnrich Yearly Start 500 cr/mo (call API + balance)
 *   - Kaspr 10K work emails + 200 phones/mo (compté en DB via leads)
 *   - Pappers (in-memory depuis restart)
 *
 * Auth : header `x-cron-secret`.
 */

interface FullEnrichBalance {
  balance?: number;
}

async function getFullEnrichBalance(): Promise<{ balance: number | null; error?: string }> {
  const apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) return { balance: null, error: "no_api_key" };
  try {
    const res = await fetch("https://app.fullenrich.com/api/v1/account/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { balance: null, error: `http_${res.status}` };
    const json = (await res.json()) as FullEnrichBalance;
    return { balance: json.balance ?? null };
  } catch (e) {
    return { balance: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Kaspr usage (compté côté DB via Lead.kasprWorkEmail / kasprPhone)
  const kasprStats = await db.lead.aggregate({
    where: { deletedAt: null },
    _count: {
      kasprWorkEmail: true,
      kasprPhone: true,
      kasprAttemptedAt: true,
    },
  });

  // FullEnrich usage côté DB
  const fullenrichDbStats = await db.lead.aggregate({
    where: { deletedAt: null },
    _count: {
      emailFullenrich: true,
      phoneFullenrich: true,
      fullenrichAttemptedAt: true,
    },
  });

  // FullEnrich balance live
  const fullenrich = await getFullEnrichBalance();

  // HarvestAPI Profile Search lookups (côté DB via linkedinSource)
  const harvestapiLookups = await db.lead.count({
    where: {
      deletedAt: null,
      linkedinSource: "harvestapi-profile-search",
    },
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    pappers: {
      startedAt: pappersStats.startedAt.toISOString(),
      uptimeMinutes: Math.round(
        (Date.now() - pappersStats.startedAt.getTime()) / 60000,
      ),
      cacheHits: pappersStats.cacheHits,
      cacheMisses: pappersStats.cacheMisses,
      cacheHitRatePct:
        pappersStats.cacheHits + pappersStats.cacheMisses > 0
          ? Math.round(
              (pappersStats.cacheHits /
                (pappersStats.cacheHits + pappersStats.cacheMisses)) *
                100,
            )
          : 0,
      apiCallsSuccess: pappersStats.apiCallsSuccess,
      apiCallsError: pappersStats.apiCallsError,
      apiCallsByEndpoint: pappersStats.apiCallsByEndpoint,
      // Estimation conso : chaque cache miss = 1 appel API = 1 crédit Pappers
      estimatedCreditsConsumedSinceStart: pappersStats.apiCallsSuccess,
      note: "Stats in-memory depuis restart. Reset à chaque redéploiement.",
    },
    fullenrich: {
      balanceLive: fullenrich.balance,
      balanceError: fullenrich.error,
      planDefault: 500, // Yearly Start
      usedThisMonth:
        fullenrich.balance !== null ? 500 - fullenrich.balance : null,
      usagePct:
        fullenrich.balance !== null
          ? Math.round(((500 - fullenrich.balance) / 500) * 100)
          : null,
      dbStats: {
        leadsWithEmail: fullenrichDbStats._count.emailFullenrich,
        leadsWithPhone: fullenrichDbStats._count.phoneFullenrich,
        leadsAttempted: fullenrichDbStats._count.fullenrichAttemptedAt,
      },
    },
    kaspr: {
      planDefault: { workEmails: 10000, phones: 200 },
      dbStats: {
        leadsWithWorkEmail: kasprStats._count.kasprWorkEmail,
        leadsWithPhone: kasprStats._count.kasprPhone,
        leadsAttempted: kasprStats._count.kasprAttemptedAt,
      },
      usagePctEmail: Math.round(
        (kasprStats._count.kasprWorkEmail / 10000) * 100,
      ),
      usagePctPhone: Math.round((kasprStats._count.kasprPhone / 200) * 100),
    },
    apify: {
      planDefault: "$50/mo hard limit (Starter $29 base)",
      // Apify n'a pas d'API publique gratuite pour usage. Voir
      // console.apify.com/billing/usage pour le détail par actor.
      harvestapiProfileSearchLookups: harvestapiLookups,
      note: "Voir console.apify.com/billing/usage pour le détail par actor.",
    },
  });
}
