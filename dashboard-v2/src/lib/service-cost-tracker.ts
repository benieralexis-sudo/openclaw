import "server-only";
import { db } from "@/lib/db";

/**
 * V1 18/05/2026 — Tracking coûts par client × service × jour.
 *
 * Objectif : connaître la marge brute RÉELLE par client en temps réel, pour
 *   - alerter sur les clients déficitaires (coût > revenu mensuel)
 *   - prioriser les optimisations (quel service coûte le plus à un client X)
 *   - valider la marge 78-87% annoncée commerciale
 *
 * Approche : aggregateDailyCostsForAllClients() tourne en cron quotidien
 * et compte depuis Trigger/Lead les volumes par service, multiplie par les
 * tarifs unitaires connus pour obtenir une estimation USD. Insère 1 ligne
 * par (clientId, date, service) dans ServiceCostDaily (upsert idempotent).
 *
 * Tarifs unitaires (approximations basées sur les contrats actuels) :
 *   - Anthropic Opus : ~$0.05/call (1500 input tokens cache + 500 output)
 *   - Apify : ~$0.30/lookup LinkedIn jobs (variable selon dataset)
 *   - TheirStack : forfait (~5200 cr/mois pour la suite — proxy 0$ par lookup)
 *   - Kaspr : abonnement (proxy 0$ par lookup, mais on count pour visibilité)
 *   - FullEnrich : $0.10/email cr + $1.00/phone cr
 *   - HarvestAPI : $0.16/DM lookup + $0.005/profile-search
 *   - Rodz : abonnement (proxy 0$)
 *   - gouv-api : gratuit (0$)
 *   - Pappers : DEPRECATED (migration vers gouv-api)
 */

interface ServiceTariff {
  service: string;
  perCallUsd: number;
  metricUnit: string;
}

const TARIFFS: Record<string, ServiceTariff> = {
  anthropic: { service: "anthropic", perCallUsd: 0.05, metricUnit: "qualifs" },
  apify: { service: "apify", perCallUsd: 0.3, metricUnit: "jobs" },
  theirstack: { service: "theirstack", perCallUsd: 0, metricUnit: "lookups" },
  kaspr: { service: "kaspr", perCallUsd: 0, metricUnit: "lookups" },
  fullenrich_email: { service: "fullenrich_email", perCallUsd: 0.1, metricUnit: "emails" },
  fullenrich_phone: { service: "fullenrich_phone", perCallUsd: 1.0, metricUnit: "phones" },
  harvestapi_dm: { service: "harvestapi_dm", perCallUsd: 0.16, metricUnit: "lookups" },
  harvestapi_profile: { service: "harvestapi_profile", perCallUsd: 0.005, metricUnit: "lookups" },
  rodz: { service: "rodz", perCallUsd: 0, metricUnit: "lookups" },
  "gouv-api": { service: "gouv-api", perCallUsd: 0, metricUnit: "lookups" },
};

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Agrège les coûts hier pour un client donné. Upsert idempotent (rejoue ok).
 */
