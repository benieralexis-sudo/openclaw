// @ts-nocheck — script CLI
/**
 * Question 1 — Volume de Triggers par source DTL (90 derniers jours)
 * Pour le client DTL (slug 'digitestlab'), groupe Trigger par sourceCode
 * sur 90 derniers jours.
 * 
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/inspect-source-volumes.ts
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

  const triggers = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: {
      sourceCode: true,
      status: true,
      score: true,
    },
  });

  console.log(`\n📊 iFIND Source Volumes — DTL (90 derniers jours)`);
  console.log(`   Client: ${client.name}`);
  console.log(`   Since: ${since.toISOString().split('T')[0]}`);
  console.log(`   Total triggers: ${triggers.length}\n`);

  // Group by sourceCode
  const sources: Record<string, {
    total: number;
    NEW: number;
    IGNORED: number;
    qualified: number; // score >= 8
  }> = {};

  for (const t of triggers) {
    if (!sources[t.sourceCode]) {
      sources[t.sourceCode] = { total: 0, NEW: 0, IGNORED: 0, qualified: 0 };
    }
    sources[t.sourceCode].total++;
    if (t.status === "NEW") sources[t.sourceCode].NEW++;
    if (t.status === "IGNORED") sources[t.sourceCode].IGNORED++;
    if (t.score >= 8) sources[t.sourceCode].qualified++;
  }

  // Sort by total desc
  const sorted = Object.entries(sources).sort((a, b) => b[1].total - a[1].total);

  console.log("┌─────────────────────────────────┬───────┬─────┬─────────┬────────────┐");
  console.log("│ Source                          │ Total │ NEW │ IGNORED │ Score ≥ 8  │");
  console.log("├─────────────────────────────────┼───────┼─────┼─────────┼────────────┤");

  let statCountGe30 = 0;
  let statCount10to30 = 0;
  let statCountLt10 = 0;

  for (const [sourceCode, stats] of sorted) {
    const source = sourceCode.padEnd(31);
    const total = String(stats.total).padStart(5);
    const newC = String(stats.NEW).padStart(3);
    const ignored = String(stats.IGNORED).padStart(7);
    const qualified = String(stats.qualified).padStart(10);

    console.log(`│ ${source} │ ${total} │ ${newC} │ ${ignored} │ ${qualified} │`);

    if (stats.total >= 30) statCountGe30++;
    else if (stats.total >= 10) statCount10to30++;
    else statCountLt10++;
  }
  console.log("└─────────────────────────────────┴───────┴─────┴─────────┴────────────┘");

  console.log("\n📈 Analyse de maturité:");
  console.log(`   • Sources avec >= 30 triggers (statistiquement significatif): ${statCountGe30}`);
  console.log(`   • Sources avec 10-30 triggers (data faible): ${statCount10to30}`);
  console.log(`   • Sources avec < 10 triggers (data trop faible): ${statCountLt10}`);
  console.log(`\n✅ Score: ${statCountGe30 >= 3 ? "calibration possible (seuil min 3 sources)" : "calibration précoce (trop peu de sources significatives)"}\n`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
