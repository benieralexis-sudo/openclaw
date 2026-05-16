// @ts-nocheck — script CLI, types stricts non requis
/**
 * Bench Sonnet 4.6 vs Opus 4.7 pour qualify-trigger V2 (16/05/2026).
 *
 * Objectif : décider si on peut basculer le qualify sur Sonnet pour réduire
 * massivement le coût Anthropic (~$22.73/jour actuel) sans perdre en qualité.
 *
 * Bench 28/04 avait éliminé Sonnet car 2 erreurs critiques (LYNX RH/PRECIA).
 * Mais le prompt enrichi commit ae65dc789 (15/05) peut renverser la décision.
 *
 * Méthode :
 *   - Sélectionne N triggers récents avec briefV2Json existant (verdict Opus
 *     connu = baseline)
 *   - Pour chacun : appelle Opus 4.7 ET Sonnet 4.6 en parallèle avec le même
 *     dossier + même prompt
 *   - Compare : verdict, score, latence, coût
 *   - Stocke résultats dans /tmp/bench-sonnet-opus-{ts}.json
 *
 * Pas de DB write, pas de recordSpend (dry-run intégral). Coût bench estimé :
 *   N=50 × ($0.10 Opus + $0.02 Sonnet) ≈ $6.
 *
 * Lancer : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/bench-sonnet-vs-opus.ts [--limit 50] [--clientSlug ifind|digitestlab]
 */
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

// Stub `server-only` pour CLI scripts
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") {
    return require.resolve("./_server-only-stub.js");
  }
  return originalResolve.call(this, request, ...args);
};

