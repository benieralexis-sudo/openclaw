// @ts-nocheck — Sprint D.3 audit (07/05/2026)
//
// Audit du validator strict sur les 46 briefs LeadBriefV2 déjà persistés
// en DB par le backfill Sprint D.6. Pas d'appel Opus, lecture pure DB.
// Coût marginal ~ 0.
//
// Mesure :
//   - Taux pass-strict (`validation.ok`)
//   - Distribution des erreurs par règle (top violations)
//   - Distribution des warnings (sources orphelines, confidence basse)
//   - Stats opener wordCount (cible ≤250, médiane, p95, max)
//   - Stats citations (thesis, opener, risks)
//   - Métriques par verdict (OUI/NON/ENRICH) — pass-rate stratifié
//
// Utile pour D.5 : si pass-strict élevé (≥80%), on peut envisager le switch ;
// si bas, il faut tuner QUALIFY_V2_SPECIFIC ou relâcher les règles strictes.
//
// Usage :
//   cd /opt/moltbot/dashboard-v2
//   npx tsx scripts/audit-d3-validator.ts

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

(async () => {
  const { db } = await import("../src/lib/db");
  const { isLeadBriefV2 } = await import("../src/lib/lead-brief-v2");
  const { validateLeadBriefV2Strict, formatValidationSummary } = await import(
    "../src/lib/lead-brief-v2-validator"
  );

  console.log(`\n=== AUDIT D.3 — Validator strict sur briefV2Json en DB ===\n`);

  // Lire tous les triggers avec briefV2Json non-null. Prisma JSON null filter
  // est lourd, on prend tout et filtre en JS.
  const all = await db.trigger.findMany({
    where: { briefV2Json: { not: { equals: null } as any } },
    select: {
      id: true,
      companyName: true,
      sourceCode: true,
      score: true,
      briefV2Json: true,
    },
  });

  console.log(`Triggers avec briefV2Json en DB : ${all.length}\n`);

  if (all.length === 0) {
    console.log("Aucun brief V2 en DB. Lance d'abord scripts/backfill-judge-v2-dtl.ts.");
    await db.$disconnect();
    process.exit(0);
  }

  let zodValid = 0;
  let strictPass = 0;
  let totalWarnings = 0;
  const errorCounts: Record<string, number> = {};
  const warningCounts: Record<string, number> = {};
  const verdictPassRate: Record<string, { total: number; pass: number }> = {
    OUI: { total: 0, pass: 0 },
    NON: { total: 0, pass: 0 },
    ENRICH: { total: 0, pass: 0 },
  };
  const openerWords: number[] = [];
  const thesisCitations: number[] = [];
  const riskCitations: number[] = [];
  const failedBriefs: Array<{
    company: string | null;
    score: number | null;
    sourceCode: string;
    verdict: string;
    summary: string;
  }> = [];

  for (const t of all) {
    if (!isLeadBriefV2(t.briefV2Json)) {
      console.warn(`  ⚠️ Brief Zod-invalid en DB pour ${t.id} — skipped`);
      continue;
    }
    zodValid += 1;
    const brief = t.briefV2Json as any;
    const result = validateLeadBriefV2Strict(brief);

    openerWords.push(result.metrics.openerWordCount);
    thesisCitations.push(result.metrics.citationsInThesis);
    riskCitations.push(result.metrics.citationsInRisks);

    const verdictBucket = verdictPassRate[brief.verdict];
    if (verdictBucket) {
      verdictBucket.total += 1;
      if (result.ok) verdictBucket.pass += 1;
    }

    if (result.ok) {
      strictPass += 1;
    } else {
      for (const err of result.errors) {
        errorCounts[err.field] = (errorCounts[err.field] ?? 0) + 1;
      }
      failedBriefs.push({
        company: t.companyName,
        score: t.score,
        sourceCode: t.sourceCode,
        verdict: brief.verdict,
        summary: formatValidationSummary(result),
      });
    }

    totalWarnings += result.warnings.length;
    for (const w of result.warnings) {
      warningCounts[w.field] = (warningCounts[w.field] ?? 0) + 1;
    }
  }

  // ── Stats helpers ──
  const stats = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 0, avg: 0, median: 0, p95: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(sorted.reduce((s, n) => s + n, 0) / sorted.length),
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  };

  console.log(`=== TAUX DE PASSAGE ===\n`);
  console.log(`Zod-valid        : ${zodValid}/${all.length} = ${((zodValid / all.length) * 100).toFixed(1)}%`);
  console.log(`Validator strict : ${strictPass}/${zodValid} = ${((strictPass / Math.max(zodValid, 1)) * 100).toFixed(1)}%`);
  console.log(`Total warnings   : ${totalWarnings} (sur ${zodValid} briefs Zod-valid)\n`);

  console.log(`=== PASS-RATE STRATIFIÉ PAR VERDICT ===\n`);
  for (const [v, b] of Object.entries(verdictPassRate)) {
    if (b.total === 0) continue;
    console.log(`  ${v.padEnd(8)}: ${b.pass}/${b.total} = ${((b.pass / b.total) * 100).toFixed(1)}% strict-pass`);
  }

  console.log(`\n=== TOP VIOLATIONS (errors) ===\n`);
  if (Object.keys(errorCounts).length === 0) {
    console.log("  Aucune erreur — 100% pass-strict 🎯");
  } else {
    for (const [field, n] of Object.entries(errorCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field.padEnd(20)} : ${n}`);
    }
  }

  console.log(`\n=== TOP WARNINGS ===\n`);
  if (Object.keys(warningCounts).length === 0) {
    console.log("  Aucun warning");
  } else {
    for (const [field, n] of Object.entries(warningCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field.padEnd(20)} : ${n}`);
    }
  }

  console.log(`\n=== MÉTRIQUES CONTENU ===\n`);
  const openerStats = stats(openerWords);
  console.log(`Opener wordCount  : ${JSON.stringify(openerStats)} (cible ≤250)`);
  const overTarget = openerWords.filter((w) => w > 250).length;
  console.log(`  > 250 mots      : ${overTarget}/${openerWords.length}`);
  console.log(`Thesis citations  : ${JSON.stringify(stats(thesisCitations))} (min métier=1)`);
  const thesisZero = thesisCitations.filter((n) => n === 0).length;
  console.log(`  = 0             : ${thesisZero}/${thesisCitations.length}`);
  console.log(`Risk citations    : ${JSON.stringify(stats(riskCitations))}`);

  if (failedBriefs.length > 0) {
    console.log(`\n=== BRIEFS QUI ÉCHOUENT VALIDATOR STRICT (${failedBriefs.length}) ===\n`);
    for (const f of failedBriefs.slice(0, 15)) {
      console.log(`  - ${(f.company ?? "?").slice(0, 30).padEnd(30)} v1=${String(f.score).padStart(2)} v2=${f.verdict.padEnd(6)} (${f.sourceCode}) → ${f.summary}`);
    }
    if (failedBriefs.length > 15) {
      console.log(`  ... +${failedBriefs.length - 15} autres`);
    }
  }

  console.log(`\n=== RECOMMANDATION D.5 ===\n`);
  const passPct = (strictPass / Math.max(zodValid, 1)) * 100;
  if (passPct >= 80) {
    console.log(`  ✅ Pass-strict ${passPct.toFixed(1)}% ≥ 80% → switch envisageable.`);
    console.log(`     Activation pipeline prod possible avec validator dans wrapper.`);
  } else if (passPct >= 60) {
    console.log(`  ⚠️ Pass-strict ${passPct.toFixed(1)}% entre 60-80% → shadow mode 14j.`);
    console.log(`     Tuner QUALIFY_V2_SPECIFIC sur les violations top avant switch.`);
  } else {
    console.log(`  ❌ Pass-strict ${passPct.toFixed(1)}% < 60% → tuning requis avant déploiement.`);
    console.log(`     Le validator strict est trop sévère OU le prompt v2 manque de discipline.`);
    console.log(`     Décider : (a) relâcher validator (ex risks low+medium sans citation OK),`);
    console.log(`     (b) durcir prompt (instruction explicite "chaque risk DOIT citer [src:#X]"),`);
    console.log(`     (c) accepter pass-strict bas pour le shadow et améliorer en continu.`);
  }

  console.log(`\n=== FIN AUDIT D.3 ===\n`);
  await db.$disconnect();
  process.exit(0);
})();
