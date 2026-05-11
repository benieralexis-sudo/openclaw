import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promises as fs } from "fs";

/**
 * GET /api/internal/cost-report
 *
 * Audit 10/05 19h — visibilité budget temps réel.
 * Agrège les coûts/quotas depuis les API providers + DB.
 *
 * Header: x-cron-secret
 */

const ANTHROPIC_BURN_STATE = "/tmp/anthropic-burn-state.json";

interface ServiceCost {
  service: string;
  status: "ok" | "warn" | "critical";
  used: number | string;
  total: number | string;
  pctUsed: number | null;
  resetAt: string | null;
  burnPerDay: number | null;
  projection: string | null;
  notes?: string;
}

async function fetchApify(): Promise<ServiceCost> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return { service: "apify", status: "critical", used: 0, total: 0, pctUsed: null, resetAt: null, burnPerDay: null, projection: null, notes: "no token" };
  }
  try {
    const [usageRes, limitsRes] = await Promise.all([
      fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${token}`),
      fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`),
    ]);
    const usage = await usageRes.json();
    const limits = await limitsRes.json();
    const used = limits.data?.current?.monthlyUsageUsd ?? 0;
    const total = limits.data?.limits?.maxMonthlyUsageUsd ?? 100;
    const cycleEnd = limits.data?.monthlyUsageCycle?.endAt ?? null;
    const cycleStart = limits.data?.monthlyUsageCycle?.startAt ?? null;
    const pct = (used / total) * 100;
    const daysElapsed = cycleStart ? Math.max(1, Math.floor((Date.now() - new Date(cycleStart).getTime()) / 86400000)) : 1;
    const burnPerDay = used / daysElapsed;
    const daysLeft = cycleEnd ? Math.max(0, Math.floor((new Date(cycleEnd).getTime() - Date.now()) / 86400000)) : 0;
    const projUsed = used + burnPerDay * daysLeft;
    const status = projUsed > total * 1.05 ? "critical" : projUsed > total * 0.9 ? "warn" : "ok";
    return {
      service: "apify",
      status,
      used: +used.toFixed(2),
      total,
      pctUsed: +pct.toFixed(1),
      resetAt: cycleEnd,
      burnPerDay: +burnPerDay.toFixed(2),
      projection: `~$${projUsed.toFixed(0)} fin de cycle`,
    };
  } catch (e) {
    return { service: "apify", status: "critical", used: 0, total: 0, pctUsed: null, resetAt: null, burnPerDay: null, projection: null, notes: e instanceof Error ? e.message : "err" };
  }
}

