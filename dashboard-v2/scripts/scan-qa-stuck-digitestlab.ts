// @ts-nocheck — script CLI
/**
 * Bougie 3 (04/05) — Scan QA stuck pour Digi Test Lab.
 *
 * Boost les triggers HIRING_KEY QA dont publishedAt ∈ [30j, 90j] et
 * dont le lead n'est pas encore contacté/archivé. Score → 9, isHot → true.
 *
 * Usage : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/scan-qa-stuck-digitestlab.ts [--dry-run]
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import { scanQaStuckForClient } from "../src/lib/qa-stuck-scanner";

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

  const r = await scanQaStuckForClient(client.id, { dryRun });

  console.log("=== QA Stuck Scanner ===");
  console.log(`  Scanned          : ${r.scanned}`);
  console.log(`  Boosted (new)    : ${r.boosted}`);
  console.log(`  Already boosted  : ${r.alreadyBoosted}`);
  console.log(`  Errors           : ${r.errors}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