import { writeFileSync } from "node:fs";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 50;
  const clientArg = process.argv.find((a) => a.startsWith("--clientSlug="));
  const clientSlug = clientArg ? clientArg.split("=")[1] : null;

  const { db } = await import("../src/lib/db");
  const { getAnthropic, QUALIFY_MODEL } = await import("../src/lib/anthropic");
  const {
    QUALIFY_V2_SPECIFIC,
    QUALIFY_V2_USER_SUFFIX,
  } = await import("../src/lib/qualify-trigger");
  const { buildCachedSystem } = await import("../src/lib/anthropic-prompt");
  const { buildLeadDossierForJudge, formatDossierForOpus } = await import(
    "../src/lib/lead-dossier"
  );
  const { readDynamicFewShotsFromIcp } = await import(
    "../src/lib/dynamic-few-shots"
  );
  const { parseLeadBriefV2WithError } = await import("../src/lib/lead-brief-v2");
  const { computeAnthropicCost } = await import("../src/lib/anthropic-cost");

  console.log(`🧪 Bench Sonnet vs Opus — N=${limit}${clientSlug ? ` (client=${clientSlug})` : " (tous clients)"}`);

  // ── 1. Sélection triggers baseline ────────────────────────────────
  // On veut un équilibre OUI/NON/ENRICH (pas que des NON qui dominent).
  const perVerdict = Math.ceil(limit / 3);
  const where: Record<string, unknown> = {
    deletedAt: null,
    briefV2Json: { not: null },
    capturedAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
  };
  if (clientSlug) {
    const client = await db.client.findUnique({ where: { slug: clientSlug } });
    if (!client) {
      console.error(`Client ${clientSlug} introuvable`);
      process.exit(1);
    }
    where.clientId = client.id;
  }

  async function fetchByVerdict(verdict: string, take: number) {
    return db.trigger.findMany({
      where: {
        ...where,
        briefV2Json: {
          path: ["verdict"],
          equals: verdict,
        },
      },
      take,
      orderBy: { capturedAt: "desc" },
    });
  }

  const [ouiTriggers, nonTriggers, enrichTriggers] = await Promise.all([
    fetchByVerdict("OUI", perVerdict),
    fetchByVerdict("NON", perVerdict),
    fetchByVerdict("ENRICH", perVerdict),
  ]);
  const sample = [...ouiTriggers, ...nonTriggers, ...enrichTriggers].slice(0, limit);
  console.log(
    `📋 ${sample.length} triggers sélectionnés ` +
      `(${ouiTriggers.length} OUI, ${nonTriggers.length} NON, ${enrichTriggers.length} ENRICH)\n`,
  );

  // ── 2. Appel parallèle Opus + Sonnet pour chaque trigger ──────────
  const anthropic = getAnthropic();
  const SONNET_MODEL = "claude-sonnet-4-6";
  const results: Array<Record<string, unknown>> = [];
  let opusCostTotal = 0;
  let sonnetCostTotal = 0;
  let processed = 0;

  for (const trigger of sample) {
    processed += 1;
    const dossier = await buildLeadDossierForJudge(trigger.id);
    if (!dossier) {
      console.warn(`[${processed}/${sample.length}] ${trigger.id} — dossier null, skip`);
      continue;
    }

    const userPrompt = formatDossierForOpus(dossier) + QUALIFY_V2_USER_SUFFIX;
    const system = buildCachedSystem(
      QUALIFY_V2_SPECIFIC,
      readDynamicFewShotsFromIcp(dossier.client.icp) ?? undefined,
    );

    const baseline = trigger.briefV2Json as { verdict?: string; score?: number };

    async function call(model: string) {
      const t0 = Date.now();
      try {
        const resp = await anthropic.messages.create({
          model,
          max_tokens: 2000,
          system,
          messages: [{ role: "user", content: userPrompt }],
        });
        const latencyMs = Date.now() - t0;
        const u = resp.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
        const cost = computeAnthropicCost(model, u);
        const text = resp.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("")
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        let parsed: unknown = null;
        let parseError: string | null = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          parseError = e instanceof Error ? e.message : String(e);
        }
        let validated = null as { verdict?: string; score?: number } | null;
        if (parsed) {
          const v = parseLeadBriefV2WithError(parsed);
          if (v.ok) {
            validated = { verdict: v.brief.verdict, score: v.brief.score };
          } else {
            parseError = `zod-fail: ${v.error}`;
          }
        }
        return {
          model,
          latencyMs,
          costUsd: cost,
          usage: u,
          verdict: validated?.verdict ?? null,
          score: validated?.score ?? null,
          parseError,
          rawTextLength: text.length,
        };
      } catch (e) {
        return {
          model,
          latencyMs: Date.now() - t0,
          costUsd: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    const [opusResult, sonnetResult] = await Promise.all([
      call(QUALIFY_MODEL),
      call(SONNET_MODEL),
    ]);

    opusCostTotal += opusResult.costUsd ?? 0;
    sonnetCostTotal += sonnetResult.costUsd ?? 0;

    const sameVerdict = opusResult.verdict === sonnetResult.verdict;
    const scoreDiff =
      typeof opusResult.score === "number" && typeof sonnetResult.score === "number"
        ? Math.abs(opusResult.score - sonnetResult.score)
        : null;
    const sameAsBaseline = opusResult.verdict === baseline.verdict;

    results.push({
      triggerId: trigger.id,
      companyName: trigger.companyName,
      sourceCode: trigger.sourceCode,
      baseline: { verdict: baseline.verdict, score: baseline.score },
      opus: opusResult,
      sonnet: sonnetResult,
      sameVerdict,
      scoreDiff,
      sameAsBaseline,
    });

    console.log(
      `[${processed}/${sample.length}] ${trigger.companyName.slice(0, 30).padEnd(30)} ` +
        `bl=${baseline.verdict?.padEnd(6) ?? "?".padEnd(6)} ` +
        `opus=${(opusResult.verdict ?? "ERR").padEnd(6)} ` +
        `son=${(sonnetResult.verdict ?? "ERR").padEnd(6)} ` +
        `Δscore=${scoreDiff ?? "?"} ` +
        `concord=${sameVerdict ? "✓" : "✗"} ` +
        `costO=$${opusResult.costUsd?.toFixed(4) ?? "?"} ` +
        `costS=$${sonnetResult.costUsd?.toFixed(4) ?? "?"}`,
    );
  }

  // ── 3. Stats résumé ──────────────────────────────────────────────
  const validResults = results.filter(
    (r) => r.opus.verdict && r.sonnet.verdict,
  );
  const concordCount = validResults.filter((r) => r.sameVerdict).length;
  const concordPct = ((concordCount / validResults.length) * 100).toFixed(1);

  const scoreDiffs = validResults
    .map((r) => r.scoreDiff)
    .filter((d): d is number => typeof d === "number");
  const meanDiff =
    scoreDiffs.length > 0
      ? (scoreDiffs.reduce((s, d) => s + d, 0) / scoreDiffs.length).toFixed(2)
      : "?";
  const distrib = {
    0: scoreDiffs.filter((d) => d === 0).length,
    1: scoreDiffs.filter((d) => d === 1).length,
    2: scoreDiffs.filter((d) => d === 2).length,
    ">=3": scoreDiffs.filter((d) => d >= 3).length,
  };

  // Divergences critiques : Sonnet OUI alors qu'Opus NON (faux positifs Sonnet)
  const sonnetFalsePositives = validResults.filter(
    (r) =>
      r.opus.verdict === "NON" &&
      r.sonnet.verdict === "OUI",
  );
  // Divergences inverses : Sonnet NON alors qu'Opus OUI (faux négatifs Sonnet)
  const sonnetFalseNegatives = validResults.filter(
    (r) =>
      r.opus.verdict === "OUI" &&
      r.sonnet.verdict === "NON",
  );

  const opusAvgLatency = (
    validResults.reduce((s, r) => s + (r.opus.latencyMs ?? 0), 0) /
    validResults.length
  ).toFixed(0);
  const sonnetAvgLatency = (
    validResults.reduce((s, r) => s + (r.sonnet.latencyMs ?? 0), 0) /
    validResults.length
  ).toFixed(0);

  const summary = {
    timestamp: new Date().toISOString(),
    sampleSize: results.length,
    validCompared: validResults.length,
    concordance: { count: concordCount, pct: concordPct },
    scoreDiffMean: meanDiff,
    scoreDiffDistribution: distrib,
    sonnetFalsePositives: {
      count: sonnetFalsePositives.length,
      examples: sonnetFalsePositives.slice(0, 5).map((r) => ({
        company: r.companyName,
        baseline: r.baseline.verdict,
        opus: r.opus.verdict,
        sonnet: r.sonnet.verdict,
        opusScore: r.opus.score,
        sonnetScore: r.sonnet.score,
      })),
    },
    sonnetFalseNegatives: {
      count: sonnetFalseNegatives.length,
      examples: sonnetFalseNegatives.slice(0, 5).map((r) => ({
        company: r.companyName,
        baseline: r.baseline.verdict,
        opus: r.opus.verdict,
        sonnet: r.sonnet.verdict,
        opusScore: r.opus.score,
        sonnetScore: r.sonnet.score,
      })),
    },
    cost: {
      opusTotal: opusCostTotal.toFixed(4),
      sonnetTotal: sonnetCostTotal.toFixed(4),
      savingsPct: (((opusCostTotal - sonnetCostTotal) / opusCostTotal) * 100).toFixed(1),
      opusPerCall: (opusCostTotal / validResults.length).toFixed(4),
      sonnetPerCall: (sonnetCostTotal / validResults.length).toFixed(4),
    },
    latency: {
      opusAvgMs: opusAvgLatency,
      sonnetAvgMs: sonnetAvgLatency,
    },
  };

  console.log("\n" + "═".repeat(60));
  console.log("📊 RÉSUMÉ BENCH");
  console.log("═".repeat(60));
  console.log(JSON.stringify(summary, null, 2));

  const outPath = `/tmp/bench-sonnet-opus-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`\n💾 Détails sauvés : ${outPath}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
