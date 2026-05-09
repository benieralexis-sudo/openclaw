// @ts-nocheck — script CLI
/**
 * Question 3 — Sparsité et risque sur-réaction
 * Analyse combien d'outcomes au total, marge d'erreur CI95%, recommandation attendre vs déployer.
 * 
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/inspect-data-maturity.ts
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Count all LeadActivity outcomes
  const activities = await db.leadActivity.findMany({
    where: {
      clientId: client.id,
      createdAt: { gte: since },
      type: {
        in: ["MEETING_BOOKED", "DASHBOARD_INTERACTION", "EMAIL_SENT"],
      },
    },
    select: { id: true, type: true, source: true },
  });

  const activityTypes = {
    MEETING_BOOKED: 0,
    DASHBOARD_INTERACTION: 0,
    EMAIL_SENT_MANUAL: 0,
  };

  for (const a of activities) {
    if (a.type === "MEETING_BOOKED") activityTypes.MEETING_BOOKED++;
    else if (a.type === "DASHBOARD_INTERACTION") activityTypes.DASHBOARD_INTERACTION++;
    else if (a.type === "EMAIL_SENT" && a.source === "MANUAL") activityTypes.EMAIL_SENT_MANUAL++;
  }

  const totalOutcomes = Object.values(activityTypes).reduce((a, b) => a + b, 0);

  // Calculate CI95 for proportions
  // For a single source: if n=5 outcomes out of 50 triggers (p=0.1)
  // CI95 = p ± 1.96 * sqrt(p(1-p)/n)
  // = 0.1 ± 1.96 * sqrt(0.09/5)
  // = 0.1 ± 0.27 → [0%, 37%]
  const calculateCI95 = (successes: number, total: number) => {
    if (total === 0) return { p: 0, marginErr: 1.0 };
    const p = successes / total;
    const se = Math.sqrt((p * (1 - p)) / total);
    const marginErr = 1.96 * se;
    return {
      p,
      lower: Math.max(0, p - marginErr),
      upper: Math.min(1, p + marginErr),
      marginErr,
    };
  };

  console.log(`\n📊 iFIND Data Maturity Analysis — DTL`);
  console.log(`   Client: ${client.name}`);
  console.log(`   Analysis window: 90 days\n`);

  console.log("Outcomes captured by type:");
  console.log(`   • MEETING_BOOKED: ${activityTypes.MEETING_BOOKED}`);
  console.log(`   • DASHBOARD_INTERACTION: ${activityTypes.DASHBOARD_INTERACTION}`);
  console.log(`   • EMAIL_SENT (manual): ${activityTypes.EMAIL_SENT_MANUAL}`);
  console.log(`   • TOTAL: ${totalOutcomes}\n`);

  const triggers = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: { sourceCode: true },
  });

  const sourceDistribution: Record<string, number> = {};
  for (const t of triggers) {
    sourceDistribution[t.sourceCode] = (sourceDistribution[t.sourceCode] ?? 0) + 1;
  }

  const sourcesWithSmallN = Object.entries(sourceDistribution)
    .filter(([, n]) => n >= 4 && n <= 5)
    .map(([src, n]) => ({ src, n }));

  if (sourcesWithSmallN.length > 0) {
    console.log("Sources with small sample (4-5 triggers) - CI95 margin simulation:");
    for (const { src, n } of sourcesWithSmallN) {
      // Assume 40% positive rate (reasonable for iFIND)
      const ci = calculateCI95(Math.round(0.4 * n), n);
      console.log(`   • ${src} (n=${n}): p=40% → [${(ci.lower * 100).toFixed(0)}%, ${(ci.upper * 100).toFixed(0)}%] margin ±${(ci.marginErr * 100).toFixed(0)}%`);
    }
  }

  console.log("\n💡 Recommendation:");
  const totalTriggers = triggers.length;
  const outcomeRate = totalOutcomes / Math.max(1, totalTriggers);
  const avgTriggersPerSource = totalTriggers / Math.max(1, Object.keys(sourceDistribution).length);

  console.log(`   • Total triggers (90d): ${totalTriggers}`);
  console.log(`   • Total outcomes captured: ${totalOutcomes}`);
  console.log(`   • Overall outcome rate: ${(outcomeRate * 100).toFixed(1)}%`);
  console.log(`   • Avg triggers/source: ${avgTriggersPerSource.toFixed(1)}`);

  if (totalOutcomes < 10) {
    console.log(`\n   ACTION: ❌ WAIT 4-8 weeks (capture mode, Sprint 7 just shipped)`);
    console.log(`   - Too sparse (${totalOutcomes} outcomes) for statistical inference`);
    console.log(`   - Prep hybrid model now (hardcoded × confidence_factor where n<30)`);
  } else if (totalOutcomes < 30) {
    console.log(`\n   ACTION: ⚠️  HYBRID approach (4-6 weeks more)`);
    console.log(`   - Deploy Bonus B with confidence factors <1.0 for sources with n<30`);
    console.log(`   - Weight = empirical_weight × (min(n, 30)/30) for conservative bias`);
  } else {
    console.log(`\n   ACTION: ✅ DEPLOY Bonus B (sufficient outcomes)`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
