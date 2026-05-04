// @ts-nocheck — script CLI
/**
 * Bougie 5 (04/05) — Lance le poller France Travail pour Digi Test Lab.
 *
 * Capte les offres tech FR officielles (gratuit, 3000 req/jour).
 *
 * Usage : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/poll-digitestlab-francetravail.ts [--dry-run] [--lookback=72]
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import { pollFranceTravailForClient } from "../src/lib/francetravail-poller";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const lookbackArg = process.argv.find((a) => a.startsWith("--lookback="));
  const lookbackHours = lookbackArg ? Number(lookbackArg.split("=")[1]) : 24;

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
  console.log(`🚦 Mode : ${dryRun ? "DRY RUN" : "REAL RUN"} · Lookback : ${lookbackHours}h\n`);

  const r = await pollFranceTravailForClient(client.id, { dryRun, lookbackHours });

  console.log("=== France Travail Poll ===");
  console.log(`  Offers fetched   : ${r.offersFetched}`);
  console.log(`  Triggers created : ${r.triggersCreated}`);
  console.log(`  Triggers skipped : ${r.triggersSkipped}`);
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
