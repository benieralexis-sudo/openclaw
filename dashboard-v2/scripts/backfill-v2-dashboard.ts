// @ts-nocheck — Audit 10/05 backfill V2 sur leads dashboard sans verdict
//
// Cible : les triggers visibles dashboard (status != IGNORED, deletedAt null,
// linked Lead actif) qui n'ont pas de briefV2Json → 8 leads identifiés audit
// 10/05 (SQUAREMIND, Asys, Dastra, Diabolocom, GitGuardian, StrangeBee,
// HrFlow.ai, Training Orchestra, OpsMill).
//
// Logique : reproduit qualifyTriggerV2Shadow (privée dans qualify-trigger.ts) :
//   - call qualifyTriggerV2WithValidation
//   - écrit briefV2Json
//   - si V2 NON shippable + V1 NEW → status=IGNORED + archive Lead
//   - sinon respecte V1
//
// Usage:
//   cd /opt/moltbot/dashboard-v2
//   npx tsx scripts/backfill-v2-dashboard.ts          # live
//   npx tsx scripts/backfill-v2-dashboard.ts dry-run  # n'écrit pas

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const DRY_RUN = process.argv[2] === "dry-run";

(async () => {
  const { db } = await import("../src/lib/db");
  const { qualifyTriggerV2WithValidation } = await import("../src/lib/qualify-trigger");

  console.log(`\n=== BACKFILL V2 — Audit dashboard 10/05 ===`);
  console.log(`Mode : ${DRY_RUN ? "DRY-RUN" : "LIVE"}\n`);

  // Récup triggers visibles dashboard puis filtre in-process (Prisma JSON null
  // filter friction). On joint Lead pour ne garder que ceux avec un Lead actif.
  const allActive = await db.trigger.findMany({
    where: {
      deletedAt: null,
      status: { not: "IGNORED" },
    },
    select: {
      id: true,
      companyName: true,
      score: true,
      status: true,
      sourceCode: true,
      briefV2Json: true,
      lead: { select: { id: true, deletedAt: true } },
    },
    orderBy: { score: "desc" },
  });
  const triggers = allActive.filter(
    (t) => t.briefV2Json == null && t.lead && t.lead.deletedAt == null,
  );

  console.log(`Trouvé ${triggers.length} triggers dashboard sans V2 :\n`);
  for (const t of triggers) {
    console.log(`  ${t.companyName.padEnd(25)} score=${t.score} src=${t.sourceCode}`);
  }
  console.log();

  if (triggers.length === 0) {
    console.log("Rien à faire.");
    process.exit(0);
  }

  const results: Array<{
    company: string;
    v1Score: number;
    v2Verdict: string | null;
    v2Conf: number | null;
    shippable: boolean;
    overrideApplied: boolean;
  }> = [];

  for (const t of triggers) {
    process.stdout.write(`Processing ${t.companyName.padEnd(25)} ... `);
    try {
      const result = await qualifyTriggerV2WithValidation(t.id);
      if (!result.brief) {
        console.log(`no-brief (${result.reason ?? "?"})`);
        results.push({
          company: t.companyName,
          v1Score: t.score,
          v2Verdict: null,
          v2Conf: null,
          shippable: false,
          overrideApplied: false,
        });
        continue;
      }

      const v2 = result.brief;
      console.log(
        `V2=${v2.verdict} conf=${v2.confidence} shippable=${result.shippable}`,
      );

      if (DRY_RUN) {
        results.push({
          company: t.companyName,
          v1Score: t.score,
          v2Verdict: v2.verdict,
          v2Conf: v2.confidence,
          shippable: result.shippable,
          overrideApplied: false,
        });
        continue;
      }

      // Écrit briefV2Json + override si V2=NON shippable + V1=NEW
      const updates: any = { briefV2Json: v2 };
      let overrideApplied = false;
      if (result.shippable && v2.verdict === "NON" && t.status === "NEW") {
        const v2Header = `[V2-override:NON conf=${v2.confidence}] ${v2.thesis.slice(0, 200)}`;
        updates.status = "IGNORED";
        updates.scoreReason = `${v2Header} | V1 score=${t.score}`;
        overrideApplied = true;
      }
      await db.trigger.update({ where: { id: t.id }, data: updates });

      // Sync Lead.status si V2 a forcé IGNORED
      if (overrideApplied) {
        await db.lead.updateMany({
          where: {
            triggerId: t.id,
            deletedAt: null,
            status: { notIn: ["ARCHIVED", "NOT_INTERESTED", "CONTACTED", "CONTACTABLE"] },
          },
          data: { status: "ARCHIVED" },
        });
      }

      results.push({
        company: t.companyName,
        v1Score: t.score,
        v2Verdict: v2.verdict,
        v2Conf: v2.confidence,
        shippable: result.shippable,
        overrideApplied,
      });
    } catch (e: any) {
      console.log(`ERR: ${e.message}`);
      results.push({
        company: t.companyName,
        v1Score: t.score,
        v2Verdict: "ERROR",
        v2Conf: null,
        shippable: false,
        overrideApplied: false,
      });
    }
  }

  // Récap final
  console.log(`\n=== RÉCAP ===\n`);
  console.log(`${"Company".padEnd(25)} V1   V2          Conf  Override`);
  console.log("-".repeat(70));
  for (const r of results) {
    console.log(
      `${r.company.padEnd(25)} ${String(r.v1Score).padEnd(4)} ${(r.v2Verdict ?? "?").padEnd(11)} ${
        r.v2Conf !== null ? String(r.v2Conf).padEnd(5) : "-    "
      } ${r.overrideApplied ? "→ IGNORED" : ""}`,
    );
  }
  console.log();

  const ouiCount = results.filter((r) => r.v2Verdict === "OUI").length;
  const nonCount = results.filter((r) => r.v2Verdict === "NON").length;
  const enrichCount = results.filter((r) => r.v2Verdict === "ENRICH").length;
  const overrideCount = results.filter((r) => r.overrideApplied).length;
  console.log(
    `OUI=${ouiCount} | NON=${nonCount} | ENRICH=${enrichCount} | overrides V2-NON=${overrideCount}`,
  );

  process.exit(0);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
