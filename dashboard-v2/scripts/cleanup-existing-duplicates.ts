// @ts-nocheck — Sprint Perfection P3 cleanup (08/05/2026)
//
// Cleanup script : fusionne les doublons (clientId, companySiret) NEW
// existants en DB AVANT que le hook P3 ne soit live.
//
// Cas observés DTL 08/05 :
//   - Asys (348284977) : 2 triggers NEW score=10 et =7
//   - Synanto (994856532) : 2 IGNORED score=2 et =10 (dont 1 avec [Combo apify+theirstack])
//
// Usage :
//   cd /opt/moltbot/dashboard-v2
//   npx tsx scripts/cleanup-existing-duplicates.ts             # dry-run
//   npx tsx scripts/cleanup-existing-duplicates.ts --apply     # exécution réelle

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const APPLY = process.argv.includes("--apply");

(async () => {
  const { db } = await import("../src/lib/db");
  const { mergeDuplicateTriggersBySiret } = await import("../src/lib/trigger-dedup");

  console.log(`\n=== CLEANUP DOUBLONS — mode: ${APPLY ? "APPLY" : "DRY-RUN"} ===\n`);

  // Trouve tous les groupes (clientId, siret) avec >1 trigger non-deleted
  const dups = await db.$queryRawUnsafe(`
    SELECT "clientId", "companySiret", COUNT(*) as n,
           array_agg(id ORDER BY score DESC, "capturedAt" ASC) as ids,
           array_agg(score ORDER BY score DESC, "capturedAt" ASC) as scores,
           array_agg("sourceCode" ORDER BY score DESC, "capturedAt" ASC) as sources,
           array_agg(status ORDER BY score DESC, "capturedAt" ASC) as statuses
    FROM "Trigger"
    WHERE "deletedAt" IS NULL AND "companySiret" IS NOT NULL
      AND "companySiret" ~ '^[0-9]+$'
    GROUP BY "clientId", "companySiret"
    HAVING COUNT(*) > 1
    ORDER BY n DESC
  `);

  console.log(`Doublons trouvés : ${dups.length} groupes`);
  for (const d of dups) {
    console.log(`\n  Group siret=${d.companySiret} (${d.n} triggers) :`);
    for (let i = 0; i < d.ids.length; i += 1) {
      console.log(`    - ${d.ids[i]} src=${d.sources[i]} score=${d.scores[i]} status=${d.statuses[i]}`);
    }
  }

  if (!APPLY) {
    console.log("\n⚠️ DRY-RUN. Aucune modification. Relance avec --apply pour exécuter.");
    await db.$disconnect();
    process.exit(0);
  }

  console.log("\n=== EXÉCUTION FUSION ===\n");

  let mergedCount = 0;
  let groupsProcessed = 0;
  for (const d of dups) {
    groupsProcessed += 1;
    // On appelle mergeDuplicateTriggersBySiret sur le 1er id (= score max).
    // La fonction va trouver les autres triggers du même siret et fusionner
    // 2 par 2. Si N>2, il faut itérer.
    let pass = 0;
    while (pass < d.n) {
      const result = await mergeDuplicateTriggersBySiret(d.ids[0]);
      if (!result) break;
      mergedCount += 1;
      pass += 1;
    }
    console.log(`  Group siret=${d.companySiret} : ${pass} fusion(s) effectuée(s)`);
  }

  console.log(`\n=== RÉCAP ===`);
  console.log(`  Groupes traités : ${groupsProcessed}`);
  console.log(`  Fusions totales : ${mergedCount}`);

  // Vérif post-cleanup
  const remaining = await db.$queryRawUnsafe(`
    SELECT COUNT(*) as n FROM (
      SELECT "clientId", "companySiret"
      FROM "Trigger"
      WHERE "deletedAt" IS NULL AND "companySiret" IS NOT NULL
        AND "companySiret" ~ '^[0-9]+$'
      GROUP BY "clientId", "companySiret"
      HAVING COUNT(*) > 1
    ) t
  `);
  console.log(`  Doublons résiduels : ${remaining[0].n}`);

  await db.$disconnect();
  process.exit(0);
})();
