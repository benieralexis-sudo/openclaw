// @ts-nocheck — Sprint D.2 audit script (07/05/2026)
//
// Test du judge V2 dormant sur N triggers DTL réels.
// Mesure : taux Zod-valid, distribution verdicts, longueur opener,
// présence citations [src:#X], sources cohérence.
//
// AUCUNE écriture DB. Tous les triggers évalués sont relus de la DB ;
// qualifyTriggerV2 ne fait pas de update. Exécution coût ~$0.05 par
// trigger × 10 = ~$0.50 max.
//
// Usage :
//   cd /opt/moltbot/dashboard-v2
//   npx tsx scripts/test-judge-v2.ts            # 10 triggers DTL aléatoires score≥7
//   npx tsx scripts/test-judge-v2.ts 5          # N=5 triggers
//   npx tsx scripts/test-judge-v2.ts 10 all     # mix all scores (pas que score≥7)

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const N = parseInt(process.argv[2] ?? "10", 10);
const SCOPE = process.argv[3] === "all" ? "all" : "score-ge-7";

(async () => {
  const { db } = await import("../src/lib/db");
  const { qualifyTriggerV2 } = await import("../src/lib/qualify-trigger");
  const { isLeadBriefV2 } = await import("../src/lib/lead-brief-v2");

  console.log(`\n=== TEST JUDGE V2 (Sprint D.2) — N=${N} scope=${SCOPE} ===\n`);

  const dtl = await db.client.findFirst({ where: { name: { contains: "Digi", mode: "insensitive" } }, select: { id: true, name: true } });
  if (!dtl) {
    console.error("Client DigiTestLab introuvable. Abandon.");
    process.exit(2);
  }
  console.log(`Client : ${dtl.name} (${dtl.id})\n`);

  const where: Record<string, unknown> = {
    clientId: dtl.id,
    deletedAt: null,
  };
  if (SCOPE === "score-ge-7") {
    where.score = { gte: 7 };
  }

  const candidates = await db.trigger.findMany({
    where,
    select: { id: true, score: true, scoreReason: true, companyName: true, sourceCode: true, type: true },
    orderBy: { capturedAt: "desc" },
    take: Math.min(N * 3, 60),
  });

  if (candidates.length === 0) {
    console.error("Aucun trigger candidat. Abandon.");
    process.exit(2);
  }

  // Sample N triggers (les plus récents pour rester déterministe)
  const sample = candidates.slice(0, N);
  console.log(`Triggers échantillonnés : ${sample.length}\n`);

  const results: Array<{
    triggerId: string;
    company: string | null;
    sourceCode: string;
    v1Score: number;
    v1Reason: string;
    v2Brief: unknown;
    v2Valid: boolean;
    durationMs: number;
  }> = [];

  let validCount = 0;
  const verdictDistribution: Record<string, number> = { OUI: 0, NON: 0, ENRICH: 0 };

  for (let i = 0; i < sample.length; i += 1) {
    const t = sample[i];
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${sample.length}] ${t.companyName ?? "?"} (${t.sourceCode}, v1Score=${t.score}) ... `);
    let brief: unknown = null;
    try {
      brief = await qualifyTriggerV2(t.id);
    } catch (e) {
      console.log(`THROW: ${e instanceof Error ? e.message : e}`);
    }
    const dur = Date.now() - t0;
    const valid = isLeadBriefV2(brief);
    if (valid) {
      validCount += 1;
      const v = (brief as any).verdict as string;
      verdictDistribution[v] = (verdictDistribution[v] ?? 0) + 1;
      console.log(`OK verdict=${v} conf=${(brief as any).confidence} (${dur}ms)`);
    } else {
      console.log(`INVALID (${dur}ms)`);
    }
    results.push({
      triggerId: t.id,
      company: t.companyName,
      sourceCode: t.sourceCode,
      v1Score: t.score,
      v1Reason: t.scoreReason ?? "",
      v2Brief: brief,
      v2Valid: valid,
      durationMs: dur,
    });
  }

  console.log("\n=== AUDIT METRICS ===\n");

  console.log(`Zod-valid rate : ${validCount}/${sample.length} = ${((validCount / sample.length) * 100).toFixed(1)}%`);
  console.log(`Verdict distribution : ${JSON.stringify(verdictDistribution)}`);

  const validBriefs = results.filter((r) => r.v2Valid).map((r) => r.v2Brief as any);
  if (validBriefs.length > 0) {
    const openerLengths = validBriefs.map((b) => (b.opener as string).length);
    const openerWords = validBriefs.map((b) => (b.opener as string).split(/\s+/).length);
    const thesisLengths = validBriefs.map((b) => (b.thesis as string).length);
    const triggersCounts = validBriefs.map((b) => (b.triggers as unknown[]).length);
    const risksCounts = validBriefs.map((b) => (b.risks as unknown[]).length);
    const sourcesCounts = validBriefs.map((b) => (b.sources as unknown[]).length);

    const stats = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(sum / sorted.length),
        median: sorted[Math.floor(sorted.length / 2)],
      };
    };

    console.log(`\nOpener length (chars) : ${JSON.stringify(stats(openerLengths))}`);
    console.log(`Opener length (mots)  : ${JSON.stringify(stats(openerWords))} — cible D.3 ≤250`);
    console.log(`Thesis length (chars) : ${JSON.stringify(stats(thesisLengths))}`);
    console.log(`Triggers count        : ${JSON.stringify(stats(triggersCounts))}`);
    console.log(`Risks count           : ${JSON.stringify(stats(risksCounts))} — min schéma=2`);
    console.log(`Sources count         : ${JSON.stringify(stats(sourcesCounts))}`);

    // Citations [src:#X] cohérence : chaque [src:#N] cité dans thesis/risks/opener
    // doit avoir id=N dans sources[].
    const citationCheck = validBriefs.map((b) => {
      const cited = new Set<number>();
      const collect = (s: string | undefined) => {
        if (!s) return;
        const matches = s.matchAll(/\[src:#(\d+)\]/g);
        for (const m of matches) cited.add(parseInt(m[1], 10));
      };
      collect(b.thesis);
      collect(b.opener);
      for (const r of b.risks ?? []) collect(r.description);
      const sourceIds = new Set((b.sources ?? []).map((s: any) => s.id as number));
      const missing = [...cited].filter((id) => !sourceIds.has(id));
      const orphan = [...sourceIds].filter((id) => !cited.has(id));
      return { citedCount: cited.size, sourceCount: sourceIds.size, missing, orphan };
    });
    const allMissing = citationCheck.flatMap((c) => c.missing);
    const orphanCount = citationCheck.reduce((s, c) => s + c.orphan.length, 0);
    console.log(`\nCitations cohérence  : ${citationCheck.filter((c) => c.missing.length === 0).length}/${citationCheck.length} briefs sans citation orpheline`);
    if (allMissing.length > 0) console.log(`  ⚠️ ids cités mais absents de sources[] : ${allMissing.slice(0, 10)}`);
    if (orphanCount > 0) console.log(`  ⚠️ sources jamais citées (pollution) : ${orphanCount} au total`);

    // Distribution sévérité risks
    const allRisks = validBriefs.flatMap((b) => (b.risks ?? []) as Array<{ severity: string }>);
    const severityCount: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const r of allRisks) severityCount[r.severity] = (severityCount[r.severity] ?? 0) + 1;
    console.log(`Risks sévérité       : ${JSON.stringify(severityCount)} (sur ${allRisks.length} risks total)`);

    // Cohérence verdict ↔ enrichmentNeeded
    const enrichWithoutNeeds = validBriefs.filter((b) => b.verdict === "ENRICH" && (!b.enrichmentNeeded || b.enrichmentNeeded.length === 0));
    const nonEnrichWithNeeds = validBriefs.filter((b) => b.verdict !== "ENRICH" && b.enrichmentNeeded && b.enrichmentNeeded.length > 0);
    console.log(`enrichmentNeeded coh : ENRICH sans needs=${enrichWithoutNeeds.length} | non-ENRICH avec needs=${nonEnrichWithNeeds.length}`);

    // Échantillon : 1 OUI, 1 NON, 1 ENRICH si dispo
    const samples: Record<string, any> = {};
    for (const b of validBriefs) {
      if (!samples[b.verdict]) samples[b.verdict] = b;
    }
    console.log(`\n=== ÉCHANTILLONS BRIEFS ===\n`);
    for (const v of ["OUI", "NON", "ENRICH"]) {
      if (!samples[v]) continue;
      const b = samples[v];
      console.log(`--- ${v} (confidence=${b.confidence}) ---`);
      console.log(`thesis: ${b.thesis}`);
      console.log(`risks: ${b.risks.map((r: any) => `[${r.severity}] ${r.description.slice(0, 100)}`).join("\n       ")}`);
      console.log(`opener (${b.opener.length}c, ${b.opener.split(/\s+/).length} mots):\n${b.opener}\n`);
    }
  }

  // Triggers en échec (Zod-invalid)
  const invalid = results.filter((r) => !r.v2Valid);
  if (invalid.length > 0) {
    console.log(`\n=== ${invalid.length} BRIEFS INVALIDES ===\n`);
    for (const r of invalid) {
      console.log(`- ${r.company} (${r.sourceCode}, v1Score=${r.v1Score}) : ${JSON.stringify(r.v2Brief).slice(0, 200)}`);
    }
  }

  console.log(`\n=== FIN TEST JUDGE V2 ===\n`);

  await db.$disconnect();
  process.exit(0);
})();
