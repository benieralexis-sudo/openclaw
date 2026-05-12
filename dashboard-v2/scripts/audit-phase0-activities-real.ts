// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.1 — Vrais outcomes DTL : qu'est-ce qui EST tracé en LeadActivity sur 90j ?
 * Avant de conclure "0 outcomes", on inspecte par type + source + payload
 * pour comprendre ce qui est vraiment capturé (biais : Cal.com caduc 05/05,
 * Fred peut utiliser leads hors dashboard).
 *
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/audit-phase0-activities-real.ts
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
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Total Leads DTL 90j
  const totalLeads = await db.lead.count({
    where: { clientId: client.id, createdAt: { gte: since } },
  });

  // Distribution LeadStatus
  const statusDistribution = await db.lead.groupBy({
    by: ["status"],
    where: { clientId: client.id, createdAt: { gte: since } },
    _count: true,
  });

  // Toutes les LeadActivity DTL 90j, groupées par type
  const activities = await db.leadActivity.groupBy({
    by: ["type", "source", "direction"],
    where: { clientId: client.id, occurredAt: { gte: since } },
    _count: true,
  });

  // Top 20 LeadActivity les plus récentes pour comprendre payload
  const recentActivities = await db.leadActivity.findMany({
    where: { clientId: client.id, occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: {
      type: true,
      source: true,
      direction: true,
      occurredAt: true,
      userId: true,
      payload: true,
    },
  });

  // Email status distribution
  const emailStatus = await db.lead.groupBy({
    by: ["emailStatus"],
    where: { clientId: client.id, createdAt: { gte: since } },
    _count: true,
  });

  console.log(`\n📊 AUDIT A.0.1 — Outcomes réels DTL (90 derniers jours)`);
  console.log(`   Client: ${client.name}`);
  console.log(`   Since: ${since.toISOString().split("T")[0]}`);
  console.log(`   Total Leads DTL: ${totalLeads}\n`);

  console.log(`📌 Distribution Lead.status :`);
  for (const row of statusDistribution.sort((a, b) => b._count - a._count)) {
    console.log(`   • ${row.status.padEnd(25)} : ${row._count}`);
  }

  console.log(`\n📌 Distribution Lead.emailStatus :`);
  for (const row of emailStatus.sort((a, b) => b._count - a._count)) {
    console.log(`   • ${row.emailStatus.padEnd(25)} : ${row._count}`);
  }

  console.log(`\n📌 LeadActivity 90j — par (type, source, direction) :`);
  if (activities.length === 0) {
    console.log(`   ⚠️  AUCUNE LeadActivity en 90 jours.`);
  } else {
    for (const row of activities.sort((a, b) => b._count - a._count)) {
      console.log(
        `   • ${row.type.padEnd(25)} | ${row.source.padEnd(15)} | ${row.direction.padEnd(10)} : ${row._count}`,
      );
    }
  }

  console.log(`\n📌 20 dernières LeadActivity (payload tronqué) :`);
  if (recentActivities.length === 0) {
    console.log(`   ⚠️  Aucune.`);
  } else {
    for (const a of recentActivities) {
      const payloadStr = a.payload
        ? JSON.stringify(a.payload).slice(0, 80)
        : "null";
      console.log(
        `   ${a.occurredAt.toISOString().slice(0, 16)} | ${a.type.padEnd(20)} | ${a.source.padEnd(12)} | user=${a.userId ?? "bot"} | ${payloadStr}`,
      );
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
