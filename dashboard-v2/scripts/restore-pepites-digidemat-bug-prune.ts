// @ts-nocheck — Restauration 5 Pépites Digidemat soft-deleted le 20/05/2026
// 08:22 UTC par le bug regex /it/i dans theirstack-poller.ts:956 (matche
// "Collectivités" via substring "it"). Patch poussé dans le même commit.
//
// Actions :
//  - 4 triggers BOAMP soft-deleted (CNFPT, CD Calvados, CH Lens, SICIO)
//    → deletedAt=null + status=NEW + scoreReason re-aligné sur briefV2.verdict OUI
//  - 1 trigger UCANSS status=IGNORED (pas deletedAt) avec briefV2 OUI 88%
//    → status=NEW (la qualif initiale a marqué IGNORED par un autre chemin)
//  - Lead UCANSS NEW déjà créé mais vide → laissé tel quel pour enrichissement
//    HarvestAPI.
//  - Triggers SICIO : on garde le OUI 82% mais on laisse le NON 88% (titres
//    restaurant hors scope) en IGNORED + deletedAt.
//
// Usage : DRY_RUN=1 par défaut. APPLY=1 pour appliquer.

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const APPLY = process.argv.includes("--apply");

// Triggers identifiés à restaurer (voir check-pepites-deep.ts output)
const RESTORE = [
  { name: "UCANSS", siret: "784621435", expectVerdict: "OUI", keepDeleted: false },
  { name: "CNFPT", siret: "180014045", expectVerdict: "OUI", keepDeleted: false },
  { name: "CD Calvados", siret: "517974432", expectVerdict: "OUI", keepDeleted: false },
  { name: "CH Lens", siret: "266209329", expectVerdict: "OUI", keepDeleted: false },
  { name: "SICIO", siret: "259400117", expectVerdict: "OUI", keepDeleted: false }, // OUI 82% seul, le NON 88% reste deleted
];

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digidemat" },
    select: { id: true },
  });
  if (!client) process.exit(1);

  let restored = 0;
  let skipped = 0;

  for (const target of RESTORE) {
    console.log(`\n━━━ ${target.name} (SIRET ${target.siret}) ━━━`);

    const triggers = await db.trigger.findMany({
      where: { clientId: client.id, companySiret: target.siret },
      select: {
        id: true,
        sourceCode: true,
        title: true,
        score: true,
        status: true,
        deletedAt: true,
        ignoredAt: true,
        ignoredReason: true,
        briefV2Json: true,
      },
      orderBy: { capturedAt: "desc" },
    });

    for (const t of triggers) {
      const brief = (t.briefV2Json ?? {}) as any;
      const verdict = brief.verdict;
      const conf = brief.confidence;

      // Cas SICIO trigger NON 88% titres restaurant → on laisse en IGNORED+deletedAt
      if (verdict === "NON") {
        console.log(`  [keep IGNORED] ${t.sourceCode} verdict=NON conf=${conf}`);
        skipped++;
        continue;
      }

      // Cas attendu : verdict OUI/ENRICH avec status IGNORED ou deletedAt
      if (verdict !== "OUI" && verdict !== "ENRICH") {
        console.log(`  [skip — verdict inconnu] verdict=${verdict ?? "—"}`);
        skipped++;
        continue;
      }

      const needsRestore = t.deletedAt != null || t.status === "IGNORED";
      if (!needsRestore) {
        console.log(`  [skip — already healthy] status=${t.status}`);
        skipped++;
        continue;
      }

      console.log(`  RESTORE ${t.sourceCode} verdict=${verdict} conf=${conf} (was status=${t.status} deletedAt=${t.deletedAt?.toISOString() ?? "—"})`);
      const newScoreReason = `[V2 ${verdict} conf=${conf}] ${(brief.thesis ?? "").slice(0, 250)} [restored 20/05 bug-prune-regex-it]`.slice(0, 500);

      if (APPLY) {
        await db.trigger.update({
          where: { id: t.id },
          data: {
            deletedAt: null,
            ignoredAt: null,
            ignoredReason: null,
            status: "NEW",
            scoreReason: newScoreReason,
          },
        });
        // Restaurer aussi les Leads orphelins
        await db.lead.updateMany({
          where: { triggerId: t.id, deletedAt: { not: null } },
          data: { deletedAt: null, status: "NEW" },
        });
        restored++;
      } else {
        restored++;
      }
    }
  }

  console.log(`\n${APPLY ? "✓ APPLIED" : "(DRY-RUN)"} : restored=${restored} skipped=${skipped}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
