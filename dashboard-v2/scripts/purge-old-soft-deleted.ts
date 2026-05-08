// @ts-nocheck — Sprint Perfection P4 (08/05/2026)
//
// TTL cleanup : hard-delete les Trigger avec deletedAt < NOW() - 90j.
// Complémente le soft-delete progressif (deletedAt set) pour empêcher
// l'accumulation infinie de triggers fantômes en DB.
//
// État au 08/05 : 519 triggers soft-deleted, 0 dépassent 90j (préventif).
// Au rythme actuel (~50/sem soft-deleted), on atteindra 0 >90j naturel
// dans ~3 mois. Sans ce cron, la table grossit indéfiniment.
//
// Cleanup associé :
//   - Lead avec triggerId pointant vers Trigger purgé → également hard-delete
//     (ON DELETE CASCADE pas posé sur la FK, on le fait manuellement)
//   - EmailActivity / LeadActivity / Opportunity liées → cascade Prisma
//     gère via les relations onDelete: Cascade (à vérifier schema.prisma)
//
// Usage :
//   cd /opt/moltbot/dashboard-v2
//   npx tsx scripts/purge-old-soft-deleted.ts             # dry-run
//   npx tsx scripts/purge-old-soft-deleted.ts --apply     # exécution
//
// Cron suggéré : 0 4 * * * /usr/bin/npx tsx scripts/purge-old-soft-deleted.ts --apply >> /var/log/ifind-purge.log 2>&1

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const APPLY = process.argv.includes("--apply");
const TTL_DAYS = 90;

(async () => {
  const { db } = await import("../src/lib/db");

  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000);
  console.log(`\n=== PURGE soft-deleted > ${TTL_DAYS}j (mode: ${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`Cutoff date : ${cutoff.toISOString()}\n`);

  // Triggers candidats à hard-delete
  const candidateTriggers = await db.trigger.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true, companyName: true, deletedAt: true, sourceCode: true },
  });
  console.log(`Triggers à purger : ${candidateTriggers.length}`);

  // Leads liés (deletedAt aussi probablement, mais on vérifie)
  const candidateLeadIds = await db.lead.findMany({
    where: { triggerId: { in: candidateTriggers.map((t) => t.id) } },
    select: { id: true },
  });
  console.log(`Leads liés à purger : ${candidateLeadIds.length}`);

  if (!APPLY) {
    console.log(`\nSample 5 triggers candidats :`);
    for (const t of candidateTriggers.slice(0, 5)) {
      console.log(`  ${t.id} : ${t.companyName} (${t.sourceCode}, deletedAt=${t.deletedAt?.toISOString()})`);
    }
    console.log(`\n⚠️ DRY-RUN. Aucune modification. --apply pour exécuter.`);
    await db.$disconnect();
    process.exit(0);
  }

  if (candidateTriggers.length === 0) {
    console.log(`\nAucun trigger >${TTL_DAYS}j à purger. No-op.`);
    await db.$disconnect();
    process.exit(0);
  }

  // Exécution : delete cascadé
  // 1. Lead.delete (Prisma onDelete cascade gère les EmailActivity, LeadActivity)
  // 2. Trigger.delete
  console.log(`\n=== EXÉCUTION ===\n`);

  const triggerIds = candidateTriggers.map((t) => t.id);
  const leadIds = candidateLeadIds.map((l) => l.id);

  // Delete par chunks de 50 pour éviter timeout DB
  const CHUNK = 50;
  let leadsDeleted = 0;
  let triggersDeleted = 0;

  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const r = await db.lead.deleteMany({ where: { id: { in: chunk } } });
    leadsDeleted += r.count;
  }
  console.log(`  Leads hard-deleted : ${leadsDeleted}`);

  for (let i = 0; i < triggerIds.length; i += CHUNK) {
    const chunk = triggerIds.slice(i, i + CHUNK);
    const r = await db.trigger.deleteMany({ where: { id: { in: chunk } } });
    triggersDeleted += r.count;
  }
  console.log(`  Triggers hard-deleted : ${triggersDeleted}`);

  console.log(`\n=== RÉCAP ===`);
  console.log(`  Leads purged : ${leadsDeleted}`);
  console.log(`  Triggers purged : ${triggersDeleted}`);

  // Vérif post-purge
  const remaining = await db.trigger.count({
    where: { deletedAt: { not: null, lt: cutoff } },
  });
  console.log(`  Résiduels après purge : ${remaining}`);

  await db.$disconnect();
  process.exit(0);
})();
