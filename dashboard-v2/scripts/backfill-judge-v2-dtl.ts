// @ts-nocheck — Sprint D.6 backfill (07/05/2026)
//
// Backfill 50 triggers DTL variés (mix v1Score) avec qualifyTriggerV2 dormant
// + écriture Trigger.briefV2Json pour audit ultérieur (Sprint D.4 UI markdown
// va lire ce champ).
//
// Sélection :
//   - 15 triggers score ≥ 7 (Brûlants/Très chauds V1)
//   - 15 triggers score 5-6 (zone grise V1)
//   - 15 triggers score 1-4 (rejetés V1)
//   -  5 triggers score=null (pas encore qualifiés V1)
// Total = 50.
//
// Mesures :
//   - Zod-valid rate
//   - Matrice concordance v1↔v2 (3 ranges × 4 verdicts incl. null)
//   - Top disaccords (v1 score≥7 mais v2 NON, v1 score≤4 mais v2 OUI)
//   - Coût Opus total + cache hit rate
//   - Latence stats
//
// Usage :
//   cd /opt/moltbot/dashboard-v2
//   npx tsx scripts/backfill-judge-v2-dtl.ts          # 50 triggers, écrit briefV2Json
//   npx tsx scripts/backfill-judge-v2-dtl.ts dry-run  # 50 triggers, n'écrit PAS
//
// Coût estimé : ~$0.06 × 50 = ~$3.

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
  const { qualifyTriggerV2 } = await import("../src/lib/qualify-trigger");
  const { isLeadBriefV2 } = await import("../src/lib/lead-brief-v2");

  console.log(`\n=== BACKFILL JUDGE V2 — Sprint D.6 ===`);
  console.log(`Mode : ${DRY_RUN ? "DRY-RUN (pas d'écriture DB)" : "LIVE (écrit Trigger.briefV2Json)"}\n`);

  const dtl = await db.client.findFirst({
    where: { name: { contains: "Digi", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!dtl) {
    console.error("Client DigiTestLab introuvable. Abandon.");
    process.exit(2);
  }
  console.log(`Client : ${dtl.name} (${dtl.id})\n`);

  // Note : briefV2Json IS NULL filter géré en post-process (Prisma JSON nullable
  // filter = lourd ; sample stratifié + slice rend la pollution improbable).
  const baseWhere = {
    clientId: dtl.id,
    deletedAt: null,
  };

  // Sample stratifié — diversifier sourceCode pour éviter biais (sinon que des theirstack/apify)
  // Pool "score=null" abandonné (Prisma JsonNull/null filter friction sans gain notable
  // pour l'audit concordance). On reste sur 45 triggers triés en 3 ranges scorés.
  const [hotPool, midPool, lowPool] = await Promise.all([
    db.trigger.findMany({
      where: { ...baseWhere, score: { gte: 7 } },
      select: { id: true, score: true, scoreReason: true, companyName: true, sourceCode: true, status: true },
      orderBy: { capturedAt: "desc" },
      take: 30,
    }),
    db.trigger.findMany({
      where: { ...baseWhere, score: { gte: 5, lte: 6 } },
      select: { id: true, score: true, scoreReason: true, companyName: true, sourceCode: true, status: true },
      orderBy: { capturedAt: "desc" },
      take: 30,
    }),
    db.trigger.findMany({
      where: { ...baseWhere, score: { gte: 1, lte: 4 } },
      select: { id: true, score: true, scoreReason: true, companyName: true, sourceCode: true, status: true },
      orderBy: { capturedAt: "desc" },
      take: 30,
    }),
  ]);

  // Diversification sourceCode : prendre max 5 par sourceCode dans chaque pool
  const dedup = (pool: typeof hotPool, maxPerSource = 5) => {
    const counts: Record<string, number> = {};
    return pool.filter((t) => {
      const c = counts[t.sourceCode] ?? 0;
      if (c >= maxPerSource) return false;
      counts[t.sourceCode] = c + 1;
      return true;
    });
  };

  const sample = [
    ...dedup(hotPool).slice(0, 17),
    ...dedup(midPool).slice(0, 17),
    ...dedup(lowPool).slice(0, 16),
  ];

  console.log(`Sample stratifié : ${sample.length} triggers`);
  console.log(`  - score≥7 : ${sample.filter((t) => t.score && t.score >= 7).length}`);
  console.log(`  - score 5-6 : ${sample.filter((t) => t.score && t.score >= 5 && t.score <= 6).length}`);
  console.log(`  - score 1-4 : ${sample.filter((t) => t.score && t.score >= 1 && t.score <= 4).length}`);
  console.log(`  - score null : ${sample.filter((t) => t.score === null).length}\n`);

  // Distribution sourceCode
  const srcCounts: Record<string, number> = {};
  for (const t of sample) srcCounts[t.sourceCode] = (srcCounts[t.sourceCode] ?? 0) + 1;
  console.log(`Sources : ${Object.entries(srcCounts).map(([k, v]) => `${k}=${v}`).join(", ")}\n`);

  if (sample.length === 0) {
    console.log("Aucun trigger candidat (peut-être déjà backfillés). Fin.");
    await db.$disconnect();
    return;
  }

  const results: Array<{
    triggerId: string;
    company: string | null;
    sourceCode: string;
    v1Score: number | null;
    v1Reason: string;
    v1Status: string;
    v2Brief: any;
    v2Valid: boolean;
    durationMs: number;
    inTokens: number;
    outTokens: number;
    cacheCreate: number;
    cacheRead: number;
  }> = [];

  let totalIn = 0;
  let totalOut = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let validCount = 0;
  let writeOk = 0;

  // Patch console.log pour intercepter les logs `[qualify-trigger-v2.usage]`
  const originalLog = console.log;
  let lastUsage: { in: number; out: number; cache_create: number; cache_read: number } | null = null;
  console.log = function (...args: any[]) {
    const first = String(args[0] ?? "");
    if (first.startsWith("[qualify-trigger-v2.usage]")) {
      try {
        const json = first.replace("[qualify-trigger-v2.usage] ", "");
        lastUsage = JSON.parse(json);
      } catch {}
    }
    originalLog.apply(this, args);
  };

  for (let i = 0; i < sample.length; i += 1) {
    const t = sample[i];
    lastUsage = null;
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${sample.length}] ${(t.companyName ?? "?").slice(0, 30).padEnd(30)} (${t.sourceCode.padEnd(28)} v1=${String(t.score ?? "null").padStart(4)}) ... `);
    let brief: any = null;
    try {
      brief = await qualifyTriggerV2(t.id);
    } catch (e) {
      originalLog(`THROW: ${e instanceof Error ? e.message : e}`);
    }
    const dur = Date.now() - t0;
    const valid = isLeadBriefV2(brief);
    if (valid) {
      validCount += 1;
      const v = (brief as any).verdict;
      const c = (brief as any).confidence;
      originalLog(`v2=${v} conf=${c} (${(dur / 1000).toFixed(1)}s)`);
      // Écriture DB
      if (!DRY_RUN) {
        try {
          await db.trigger.update({
            where: { id: t.id },
            data: { briefV2Json: brief as any },
          });
          writeOk += 1;
        } catch (e) {
          originalLog(`  ⚠️ write failed : ${e instanceof Error ? e.message : e}`);
        }
      }
    } else {
      originalLog(`INVALID (${(dur / 1000).toFixed(1)}s)`);
    }
    if (lastUsage) {
      totalIn += lastUsage.in;
      totalOut += lastUsage.out;
      totalCacheCreate += lastUsage.cache_create;
      totalCacheRead += lastUsage.cache_read;
    }
    results.push({
      triggerId: t.id,
      company: t.companyName,
      sourceCode: t.sourceCode,
      v1Score: t.score,
      v1Reason: (t.scoreReason ?? "").slice(0, 200),
      v1Status: t.status,
      v2Brief: brief,
      v2Valid: valid,
      durationMs: dur,
      inTokens: lastUsage?.in ?? 0,
      outTokens: lastUsage?.out ?? 0,
      cacheCreate: lastUsage?.cache_create ?? 0,
      cacheRead: lastUsage?.cache_read ?? 0,
    });
  }

  console.log = originalLog;

  console.log(`\n=== AUDIT METRICS ===\n`);

  console.log(`Zod-valid rate    : ${validCount}/${sample.length} = ${((validCount / sample.length) * 100).toFixed(1)}%`);
  console.log(`Écritures DB OK   : ${writeOk}/${validCount}${DRY_RUN ? " (DRY-RUN)" : ""}`);

  // ── Coût Opus ──
  // Tarif Opus 4.7 (au 07/05/2026) : input $15/M, output $75/M, cache_write $18.75/M, cache_read $1.50/M
  const costIn = (totalIn / 1_000_000) * 15;
  const costOut = (totalOut / 1_000_000) * 75;
  const costCacheCreate = (totalCacheCreate / 1_000_000) * 18.75;
  const costCacheRead = (totalCacheRead / 1_000_000) * 1.5;
  const totalCost = costIn + costOut + costCacheCreate + costCacheRead;
  const sansCache = ((totalIn + totalCacheCreate + totalCacheRead) / 1_000_000) * 15 + (totalOut / 1_000_000) * 75;
  const economyPct = sansCache > 0 ? ((sansCache - totalCost) / sansCache) * 100 : 0;
  console.log(`\nCoût Opus total   : $${totalCost.toFixed(4)} (économie cache: ${economyPct.toFixed(1)}% vs sans cache)`);
  console.log(`  input non-cached : ${totalIn} tk × $15/M = $${costIn.toFixed(4)}`);
  console.log(`  output           : ${totalOut} tk × $75/M = $${costOut.toFixed(4)}`);
  console.log(`  cache create     : ${totalCacheCreate} tk × $18.75/M = $${costCacheCreate.toFixed(4)}`);
  console.log(`  cache read       : ${totalCacheRead} tk × $1.50/M = $${costCacheRead.toFixed(4)}`);
  console.log(`Cache hit rate    : ${totalCacheCreate + totalCacheRead > 0 ? ((totalCacheRead / (totalCacheCreate + totalCacheRead)) * 100).toFixed(1) : "0"}%`);

  // ── Latence ──
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const stats = (arr: number[]) => ({
    min: arr[0],
    max: arr[arr.length - 1],
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    median: arr[Math.floor(arr.length / 2)],
    p95: arr[Math.floor(arr.length * 0.95)],
  });
  console.log(`\nLatence (ms)      : ${JSON.stringify(stats(durations))}`);

  // ── Matrice de concordance v1↔v2 ──
  console.log(`\n=== MATRICE CONCORDANCE v1 ↔ v2 ===\n`);
  const validResults = results.filter((r) => r.v2Valid);
  const matrix: Record<string, Record<string, number>> = {
    "v1 score≥7": { OUI: 0, NON: 0, ENRICH: 0, INVALID: 0 },
    "v1 score 5-6": { OUI: 0, NON: 0, ENRICH: 0, INVALID: 0 },
    "v1 score 1-4": { OUI: 0, NON: 0, ENRICH: 0, INVALID: 0 },
    "v1 score null": { OUI: 0, NON: 0, ENRICH: 0, INVALID: 0 },
  };
  const totalsByRow: Record<string, number> = {};
  for (const r of results) {
    let row: keyof typeof matrix;
    if (r.v1Score === null) row = "v1 score null";
    else if (r.v1Score >= 7) row = "v1 score≥7";
    else if (r.v1Score >= 5) row = "v1 score 5-6";
    else row = "v1 score 1-4";
    totalsByRow[row] = (totalsByRow[row] ?? 0) + 1;
    const verdict = r.v2Valid ? r.v2Brief.verdict : "INVALID";
    matrix[row][verdict] = (matrix[row][verdict] ?? 0) + 1;
  }
  console.log("v1 \\ v2".padEnd(18) + "OUI".padStart(6) + "NON".padStart(6) + "ENRICH".padStart(8) + "INVALID".padStart(9) + "TOTAL".padStart(7));
  for (const row of ["v1 score≥7", "v1 score 5-6", "v1 score 1-4", "v1 score null"]) {
    const r = matrix[row];
    const total = totalsByRow[row] ?? 0;
    if (total === 0) continue;
    console.log(
      row.padEnd(18) +
      String(r.OUI).padStart(6) +
      String(r.NON).padStart(6) +
      String(r.ENRICH).padStart(8) +
      String(r.INVALID).padStart(9) +
      String(total).padStart(7),
    );
  }

  // ── Concordance attendue ──
  // Heuristique : v1 score≥7 ↔ v2 OUI ; v1 score 1-4 ↔ v2 NON ; v1 score 5-6 ↔ v2 ENRICH ou OUI
  const expectedAccord = {
    "v1 score≥7": (m: any) => m.OUI,                        // v1 chaud → v2 OUI attendu
    "v1 score 5-6": (m: any) => m.OUI + m.ENRICH,           // v1 zone grise → v2 OUI ou ENRICH
    "v1 score 1-4": (m: any) => m.NON,                      // v1 rejet → v2 NON attendu
    "v1 score null": (m: any) => m.OUI + m.NON + m.ENRICH,  // v1 absent → tout verdict acceptable (v2 fait le job)
  };
  let accordCount = 0;
  let accordTotal = 0;
  for (const [row, fn] of Object.entries(expectedAccord)) {
    accordCount += fn(matrix[row]);
    accordTotal += totalsByRow[row] ?? 0;
  }
  const accordPct = accordTotal > 0 ? ((accordCount / accordTotal) * 100).toFixed(1) : "?";
  console.log(`\nTaux d'accord v1↔v2 (heuristique stricte) : ${accordCount}/${accordTotal} = ${accordPct}%`);
  console.log(`  (v1≥7 attendu OUI ; v1 5-6 attendu OUI/ENRICH ; v1 1-4 attendu NON ; v1 null neutre)`);

  // ── Disaccords majeurs ──
  console.log(`\n=== DISACCORDS MAJEURS ===\n`);

  const v1HighV2Non = validResults.filter((r) => (r.v1Score ?? 0) >= 7 && r.v2Brief.verdict === "NON");
  const v1LowV2Oui = validResults.filter((r) => r.v1Score !== null && (r.v1Score ?? 0) >= 1 && (r.v1Score ?? 0) <= 4 && r.v2Brief.verdict === "OUI");
  const v1MidV2Non = validResults.filter((r) => (r.v1Score ?? 0) >= 5 && (r.v1Score ?? 0) <= 6 && r.v2Brief.verdict === "NON");

  console.log(`v1≥7 mais v2=NON (${v1HighV2Non.length}) — v2 plus strict :`);
  for (const r of v1HighV2Non.slice(0, 8)) {
    console.log(`  - ${(r.company ?? "?").padEnd(30)} v1=${r.v1Score} | v2 thesis: ${(r.v2Brief.thesis as string).slice(0, 150)}...`);
  }

  console.log(`\nv1 1-4 mais v2=OUI (${v1LowV2Oui.length}) — v2 plus permissif :`);
  for (const r of v1LowV2Oui.slice(0, 8)) {
    console.log(`  - ${(r.company ?? "?").padEnd(30)} v1=${r.v1Score} | v2 conf=${r.v2Brief.confidence} thesis: ${(r.v2Brief.thesis as string).slice(0, 150)}...`);
  }

  console.log(`\nv1 5-6 mais v2=NON (${v1MidV2Non.length}) — v2 tranche en rejet :`);
  for (const r of v1MidV2Non.slice(0, 8)) {
    console.log(`  - ${(r.company ?? "?").padEnd(30)} v1=${r.v1Score} | v2 conf=${r.v2Brief.confidence} thesis: ${(r.v2Brief.thesis as string).slice(0, 150)}...`);
  }

  // ── Distribution verdicts globale ──
  console.log(`\n=== DISTRIBUTION VERDICTS V2 ===\n`);
  const verdictDist: Record<string, number> = { OUI: 0, NON: 0, ENRICH: 0, INVALID: 0 };
  for (const r of results) {
    if (r.v2Valid) verdictDist[r.v2Brief.verdict] = (verdictDist[r.v2Brief.verdict] ?? 0) + 1;
    else verdictDist.INVALID = (verdictDist.INVALID ?? 0) + 1;
  }
  for (const [v, n] of Object.entries(verdictDist)) {
    console.log(`  ${v.padEnd(8)}: ${n} (${((n / sample.length) * 100).toFixed(1)}%)`);
  }

  // ── Confidence stats ──
  const confidences = validResults.map((r) => r.v2Brief.confidence as number);
  if (confidences.length > 0) {
    console.log(`\nConfidence v2 : ${JSON.stringify(stats(confidences.sort((a, b) => a - b)))}`);
  }

  console.log(`\n=== FIN BACKFILL D.6 ===\n`);
  await db.$disconnect();
  process.exit(0);
})();
