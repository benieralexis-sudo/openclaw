// @ts-nocheck — script CLI
/**
 * Inspecte les données Sprint 7 (LeadActivity DASHBOARD_INTERACTION + MEETING_BOOKED).
 * Analyse : types, sources, clients, payload d'interactions.
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
  
  // Période : 7 derniers jours
  const since7d = new Date();
  since7d.setDate(since7d.getDate() - 7);
  
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);
  
  console.log(`\n📊 Sprint 7 Data Analysis`);
  console.log(`  Period 7d : ${since7d.toISOString()}`);
  console.log(`  Period 30d: ${since30d.toISOString()}\n`);
  
  // Q1 — LeadActivity by type, source, clientId (7d)
  const activities7d = await db.leadActivity.findMany({
    where: {
      createdAt: { gte: since7d },
    },
    select: {
      id: true,
      type: true,
      source: true,
      clientId: true,
      leadId: true,
      occurredAt: true,
      payload: true,
    },
  });
  
  console.log(`=== LeadActivity 7d ===`);
  console.log(`Total : ${activities7d.length} events\n`);
  
  // Count by type
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byClientType: Record<string, Record<string, number>> = {};
  
  for (const a of activities7d) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    
    if (!byClientType[a.clientId]) byClientType[a.clientId] = {};
    byClientType[a.clientId][a.type] = (byClientType[a.clientId][a.type] ?? 0) + 1;
  }
  
  console.log("By Type:");
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c}`);
  }
  
  console.log("\nBy Source:");
  for (const [s, c] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }
  
  console.log("\nBy Client:");
  for (const [cid, types] of Object.entries(byClientType)) {
    const client = await db.client.findUnique({
      where: { id: cid },
      select: { slug: true },
    });
    console.log(`  ${client?.slug ?? cid}:`);
    for (const [t, c] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${t}: ${c}`);
    }
  }
  
  // Q2 — Specifically DASHBOARD_INTERACTION + MEETING_BOOKED
  const dashboardInterage = activities7d.filter((a) => a.type === "DASHBOARD_INTERACTION");
  const meetingBooked = activities7d.filter((a) => a.type === "MEETING_BOOKED");
  
  console.log(`\n=== DASHBOARD_INTERACTION (7d) ===`);
  console.log(`Count : ${dashboardInterage.length}`);
  if (dashboardInterage.length > 0) {
    console.log("Last 5 events:");
    for (const e of dashboardInterage.slice(0, 5)) {
      console.log(`  • ${e.occurredAt.toISOString()} | client=${e.clientId} | payload=${JSON.stringify(e.payload)}`);
    }
  }
  
  console.log(`\n=== MEETING_BOOKED (7d) ===`);
  console.log(`Count : ${meetingBooked.length}`);
  if (meetingBooked.length > 0) {
    console.log("Last 5 events:");
    for (const e of meetingBooked.slice(0, 5)) {
      console.log(`  • ${e.occurredAt.toISOString()} | lead=${e.leadId} | payload=${JSON.stringify(e.payload)}`);
    }
  }
  
  // Q3 — ARCHIVED leads (30d)
  const archivedLeads = await db.lead.findMany({
    where: {
      status: "ARCHIVED",
      deletedAt: { gte: since30d },
    },
    select: {
      id: true,
      companyName: true,
      deletedAt: true,
    },
  });
  
  console.log(`\n=== Lead.status=ARCHIVED (30d) ===`);
  console.log(`Count : ${archivedLeads.length}`);
  
  // Count ARCHIVED with MANUAL source in LeadActivity
  const archivedWithManualActivity = await db.leadActivity.findMany({
    where: {
      type: "DASHBOARD_INTERACTION",
      source: "MANUAL",
      createdAt: { gte: since30d },
      payload: { path: ["kind"], equals: "archive_manual" },
    },
    select: {
      id: true,
      leadId: true,
      payload: true,
    },
  });
  
  console.log(`Count ARCHIVED with manual archive_manual event : ${archivedWithManualActivity.length}`);
  
  // Get sample ARCHIVE_MANUAL activit payloads
  if (archivedWithManualActivity.length > 0) {
    console.log("Sample payloads:");
    for (const a of archivedWithManualActivity.slice(0, 3)) {
      console.log(`  • leadId=${a.leadId} | payload=${JSON.stringify(a.payload)}`);
    }
  }
  
  console.log(`\n✅ Analysis complete.\n`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
