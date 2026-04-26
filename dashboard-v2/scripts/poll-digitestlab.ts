// @ts-nocheck — script CLI
/**
 * Phase 3.C — Poller TheirStack + Apify pour DigitestLab.
 *
 * Lance les 2 pollers (TheirStack jobs+companies, Apify France Jobs)
 * + enrichissement Pappers SIRENE des nouveaux triggers.
 *
 * Usage :
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/poll-digitestlab.ts [--dry-run] [--linkedin]
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import { pollTheirstackForClient, enrichRecentTriggersWithSirene } from "../src/lib/theirstack-poller";
import { pollApifyForClient } from "../src/lib/apify-poller";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const useLinkedin = process.argv.includes("--linkedin");

  const { db } = await import("../src/lib/db");
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }
  console.log(`📦 ${client.name} (${client.id})`);
  console.log(`🚦 Mode : ${dryRun ? "DRY RUN" : "REAL RUN"} · LinkedIn : ${useLinkedin ? "ON" : "OFF"}\n`);

  // ────────────────────────────────────────────────────────────────────
  // 1) TheirStack
  // ────────────────────────────────────────────────────────────────────
  console.log("=== TheirStack poll ===");
  const tsResult = await pollTheirstackForClient(client.id, {
    dryRun,
    jobsLimit: 30,
    companiesLimit: 15,
  });
  console.log(`  Jobs found       : ${tsResult.jobsFound}`);
  console.log(`  Jobs created     : ${tsResult.jobsCreated}`);
  console.log(`  Jobs skipped     : ${tsResult.jobsSkipped}`);
  console.log(`  Companies found  : ${tsResult.companiesFound}`);
  console.log(`  Credits estimés  : ${tsResult.creditsEstimateUsed}`);
  if (tsResult.errors.length > 0) {
    console.log(`  ❌ ${tsResult.errors.length} erreurs :`);
    for (const e of tsResult.errors) console.log(`    - ${e.kind}: ${e.error}`);
  }

  // ────────────────────────────────────────────────────────────────────
  // 2) Apify France Jobs
  // ────────────────────────────────────────────────────────────────────
  console.log("\n=== Apify poll ===");
  const apifyResult = await pollApifyForClient(client.id, {
    dryRun,
    useFranceJobs: true,
    useLinkedin,
  });
  console.log(`  Actor runs : ${apifyResult.actorRuns.length}`);
  for (const r of apifyResult.actorRuns) {
    console.log(`  • ${r.actor}`);
    console.log(`    runId: ${r.runId} · CU: ${r.computeUnits ?? "?"}`);
    console.log(`    items: ${r.itemsFound} · created: ${r.triggersCreated} · skipped: ${r.skipped}`);
    if (r.error) console.log(`    ❌ ${r.error}`);
  }
  console.log(`  Total triggers Apify : ${apifyResult.totalTriggersCreated}`);

  // ────────────────────────────────────────────────────────────────────
  // 3) Pappers enrichissement SIRENE des nouveaux triggers
  // ────────────────────────────────────────────────────────────────────
  if (!dryRun) {
    console.log("\n=== Pappers SIRENE enrichment (24h) ===");
    const pappers = await enrichRecentTriggersWithSirene(client.id, { limit: 30 });
    console.log(`  Enriched : ${pappers.enriched}`);
    console.log(`  Skipped  : ${pappers.skipped}`);
    console.log(`  Errors   : ${pappers.errors}`);
  }

  console.log("\n✅ Phase 3.C polling terminé.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
