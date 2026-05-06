// @ts-nocheck — script CLI de backfill
/**
 * Sprint B.6 — Backfill qualify DTL + mesure delta précision pré/post Sprint B.
 *
 * Workflow :
 * 1. Snapshot état actuel (score, scoreReason, status, isHot) de tous les
 *    Triggers DTL qualifiés (scoreReason != null).
 * 2. Re-run qualifyTrigger(force=true) sur chacun pour appliquer le nouveau
 *    prompt enrichi (CLIENT ENRICHED Fred + signalPrimary + redFlagsHard).
 * 3. Compare avant/après : distribution scores, transitions NEW↔ARCHIVED,
 *    top 20 inversions (positives = leads recovered, négatives = leads jetés).
 * 4. Écrit rapport JSON + Markdown dans /tmp/backfill-dtl-06mai.{json,md}.
 *
 * Run en série (pas parallèle) pour respecter rate limits Anthropic Opus.
 * Coût estimé : 128 × ~$0.01 = ~$1.30. Latence : ~10-15 min.
 *
 * Idempotent : peut être ré-exécuté pour mesurer drift (cache 5 min Anthropic).
 *
 * Usage : npx tsx scripts/backfill-qualify-dtl.ts [--limit=30] [--dry-run]
 */
import Module from "node:module";
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
import * as fs from "node:fs";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const argv = process.argv.slice(2);
const LIMIT = parseInt(argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "150", 10);
const DRY_RUN = argv.includes("--dry-run");

