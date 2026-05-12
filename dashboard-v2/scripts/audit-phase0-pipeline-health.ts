// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.1 — Santé pipeline : système tourne-t-il toujours ?
 * Mesure latence capture, dernier trigger, dernier lead, archived auto vs manuel
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!client) process.exit(1);

  const since90 = new Date();
  since90.setDate(since90.getDate() - 90);

  // Dernier Trigger / dernier Lead
  const lastTrigger = await db.trigger.findFirst({
    where: { clientId: client.id },
    orderBy: { capturedAt: "desc" },
    select: { sourceCode: true, capturedAt: true, publishedAt: true, companyName: true },
  });

  const lastLead = await db.lead.findFirst({
    where: { clientId: client.id },
    orderBy: { createdAt: "desc" },
    select: { companyName: true, createdAt: true, status: true },
  });

  // Triggers par jour 30 derniers jours
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);
  const triggersPerDay = await db.$queryRaw<Array<{ day: Date; count: bigint }>>`
    SELECT DATE_TRUNC('day', "capturedAt") AS day, COUNT(*) AS count
    FROM "Trigger"
    WHERE "clientId" = ${client.id} AND "capturedAt" >= ${since30}
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
  `;

  // ARCHIVED auto vs manuel — ignoredReason proxy
  const ignoredReasons = await db.trigger.groupBy({
    by: ["ignoredReason"],
    where: {
      clientId: client.id,
      capturedAt: { gte: since90 },
      status: "IGNORED",
    },
    _count: true,
  });

  // Latence par source = capturedAt - publishedAt
  const latency = await db.$queryRaw<
    Array<{
      source_code: string;
      events: bigint;
      with_published: bigint;
      median_lat_h: number | null;
      p95_lat_h: number | null;
    }>
  >`
    SELECT
      "sourceCode" AS source_code,
      COUNT(*) AS events,
      COUNT(*) FILTER (WHERE "publishedAt" IS NOT NULL) AS with_published,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt")) / 3600.0
      ) FILTER (WHERE "publishedAt" IS NOT NULL) AS median_lat_h,
      PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt")) / 3600.0
      ) FILTER (WHERE "publishedAt" IS NOT NULL) AS p95_lat_h
    FROM "Trigger"
    WHERE "clientId" = ${client.id} AND "capturedAt" >= ${since90}
    GROUP BY "sourceCode"
    ORDER BY events DESC
  `;

  // Couverture SIRENE
  const siretCoverage = await db.$queryRaw<
    Array<{ source_code: string; total: bigint; with_siret: bigint }>
  >`
    SELECT "sourceCode" AS source_code,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE "companySiret" IS NOT NULL) AS with_siret
    FROM "Trigger"
    WHERE "clientId" = ${client.id} AND "capturedAt" >= ${since90}
    GROUP BY "sourceCode"
    ORDER BY total DESC
  `;

  // % Lead créé par source (funnel Trigger → Lead)
  const triggerToLead = await db.$queryRaw<
    Array<{ source_code: string; total: bigint; with_lead: bigint }>
  >`
    SELECT t."sourceCode" AS source_code,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE l.id IS NOT NULL) AS with_lead
    FROM "Trigger" t
    LEFT JOIN "Lead" l ON l."triggerId" = t.id
    WHERE t."clientId" = ${client.id} AND t."capturedAt" >= ${since90}
    GROUP BY t."sourceCode"
    ORDER BY total DESC
  `;

  console.log(`\n📊 AUDIT A.0.1 — Santé pipeline DTL (90 derniers jours)`);

  console.log(`\n🫀 Pipeline vivant ?`);
  if (lastTrigger) {
    const hoursAgo =
      (Date.now() - lastTrigger.capturedAt.getTime()) / 1000 / 3600;
    console.log(
      `   Dernier Trigger : ${lastTrigger.capturedAt.toISOString().slice(0, 16)} (il y a ${hoursAgo.toFixed(1)}h) — ${lastTrigger.sourceCode} — ${lastTrigger.companyName}`,
    );
  }
  if (lastLead) {
    const hoursAgo = (Date.now() - lastLead.createdAt.getTime()) / 1000 / 3600;
    console.log(
      `   Dernier Lead    : ${lastLead.createdAt.toISOString().slice(0, 16)} (il y a ${hoursAgo.toFixed(1)}h) — ${lastLead.companyName} — ${lastLead.status}`,
    );
  }

  console.log(`\n📈 Triggers/jour (30 derniers jours) :`);
  for (const r of triggersPerDay) {
    const bar = "█".repeat(Number(r.count));
    console.log(
      `   ${r.day.toISOString().slice(0, 10)} : ${String(r.count).padStart(3)} ${bar}`,
    );
  }

  console.log(`\n📌 IGNORED reasons (90j) :`);
  for (const r of ignoredReasons.sort((a, b) => b._count - a._count)) {
    console.log(`   • ${(r.ignoredReason ?? "(null)").padEnd(50)} : ${r._count}`);
  }

  console.log(`\n⏱️  Latence publishedAt → capturedAt :`);
  console.log(
    `   Source                              | Events |  w/Pub | Median h |   p95 h`,
  );
  for (const r of latency) {
    console.log(
      `   ${r.source_code.padEnd(35)} | ${String(r.events).padStart(6)} | ${String(r.with_published).padStart(6)} | ${
        r.median_lat_h !== null ? Number(r.median_lat_h).toFixed(1).padStart(8) : "    n/a"
      } | ${r.p95_lat_h !== null ? Number(r.p95_lat_h).toFixed(1).padStart(7) : "    n/a"}`,
    );
  }

  console.log(`\n🎯 Couverture SIRENE par source (90j) :`);
  for (const r of siretCoverage) {
    const pct = ((Number(r.with_siret) / Number(r.total)) * 100).toFixed(1);
    console.log(
      `   ${r.source_code.padEnd(35)} | ${String(r.total).padStart(4)} / ${String(r.with_siret).padStart(4)} = ${pct.padStart(5)}%`,
    );
  }

  console.log(`\n🔁 Funnel Trigger → Lead (90j) :`);
  let totalTriggers = 0n;
  let totalLeads = 0n;
  for (const r of triggerToLead) {
    totalTriggers += r.total;
    totalLeads += r.with_lead;
    const pct = ((Number(r.with_lead) / Number(r.total)) * 100).toFixed(1);
    console.log(
      `   ${r.source_code.padEnd(35)} | ${String(r.total).padStart(4)} → ${String(r.with_lead).padStart(4)} (${pct.padStart(5)}%)`,
    );
  }
  console.log(
    `   ${"TOTAL".padEnd(35)} | ${String(totalTriggers).padStart(4)} → ${String(totalLeads).padStart(4)} (${((Number(totalLeads) / Number(totalTriggers)) * 100).toFixed(1)}%)`,
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
