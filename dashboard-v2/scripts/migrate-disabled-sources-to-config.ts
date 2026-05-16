// @ts-nocheck — script CLI, types stricts non requis
/**
 * Migration cohérence (16/05/2026) — icp.disabledSources → ClientSignalConfig.
 *
 * Contexte : le patch #2 du 16/05 a ajouté `icp.disabledSources: string[]`
 * comme kill-switch par signal. Le sprint catalogue introduit `ClientSignalConfig`
 * qui formalise la même chose en table relationnelle propre.
 *
 * Ce script migre chaque entrée `icp.disabledSources` vers
 * `ClientSignalConfig(enabled=false)` pour avoir une source unique de vérité.
 *
 * Mapping sourceCode → signalCode du catalogue :
 *   On parcourt SignalCatalog.sourceCodes et on trouve quel signal contient
 *   le sourceCode désactivé. Si plusieurs signaux le contiennent, on les
 *   désactive tous (rare en pratique).
 *
 * Idempotent : upsert sur (clientId, signalId).
 * Pas de suppression de icp.disabledSources (compat ascendante pendant la
 * période de double-source de vérité). À nettoyer dans un PR ultérieur quand
 * tous les pollers liront ClientSignalConfig.
 *
 * Lancer : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/migrate-disabled-sources-to-config.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") {
    return require.resolve("./_server-only-stub.js");
  }
  return originalResolve.call(this, request, ...args);
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { db } = await import("../src/lib/db");

  console.log(`🔄 Migration icp.disabledSources → ClientSignalConfig`);
  console.log(`   ${dryRun ? "DRY RUN" : "WRITE"}\n`);

  // Build mapping sourceCode → SignalCatalog rows
  const catalog = await db.signalCatalog.findMany({
    select: { id: true, code: true, sourceCodes: true },
  });
  const sourceCodeToSignal = new Map<string, Array<{ id: string; code: string }>>();
  for (const sig of catalog) {
    for (const sc of sig.sourceCodes ?? []) {
      const existing = sourceCodeToSignal.get(sc) ?? [];
      existing.push({ id: sig.id, code: sig.code });
      sourceCodeToSignal.set(sc, existing);
    }
  }

  // Itérer sur les clients ACTIVE/PROSPECT
  const clients = await db.client.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } },
    select: { id: true, slug: true, icp: true },
  });

  let migrated = 0;
  let skippedUnknown = 0;

  for (const c of clients) {
    const icp = c.icp as { disabledSources?: string[] } | null;
    const disabled = icp?.disabledSources ?? [];
    if (disabled.length === 0) {
      console.log(`  • ${c.slug.padEnd(15)} — aucun signal désactivé`);
      continue;
    }
    console.log(`  • ${c.slug.padEnd(15)} — ${disabled.length} source(s) désactivée(s) :`);
    for (const sc of disabled) {
      const signals = sourceCodeToSignal.get(sc);
      if (!signals || signals.length === 0) {
        console.log(`      ⚠️  ${sc} — aucun signal du catalogue ne contient ce sourceCode`);
        skippedUnknown += 1;
        continue;
      }
      for (const sig of signals) {
        console.log(`      ↳ ${sc} → ${sig.code}`);
        if (!dryRun) {
          await db.clientSignalConfig.upsert({
            where: {
              clientId_signalId: { clientId: c.id, signalId: sig.id },
            },
            update: { enabled: false },
            create: {
              clientId: c.id,
              signalId: sig.id,
              enabled: false,
              parameters: {},
            },
          });
        }
        migrated += 1;
      }
    }
  }

  console.log(
    `\n✅ ${dryRun ? "DRY RUN" : "DONE"} — ${migrated} ClientSignalConfig créés/mis à jour, ${skippedUnknown} sourceCodes inconnus`,
  );

  if (!dryRun) {
    const total = await db.clientSignalConfig.count();
    const disabled = await db.clientSignalConfig.count({ where: { enabled: false } });
    console.log(`\n📊 État ClientSignalConfig :`);
    console.log(`   Total : ${total}`);
    console.log(`   Désactivés : ${disabled}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
