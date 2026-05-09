// @ts-nocheck — script CLI
/**
 * Inspecte le JSON ICP du client digitestlab et affiche sa structure.
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
    select: { id: true, name: true, icp: true },
  });
  
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }
  
  console.log(`\n📋 Client ICP : ${client.name} (${client.id})\n`);
  
  if (!client.icp) {
    console.log("⚠️  ICP est NULL");
    await db.$disconnect();
    return;
  }
  
  const icp = client.icp as Record<string, unknown>;
  
  console.log("=== Top-level keys ===");
  const keys = Object.keys(icp).sort();
  for (const k of keys) {
    const val = icp[k];
    if (Array.isArray(val)) {
      console.log(`  • ${k} : array[${val.length}]`);
    } else if (typeof val === "object" && val !== null) {
      console.log(`  • ${k} : object`);
    } else if (typeof val === "string") {
      console.log(`  • ${k} : string (${(val as string).length} chars)`);
    } else {
      console.log(`  • ${k} : ${typeof val}`);
    }
  }
  
  console.log("\n=== Full ICP JSON ===");
  console.log(JSON.stringify(icp, null, 2));
  
  const jsonStr = JSON.stringify(icp);
  console.log(`\n=== Metrics ===`);
  console.log(`  Total ICP size : ${jsonStr.length} chars (${(jsonStr.length / 1024).toFixed(1)} KB)`);
  
  // Check for existing fields that would conflict with dynamicFewShots
  const hasConflict = ["tierRules", "sourceWeights", "dynamicFewShots", "boostingRules"].some(
    (k) => k in icp
  );
  console.log(`  Has conflict fields : ${hasConflict ? "YES" : "NO"}`);
  
  console.log("\n✅ Inspection terminée.\n");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
