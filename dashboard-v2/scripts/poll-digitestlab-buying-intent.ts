// @ts-nocheck — script CLI
/**
 * Bougie 2 (04/05) — Lance uniquement le poller buying-intent QA pour
 * Digi Test Lab. Permet de tester sans déclencher le pipeline complet
 * (TheirStack jobs + Apify).
 *
 * Usage : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/poll-digitestlab-buying-intent.ts [--dry-run]
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import { pollTheirstackBuyingIntentForClient } from "../src/lib/theirstack-poller";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
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
  console.log(`🚦 Mode : ${dryRun ? "DRY RUN" : "REAL RUN"}\n`);

  const r = await pollTheirstackBuyingIntentForClient(client.id, {
    dryRun,
    companiesLimit: 15,
  });

  console.log("=== TheirStack Buying Intent QA ===");
  console.log(`  Companies found    : ${r.companiesFound}`);
  console.log(`  Triggers created   : ${r.triggersCreated}`);
  console.log(`  Triggers skipped   : ${r.triggersSkipped}`);
  console.log(`  Credits estimés    : ${r.creditsEstimateUsed}`);
  if (r.errors.length > 0) {
    console.log(`  ❌ ${r.errors.length} erreurs :`);
    for (const e of r.errors) console.log(`    - ${e.kind}: ${e.error}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
