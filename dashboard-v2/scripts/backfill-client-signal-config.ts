// @ts-nocheck — script CLI, types stricts non requis
/**
 * Backfill ClientSignalConfig pour chaque client × signal du catalogue
 * (Sprint catalogue P1.6, 17/05/2026).
 *
 * Objectif : créer une ligne ClientSignalConfig pour chaque (client, signal),
 * en migrant les paramètres legacy depuis Client.icp vers
 * ClientSignalConfig.parameters quand pertinent.
 *
 * Mapping migration :
 *   - P1 (Hire role X) : keywords ← icp.keywordsHiring
 *                        regions ← icp.regions
 *                        titleFilterInclude/Exclude ← icp.titleFilter*
 *                        romeCodes ← icp.francetravailRomeCodes
 *   - P3 (Stack tech) : industries ← icp.industries
 *                       sizes ← icp.sizes
 *   - P2, P4, P5, B1-B7, C1-C4 : params catalogue defaults (sauf si déjà
 *     configurés via UPSERT précédents — ex P2 missingRoles).
 *
 * Idempotent : ON CONFLICT (clientId, signalId) → ne touche pas si déjà
 * configuré explicitement avec parameters non vides.
 *
 * isPillar par défaut :
 *   - DTL : P1 (hire QA) + P2 (gap QA) + B1 (levée) — 3 piliers
 *   - iFIND : P1 (hire Sales) + P2 (gap Sales) + B1 (levée) — 3 piliers
 *
 * Lancer : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/backfill-client-signal-config.ts [--dry-run]
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

const PILLAR_BY_CLIENT: Record<string, string[]> = {
  digitestlab: ["P1", "P2", "B1"],
  ifind: ["P1", "P2", "B1"],
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { db } = await import("../src/lib/db");

  console.log(`🔄 Backfill ClientSignalConfig × clients × signaux`);
  console.log(`   ${dryRun ? "DRY RUN" : "WRITE"}\n`);

  const catalog = await db.signalCatalog.findMany({
    select: { id: true, code: true, parameters: true, category: true },
  });

  const clients = await db.client.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } },
    select: { id: true, slug: true, icp: true },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of clients) {
    const icp = (c.icp ?? {}) as Record<string, unknown>;
    const pillarCodes = PILLAR_BY_CLIENT[c.slug] ?? [];
    console.log(`\n• ${c.slug} (${c.id})`);

    for (const sig of catalog) {
      // Calcul des paramètres pour ce signal × ce client
      let params: Record<string, unknown> = {};

      if (sig.code === "P1") {
        const keywords = Array.isArray(icp.keywordsHiring) ? icp.keywordsHiring : [];
        const regions = Array.isArray(icp.regions) ? icp.regions : [];
        params = {
          keywords,
          regions,
          jobLevels: ["Senior", "Head", "CXO"],
          ...(icp.titleFilterInclude && { titleFilterInclude: icp.titleFilterInclude }),
          ...(icp.titleFilterExclude && { titleFilterExclude: icp.titleFilterExclude }),
          ...(Array.isArray(icp.francetravailRomeCodes) && icp.francetravailRomeCodes.length > 0 && {
            romeCodes: icp.francetravailRomeCodes,
          }),
        };
      } else if (sig.code === "P3") {
        const industries = Array.isArray(icp.industries) ? icp.industries : [];
        const sizes = Array.isArray(icp.sizes) ? icp.sizes : [];
        params = { industries, sizes };
      } else {
        // Autres signaux : on garde les defaults du catalogue (ne pas écraser)
        params = {};
      }

      const isPillar = pillarCodes.includes(sig.code);

      // Check existant
      const existing = await db.clientSignalConfig.findUnique({
        where: { clientId_signalId: { clientId: c.id, signalId: sig.id } },
      });

      if (existing) {
        // Si paramètres explicites déjà configurés via UPSERT précédent
        // (ex P2 missingRoles, P3 disabled), on ne touche pas — sauf P1
        // où on veut overwrite avec les valeurs ICP fraiches.
        const existingParams = existing.parameters as Record<string, unknown>;
        const hasExplicitParams = Object.keys(existingParams).length > 0;

        if (sig.code === "P1" && Object.keys(params).length > 0) {
          // Force update P1 avec les valeurs ICP fraiches
          if (!dryRun) {
            await db.clientSignalConfig.update({
              where: { id: existing.id },
              data: { parameters: params, isPillar },
            });
          }
          console.log(`  ↻ ${sig.code} updated (P1 from icp)`);
          updated += 1;
        } else if (sig.code === "P3" && !hasExplicitParams) {
          // P3 : si pas déjà configuré, on copie depuis icp
          if (!dryRun) {
            await db.clientSignalConfig.update({
              where: { id: existing.id },
              data: { parameters: params, isPillar },
            });
          }
          console.log(`  ↻ ${sig.code} updated (P3 from icp)`);
          updated += 1;
        } else {
          console.log(`  ✓ ${sig.code} skipped (already configured)`);
          skipped += 1;
        }
        continue;
      }

      // Création
      if (!dryRun) {
        await db.clientSignalConfig.create({
          data: {
            clientId: c.id,
            signalId: sig.id,
            enabled: true,
            isPillar,
            parameters: params,
          },
        });
      }
      const pillarBadge = isPillar ? "★" : " ";
      console.log(`  + ${sig.code} created ${pillarBadge}${Object.keys(params).length > 0 ? ` (${Object.keys(params).length} params)` : ""}`);
      created += 1;
    }
  }

  console.log(`\n✅ ${dryRun ? "DRY RUN" : "DONE"} — ${created} créés, ${updated} mis à jour, ${skipped} skippés`);

  if (!dryRun) {
    const total = await db.clientSignalConfig.count();
    const pillars = await db.clientSignalConfig.count({ where: { isPillar: true } });
    const disabled = await db.clientSignalConfig.count({ where: { enabled: false } });
    console.log(`\n📊 État final :`);
    console.log(`   Total ClientSignalConfig : ${total}`);
    console.log(`   Piliers : ${pillars}`);
    console.log(`   Désactivés : ${disabled}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
