// @ts-nocheck — script CLI, types stricts non requis (le build Next ignore ce dossier via tsconfig)
/**
 * Phase 3.B — Provisionning Rodz + TheirStack pour DigitestLab.
 *
 * Lance d'abord en dryRun pour preview, puis en mode "draft" pour
 * créer effectivement les signaux côté Rodz (sans les activer).
 *
 * Lancer : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/provision-digitestlab.ts [--dry-run] [--activate]
 */
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

// Stub `server-only` pour CLI scripts (sinon throw au require)
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") {
    return require.resolve("./_server-only-stub.js");
  }
  return originalResolve.call(this, request, ...args);
};

import {
  provisionRodzForClient,
  previewRodzProvisioning,
} from "../src/lib/rodz-provision";
import {
  provisionTheirstackForClient,
  previewTheirstackProvisioning,
} from "../src/lib/theirstack-provision";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const activate = process.argv.includes("--activate");
  const status = activate ? "active" : "draft";

  // Lookup DigitestLab
  const { db } = await import("../src/lib/db");
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }
  console.log(`📦 Client : ${client.name} (${client.id})`);
  console.log(`🚦 Mode : ${dryRun ? "DRY RUN" : status.toUpperCase()}\n`);

  // ── PREVIEW Rodz
  console.log("=== ROZ Preview ===");
  const rodzPreview = await previewRodzProvisioning(client.id);
  for (const s of rodzPreview.signals) {
    console.log(`  • ${s.type.padEnd(28)} → "${s.name}"`);
    console.log(
      `    daily limit: ${s.dailyLeadLimit ?? "∞"} · personas: ${(s.config.targetPersonas as string[])?.join(", ") ?? "—"}`,
    );
    console.log(`    locations: ${(s.config.locations || s.config.hqLocations || s.config.personaLocations) as string[]}`);
  }

  // ── PREVIEW TheirStack
  console.log("\n=== TheirStack Preview ===");
  const tsPreview = await previewTheirstackProvisioning(client.id);
  for (const s of tsPreview.searches) {
    console.log(`  • [${s.search_type}] ${s.name}`);
    const summary = JSON.stringify(s.filters).slice(0, 130);
    console.log(`    ${summary}…`);
  }

  if (dryRun) {
    console.log("\n✅ DRY RUN terminé. Relancer sans --dry-run pour provisionner.");
    process.exit(0);
  }

  // ── PROVISIONNING RÉEL
  console.log(`\n=== Rodz provisioning (${status}) ===`);
  const rodzResult = await provisionRodzForClient(client.id, { status });
  console.log(`  ✅ ${rodzResult.signalsCreated.length} signaux créés`);
  for (const s of rodzResult.signalsCreated) {
    console.log(`    • ${s.signalType.padEnd(28)} ${s.rodzSignalId}`);
  }
  if (rodzResult.signalsSkipped.length > 0) {
    console.log(`  ⏭️  ${rodzResult.signalsSkipped.length} skip :`);
    for (const s of rodzResult.signalsSkipped) {
      console.log(`    - ${s.signalType} (${s.reason})`);
    }
  }
  if (rodzResult.errors.length > 0) {
    console.log(`  ❌ ${rodzResult.errors.length} erreurs :`);
    for (const e of rodzResult.errors) {
      console.log(`    - ${e.signalType} : ${e.error}`);
    }
  }

  console.log("\n=== TheirStack provisioning ===");
  const tsResult = await provisionTheirstackForClient(client.id);
  console.log(`  ✅ ${tsResult.searchesCreated.length} saved_searches créées`);
  for (const s of tsResult.searchesCreated) {
    console.log(`    • [${s.search_type}] ${s.name}`);
  }
  if (tsResult.searchesSkipped.length > 0) {
    console.log(`  ⏭️  ${tsResult.searchesSkipped.length} skip`);
  }
  if (tsResult.errors.length > 0) {
    console.log(`  ❌ ${tsResult.errors.length} erreurs :`);
    for (const e of tsResult.errors) {
      console.log(`    - ${e.name} : ${e.error}`);
    }
  }

  console.log("\n✅ Provisioning Phase 3.B terminé.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
