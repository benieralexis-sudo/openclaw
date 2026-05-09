// @ts-nocheck — script CLI
/**
 * Question 4 — Modélisation source weights
 * Propose un format texte pour injecter dans le SYSTEM prompt du judge.
 * Test d'intelligibilité pour Opus.
 */

const mockSourceWeights = {
  "apify.linkedin-jobs": 0.62,
  "apify.wttj-jobs": 0.84,
  "apify.indeed-jobs": 0.38,
  "theirstack.job-offer": 0.71,
  "theirstack.buying-intent": 0.65,
  "trigger-engine.tech-hiring": 0.41,
  "rodz.fundraising": 0.92,
  "rodz.job-offers": 0.78,
};

const mockOutcomeCounts = {
  "apify.linkedin-jobs": 23,
  "apify.wttj-jobs": 47,
  "apify.indeed-jobs": 8,
  "theirstack.job-offer": 15,
  "theirstack.buying-intent": 12,
  "trigger-engine.tech-hiring": 5,
  "rodz.fundraising": 47,
  "rodz.job-offers": 3,
};

const mockOutcomeRates = {
  "apify.linkedin-jobs": 0.35,
  "apify.wttj-jobs": 0.72,
  "apify.indeed-jobs": 0.16,
  "theirstack.job-offer": 0.59,
  "theirstack.buying-intent": 0.55,
  "trigger-engine.tech-hiring": 0.38,
  "rodz.fundraising": 0.88,
  "rodz.job-offers": 0.75,
};

function formatSourceWeightsForPrompt(
  weights: Record<string, number>,
  outcomeCounts: Record<string, number>,
  outcomeRates: Record<string, number>,
  maxSources: number = 8,
): string {
  // Sort by outcome rate descending
  const sorted = Object.entries(weights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxSources);

  const lines: string[] = [];
  lines.push("## Fiabilité des sources (calibration empirique)");
  lines.push("");
  lines.push("Basé sur "+Object.keys(weights).length+" sources, "+Object.values(outcomeCounts).reduce((a,b) => a+b)+" outcomes capturés (90 derniers jours).");
  lines.push("Baseline (moyenne hardcoded): 0.70");
  lines.push("");

  for (const [source, weight] of sorted) {
    const outcomes = outcomeCounts[source] ?? 0;
    const rate = outcomeRates[source] ?? 0;
    const stars = Math.round(weight * 5);
    const starStr = "★".repeat(stars) + "☆".repeat(5 - stars);
    const pct = (rate * 100).toFixed(0);
    const confidence = outcomes >= 30 ? "✓ high" : outcomes >= 15 ? "⚠ medium" : "? low";
    
    lines.push(`- ${source}: ${starStr} (${pct}% precision sur ${outcomes} outcomes) [${confidence}]`);
  }

  lines.push("");
  lines.push("Sources non listées : fallback à baseline 0.70. Si source='<unknown>', skip qualification et flag pour audit.");
  lines.push("");
  lines.push("Règle d'application : multiplier le score brut par le poids avant comparaison aux seuils (NEW/CONTACTED/IGNORED).");
  lines.push("Exemple : trigger apify.wttj-jobs score_brut=7 → score_ajusté = 7 * 0.84 ≈ 5.88 → statut=IGNORED");

  return lines.join("\n");
}

console.log("\n" + "=".repeat(80));
console.log("PROPOSED FORMAT FOR QUALIFY PROMPT (Question 4)");
console.log("=".repeat(80) + "\n");

const formatted = formatSourceWeightsForPrompt(
  mockSourceWeights,
  mockOutcomeCounts,
  mockOutcomeRates,
);
console.log(formatted);

console.log("\n" + "=".repeat(80));
console.log("ASSESSMENT FOR OPUS");
console.log("=".repeat(80) + "\n");

console.log("✅ Strengths:");
console.log("   • Compact (< 300 tokens) — preserves cache");
console.log("   • Star rating (★) is visual, unambiguous for LLMs");
console.log("   • Outcome count + confidence marker shows data maturity");
console.log("   • Baseline 0.70 provides context for relative weighting");
console.log("   • Examples show application logic clearly\n");

console.log("⚠️  Risks:");
console.log("   • Opus might ignore low-confidence sources (? low)");
console.log("   • Decimal weights (0.84) could be misapplied if prompt doesn't reinforce");
console.log("   • Watch for: score 7 * 0.38 = 2.66 → might be misread as 7 - 0.38\n");

console.log("💡 Mitigation:");
console.log("   • Add few-shot: 'Example: apify.wttj score 8 × 0.84 = 6.7 → CONTACTED'");
console.log("   • Cache the baseline (0.70) at system level");
console.log("   • Include source weight in reasoning chain: '[source:apify.wttj weight=0.84]'\n");