interface Snapshot {
  triggerId: string;
  companyName: string;
  sourceCode: string;
  type: string;
  scoreBefore: number;
  scoreReasonBefore: string;
  statusBefore: string;
  isHotBefore: boolean;
  scoreAfter: number | null;
  scoreReasonAfter: string | null;
  statusAfter: string | null;
  isHotAfter: boolean | null;
  delta: number | null;
  error: string | null;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");

  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!client) throw new Error("DTL introuvable");

  const triggers = await db.trigger.findMany({
    where: {
      clientId: client.id,
      deletedAt: null,
      scoreReason: { not: null },
    },
    select: {
      id: true,
      companyName: true,
      sourceCode: true,
      type: true,
      score: true,
      scoreReason: true,
      status: true,
      isHot: true,
    },
    orderBy: { capturedAt: "desc" },
    take: LIMIT,
  });

  console.log(`📋 ${triggers.length} Triggers DTL à backfill ${DRY_RUN ? "(DRY-RUN)" : "(LIVE)"}`);
  console.log(`   Estimation coût Anthropic : ~$${(triggers.length * 0.01).toFixed(2)}`);
  console.log(`   Estimation latence : ~${Math.round(triggers.length * 0.1)} min\n`);

  const snapshots: Snapshot[] = [];
  let i = 0;
  for (const t of triggers) {
    i += 1;
    const snap: Snapshot = {
      triggerId: t.id,
      companyName: t.companyName ?? "?",
      sourceCode: t.sourceCode,
      type: t.type,
      scoreBefore: t.score,
      scoreReasonBefore: (t.scoreReason ?? "").slice(0, 200),
      statusBefore: t.status,
      isHotBefore: t.isHot,
      scoreAfter: null,
      scoreReasonAfter: null,
      statusAfter: null,
      isHotAfter: null,
      delta: null,
      error: null,
    };

    if (DRY_RUN) {
      snapshots.push(snap);
      continue;
    }

    try {
      const r = await qualifyTrigger(t.id, { force: true });
      // Re-fetch pour avoir status final (peut avoir été IGNORED par C3 minScore)
      const updated = await db.trigger.findUnique({
        where: { id: t.id },
        select: { score: true, scoreReason: true, status: true, isHot: true },
      });
      if (r && updated) {
        snap.scoreAfter = updated.score;
        snap.scoreReasonAfter = (updated.scoreReason ?? "").slice(0, 200);
        snap.statusAfter = updated.status;
        snap.isHotAfter = updated.isHot;
        snap.delta = updated.score - t.score;
      } else {
        snap.error = "qualifyTrigger returned null";
      }
    } catch (e) {
      snap.error = e instanceof Error ? e.message : String(e);
    }

    snapshots.push(snap);

    // Progress every 10
    if (i % 10 === 0 || i === triggers.length) {
      const errs = snapshots.filter((s) => s.error).length;
      console.log(`   [${i}/${triggers.length}] errs=${errs}`);
    }
  }

  // Aggregations
  const ok = snapshots.filter((s) => s.error === null && s.scoreAfter !== null);
  const errs = snapshots.filter((s) => s.error !== null);
  const inversions = ok
    .filter((s) => Math.abs(s.delta ?? 0) >= 2)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .slice(0, 30);
  const recoveredArchivedToNew = ok.filter((s) => s.statusBefore === "ARCHIVED" && s.statusAfter === "NEW");
  const droppedNewToArchived = ok.filter((s) => s.statusBefore === "NEW" && s.statusAfter === "IGNORED");

  // Distribution score (before / after)
  const distBefore: Record<number, number> = {};
  const distAfter: Record<number, number> = {};
  for (let s = 1; s <= 10; s++) {
    distBefore[s] = ok.filter((x) => x.scoreBefore === s).length;
    distAfter[s] = ok.filter((x) => x.scoreAfter === s).length;
  }

  // Reports
  const summary = {
    timestamp: new Date().toISOString(),
    client: client.name,
    triggersScanned: triggers.length,
    successful: ok.length,
    errors: errs.length,
    distribution: { before: distBefore, after: distAfter },
    transitions: {
      recoveredArchivedToNew: recoveredArchivedToNew.length,
      droppedNewToArchived: droppedNewToArchived.length,
    },
    avgScoreBefore: ok.length > 0 ? (ok.reduce((s, x) => s + x.scoreBefore, 0) / ok.length).toFixed(2) : "0",
    avgScoreAfter: ok.length > 0 ? (ok.reduce((s, x) => s + (x.scoreAfter ?? 0), 0) / ok.length).toFixed(2) : "0",
  };

  console.log("\n=== 📊 RESULTS ===");
  console.log(JSON.stringify(summary, null, 2));

  // Top inversions
  console.log("\n=== TOP 20 INVERSIONS (|delta| ≥ 2) ===");
  for (const inv of inversions.slice(0, 20)) {
    const arrow = (inv.delta ?? 0) > 0 ? "🟢 ↑" : "🔴 ↓";
    console.log(`${arrow} ${inv.companyName.slice(0, 35).padEnd(35)} ${inv.scoreBefore} → ${inv.scoreAfter} (${inv.statusBefore}→${inv.statusAfter}) [${inv.sourceCode}]`);
    console.log(`   AVANT : ${inv.scoreReasonBefore.slice(0, 120)}`);
    console.log(`   APRÈS : ${(inv.scoreReasonAfter ?? "").slice(0, 120)}`);
  }

  if (recoveredArchivedToNew.length > 0) {
    console.log(`\n=== 🟢 RECOVERED ARCHIVED → NEW (${recoveredArchivedToNew.length}) ===`);
    for (const r of recoveredArchivedToNew.slice(0, 15)) {
      console.log(`   ${r.companyName.slice(0, 35).padEnd(35)} ${r.scoreBefore} → ${r.scoreAfter}`);
    }
  }
  if (droppedNewToArchived.length > 0) {
    console.log(`\n=== 🔴 DROPPED NEW → IGNORED (${droppedNewToArchived.length}) ===`);
    for (const r of droppedNewToArchived.slice(0, 15)) {
      console.log(`   ${r.companyName.slice(0, 35).padEnd(35)} ${r.scoreBefore} → ${r.scoreAfter}`);
    }
  }

  // Persist
  const outJson = `/tmp/backfill-dtl-06mai.json`;
  fs.writeFileSync(outJson, JSON.stringify({ summary, snapshots }, null, 2));
  console.log(`\n💾 Détails JSON : ${outJson}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