export async function aggregateDailyCostsForClient(
  clientId: string,
  dateOverride?: Date,
): Promise<{ inserted: number; updated: number; totalUsd: number; details: Array<{ service: string; volume: number; usd: number }> }> {
  const now = dateOverride ?? new Date();
  const day = toDateOnly(now);
  const dayEnd = new Date(day.getTime() + 86_400_000);

  const result: { inserted: number; updated: number; totalUsd: number; details: Array<{ service: string; volume: number; usd: number }> } = {
    inserted: 0,
    updated: 0,
    totalUsd: 0,
    details: [],
  };

  // 1. Anthropic — count Triggers qualifiés (briefV2Json NOT NULL) créés dans la journée
  const anthropicCalls = await db.trigger.count({
    where: {
      clientId,
      capturedAt: { gte: day, lt: dayEnd },
      briefV2Json: { not: undefined as never },
    },
  });

  // 2. Apify — count Triggers depuis sources apify.*
  const apifyCalls = await db.trigger.count({
    where: {
      clientId,
      capturedAt: { gte: day, lt: dayEnd },
      sourceCode: { startsWith: "apify." },
    },
  });

  // 3. FullEnrich emails — count Leads avec emailFullenrich set hier
  const fullenrichEmails = await db.lead.count({
    where: {
      clientId,
      fullenrichAttemptedAt: { gte: day, lt: dayEnd },
      emailFullenrich: { not: null },
    },
  });

  // 4. FullEnrich phones — count Leads avec phoneFullenrich set hier
  const fullenrichPhones = await db.lead.count({
    where: {
      clientId,
      fullenrichAttemptedAt: { gte: day, lt: dayEnd },
      phoneFullenrich: { not: null },
    },
  });

  // 5. Kaspr — count Leads avec kasprAttemptedAt hier
  const kasprCalls = await db.lead.count({
    where: {
      clientId,
      kasprAttemptedAt: { gte: day, lt: dayEnd },
    },
  });

  // 6. HarvestAPI Profile — count Leads avec linkedinFinderAttemptedAt hier
  const harvestProfileCalls = await db.lead.count({
    where: {
      clientId,
      linkedinFinderAttemptedAt: { gte: day, lt: dayEnd },
    },
  });

  // 7. Rodz enrichment — count Leads avec rodzAttemptedAt hier
  const rodzCalls = await db.lead.count({
    where: {
      clientId,
      rodzAttemptedAt: { gte: day, lt: dayEnd },
    },
  });

  // 8. gouv-api — count Triggers avec companySiret set qui ont été enrichis aujourd'hui
  // Approximation : on suppose 1 call gouv-api par trigger avec SIRET capturé aujourd'hui
  const gouvCalls = await db.trigger.count({
    where: {
      clientId,
      capturedAt: { gte: day, lt: dayEnd },
      companySiret: { not: null },
    },
  });

  const records = [
    { service: "anthropic", volume: anthropicCalls, tariff: TARIFFS.anthropic! },
    { service: "apify", volume: apifyCalls, tariff: TARIFFS.apify! },
    { service: "fullenrich_email", volume: fullenrichEmails, tariff: TARIFFS.fullenrich_email! },
    { service: "fullenrich_phone", volume: fullenrichPhones, tariff: TARIFFS.fullenrich_phone! },
    { service: "kaspr", volume: kasprCalls, tariff: TARIFFS.kaspr! },
    { service: "harvestapi_profile", volume: harvestProfileCalls, tariff: TARIFFS.harvestapi_profile! },
    { service: "rodz", volume: rodzCalls, tariff: TARIFFS.rodz! },
    { service: "gouv-api", volume: gouvCalls, tariff: TARIFFS["gouv-api"]! },
  ];

  for (const r of records) {
    const usd = r.volume * r.tariff.perCallUsd;
    const existing = await db.serviceCostDaily.findUnique({
      where: { clientId_date_service: { clientId, date: day, service: r.service } },
    });
    if (existing) {
      await db.serviceCostDaily.update({
        where: { id: existing.id },
        data: {
          volume: r.volume,
          estimatedUsd: usd,
          metric: r.volume,
          metricUnit: r.tariff.metricUnit,
        },
      });
      result.updated += 1;
    } else {
      await db.serviceCostDaily.create({
        data: {
          clientId,
          date: day,
          service: r.service,
          volume: r.volume,
          estimatedUsd: usd,
          metric: r.volume,
          metricUnit: r.tariff.metricUnit,
        },
      });
      result.inserted += 1;
    }
    result.totalUsd += usd;
    if (r.volume > 0) {
      result.details.push({ service: r.service, volume: r.volume, usd: +usd.toFixed(2) });
    }
  }

  return result;
}

/**
 * Agrège les coûts d'hier pour tous les clients ACTIVE. À appeler en cron
 * quotidien (par ex à 01h05 UTC après que la journée précédente est figée).
 */
export async function aggregateDailyCostsForAllClients(): Promise<{
  clientsProcessed: number;
  totalUsd: number;
  perClient: Array<{ clientId: string; clientName: string; totalUsd: number }>;
}> {
  const clients = await db.client.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
  });

  const yesterday = new Date(Date.now() - 86_400_000);
  let totalUsd = 0;
  const perClient: Array<{ clientId: string; clientName: string; totalUsd: number }> = [];

  for (const c of clients) {
    const r = await aggregateDailyCostsForClient(c.id, yesterday);
    totalUsd += r.totalUsd;
    perClient.push({ clientId: c.id, clientName: c.name, totalUsd: +r.totalUsd.toFixed(2) });
  }

  return {
    clientsProcessed: clients.length,
    totalUsd: +totalUsd.toFixed(2),
    perClient,
  };
}

/**
 * Récupère le coût mensuel cumulé pour un client (30 derniers jours).
 * Utilisé par le dashboard / API admin.
 */
export async function getMonthlyCostsForClient(clientId: string): Promise<{
  totalUsd: number;
  byService: Array<{ service: string; volume: number; usd: number }>;
}> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db.serviceCostDaily.findMany({
    where: { clientId, date: { gte: since } },
    select: { service: true, volume: true, estimatedUsd: true },
  });

  const byServiceMap = new Map<string, { volume: number; usd: number }>();
  let totalUsd = 0;
  for (const r of rows) {
    const acc = byServiceMap.get(r.service) ?? { volume: 0, usd: 0 };
    acc.volume += r.volume;
    acc.usd += r.estimatedUsd;
    byServiceMap.set(r.service, acc);
    totalUsd += r.estimatedUsd;
  }

  return {
    totalUsd: +totalUsd.toFixed(2),
    byService: [...byServiceMap.entries()].map(([service, v]) => ({
      service,
      volume: v.volume,
      usd: +v.usd.toFixed(2),
    })).sort((a, b) => b.usd - a.usd),
  };
}
