// @ts-nocheck — script CLI
/**
 * Réhabilitation des triggers IGNORED suite à panne Anthropic (15-17/05/2026).
 *
 * Contexte : pendant la panne Anthropic ("credit balance too low"), tous les
 * triggers traités par qualifyTrigger ont été marqués status=IGNORED avec
 * scoreReason='[v2-failed]...'. Le filtre qualifyPendingTriggers ne les
 * rejoue jamais (scoreReason != null + status != NEW) → backlog mort.
 *
 * Ce script :
 *  - sélectionne les triggers IGNORED + scoreReason commence par '[v2-failed]'
 *    + briefV2Json NULL (preuve qu'aucune vraie qualif n'a abouti)
 *  - les bascule vers status=NEW + scoreReason=null pour qu'ils repartent
 *    dans le prochain cycle qualifyPendingTriggers
 *
 * Idempotent. Safe à relancer.
 *
 * Lancer :
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/reset-v2-failed-triggers.ts          # dry-run
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/reset-v2-failed-triggers.ts --apply  # commit
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
  const { db } = await import("../src/lib/db");
  const apply = process.argv.includes("--apply");

  // Raw SQL — Prisma `startsWith: "[v2-failed]"` échoue car le `[` est mal
  // échappé en LIKE pattern (Prisma le quote en `\[` sur Postgres). On utilise
  // un LIKE direct + on inclut aussi les RE-JUDGED qui ont raté pour la
  // même raison Anthropic down (25 leads supplémentaires).
  const candidates = await db.$queryRaw<Array<{
    id: string;
    companyName: string;
    sourceCode: string;
    clientId: string;
    capturedAt: Date;
  }>>`
    SELECT id, "companyName", "sourceCode", "clientId", "capturedAt"
    FROM "Trigger"
    WHERE "deletedAt" IS NULL
      AND status = 'IGNORED'
      AND "briefV2Json" IS NULL
      AND (
        "scoreReason" LIKE '[v2-failed]%'
        OR "scoreReason" LIKE '[RE-JUDGED v2%FAILED] qualifyTrigger returned null%'
      )
    ORDER BY "capturedAt" DESC
  `;

  console.log(`📋 ${candidates.length} triggers candidats (status=IGNORED + scoreReason='[v2-failed]%' + briefV2Json=null)`);

  if (candidates.length === 0) {
    console.log("Rien à faire.");
    await db.$disconnect();
    return;
  }

  // Breakdown par client + sourceCode pour visibilité
  const byClientSource = new Map<string, number>();
  for (const c of candidates) {
    const key = `${c.clientId}|${c.sourceCode}`;
    byClientSource.set(key, (byClientSource.get(key) ?? 0) + 1);
  }
  console.log("\nBreakdown :");
  for (const [key, count] of [...byClientSource.entries()].sort((a, b) => b[1] - a[1])) {
    const [cid, src] = key.split("|");
    console.log(`  client=${cid.slice(-8)} source=${src.padEnd(30)} → ${count}`);
  }

  console.log("\nPremiers 10 exemples :");
  for (const t of candidates.slice(0, 10)) {
    console.log(`  ${t.companyName.slice(0, 40).padEnd(40)} ${t.sourceCode.padEnd(28)} ${t.capturedAt.toISOString().slice(0, 16)}`);
  }

  if (!apply) {
    console.log(`\n🟡 DRY-RUN. Relancer avec --apply pour committer.`);
    await db.$disconnect();
    return;
  }

  console.log(`\n⚙️  Apply...`);
  const result = await db.trigger.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { status: "NEW", scoreReason: null },
  });
  console.log(`✅ ${result.count} triggers réhabilités (status=NEW, scoreReason=null) — repartiront au prochain cycle qualifyPendingTriggers.`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