async function fetchTheirstack(): Promise<ServiceCost> {
  const token = process.env.THEIRSTACK_API_TOKEN;
  if (!token) {
    return { service: "theirstack", status: "critical", used: 0, total: 0, pctUsed: null, resetAt: null, burnPerDay: null, projection: null, notes: "no token" };
  }
  try {
    const res = await fetch("https://api.theirstack.com/v0/billing/credit-balance", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const used = data.used_api_credits ?? 0;
    const total = data.api_credits ?? 5200;
    const resetAt = data.earliest_expiration ?? null;
    const pct = (used / total) * 100;
    const daysLeft = resetAt ? Math.max(0, Math.floor((new Date(resetAt).getTime() - Date.now()) / 86400000)) : 0;
    // Burn estimate from last 7 days consumption
    let burnPerDay = 0;
    try {
      const consRes = await fetch("https://api.theirstack.com/v0/teams/credits_consumption", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cons = await consRes.json();
      const recent = (Array.isArray(cons) ? cons : []).slice(-7);
      const total7d = recent.reduce((s: number, d: { api_credits_consumed: number }) => s + (d.api_credits_consumed ?? 0), 0);
      burnPerDay = total7d / 7;
    } catch {}
    const remaining = total - used;
    const projDaysLeft = burnPerDay > 0 ? Math.floor(remaining / burnPerDay) : Infinity;
    const status = projDaysLeft < daysLeft ? "critical" : pct > 90 ? "warn" : "ok";
    return {
      service: "theirstack",
      status,
      used,
      total,
      pctUsed: +pct.toFixed(1),
      resetAt,
      burnPerDay: +burnPerDay.toFixed(0),
      projection: burnPerDay > 0 ? `${remaining} cr restants pour ${projDaysLeft}j (cycle ${daysLeft}j)` : `${remaining} cr restants`,
    };
  } catch (e) {
    return { service: "theirstack", status: "critical", used: 0, total: 0, pctUsed: null, resetAt: null, burnPerDay: null, projection: null, notes: e instanceof Error ? e.message : "err" };
  }
}

async function readAnthropic(): Promise<ServiceCost> {
  try {
    const raw = await fs.readFile(ANTHROPIC_BURN_STATE, "utf8");
    const data = JSON.parse(raw);
    const total = data.total_cost_usd ?? 0;
    return {
      service: "anthropic",
      status: total > 30 ? "warn" : "ok",
      used: +total.toFixed(2),
      total: "pay-as-you-go",
      pctUsed: null,
      resetAt: null,
      burnPerDay: null,
      projection: total > 0.5 ? `~$${(total * 30).toFixed(0)}/mo extrapolation` : "stable",
      notes: "burn cumulé depuis création du fichier",
    };
  } catch {
    return { service: "anthropic", status: "ok", used: "n/a", total: "pay-as-you-go", pctUsed: null, resetAt: null, burnPerDay: null, projection: null, notes: "burn state not initialized" };
  }
}

async function readKasprDb(): Promise<ServiceCost> {
  // Tracking DB cassé — on compte juste les attempts comme proxy
  const stats = await db.lead.aggregate({
    where: { kasprAttemptedAt: { not: null } },
    _count: true,
  });
  const hits = await db.lead.count({
    where: {
      OR: [
        { kasprWorkEmail: { not: null } },
        { kasprPhone: { not: null } },
      ],
    },
  });
  return {
    service: "kaspr",
    status: "warn",
    used: `${stats._count} attempts, ${hits} hits`,
    total: "abonnement",
    pctUsed: null,
    resetAt: null,
    burnPerDay: null,
    projection: null,
    notes: "tracking DB Lead.kasprCreditsUsed cassé — voir kaspr.io/dashboard pour vrais credits",
  };
}

async function readFullenrichDb(): Promise<ServiceCost> {
  const attempts = await db.lead.count({ where: { fullenrichAttemptedAt: { not: null } } });
  const hits = await db.lead.count({
    where: { OR: [{ emailFullenrich: { not: null } }, { phoneFullenrich: { not: null } }] },
  });
  return {
    service: "fullenrich",
    status: "ok",
    used: `${attempts} attempts, ${hits} hits`,
    total: "1000 cr/an (yearly start)",
    pctUsed: null,
    resetAt: null,
    burnPerDay: null,
    projection: null,
    notes: "tracking DB ok via emailFullenrich/phoneFullenrich",
  };
}

async function readPappersDb(): Promise<ServiceCost> {
  const attempts = await db.trigger.count({ where: { pappersDirigeantsAttemptedAt: { not: null } } });
  const hits = await db.lead.count({ where: { companyRevenue: { not: null } } });
  return {
    service: "pappers",
    status: "ok",
    used: `${attempts} dirigeant calls, ${hits} bilan hits`,
    total: "5000 cr/mois",
    pctUsed: null,
    resetAt: null,
    burnPerDay: null,
    projection: null,
    notes: "cache in-process 1h, ~12% quota mensuel utilisé",
  };
}

async function readRodzDb(): Promise<ServiceCost> {
  const signals = await db.rodzSignal.findMany({
    select: { signalType: true, leadsReceived: true, active: true },
  });
  const totalLeads = signals.reduce((s, sig) => s + (sig.leadsReceived ?? 0), 0);
  return {
    service: "rodz",
    status: "warn",
    used: `${totalLeads} leads reçus (${signals.filter((s) => s.active).length} signaux actifs)`,
    total: "Pack Pro 200€ one-shot (26/04, ~4 mois de crédits)",
    pctUsed: null,
    resetAt: null,
    burnPerDay: null,
    projection: null,
    notes: "tracking DB RodzSignal.creditsUsed cassé — voir rodz.io pour vrais credits",
  };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const services = await Promise.all([
    fetchApify(),
    fetchTheirstack(),
    readAnthropic(),
    readKasprDb(),
    readFullenrichDb(),
    readPappersDb(),
    readRodzDb(),
  ]);

  const overall = services.some((s) => s.status === "critical")
    ? "critical"
    : services.some((s) => s.status === "warn")
      ? "warn"
      : "ok";

  return NextResponse.json(
    { overall, generatedAt: new Date().toISOString(), services },
    { status: 200 },
  );
}
