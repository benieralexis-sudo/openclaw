// @ts-nocheck — Pilier 2 backfill : calcule intentStrength sur tous les
// Triggers existants pour pouvoir filtrer immédiatement.
import { db } from "@/lib/db";
import { computeIntentStrength } from "@/lib/intent-strength";

async function main() {
  console.log("=== Backfill intentStrength sur Triggers existants ===\n");

  const triggers = await db.trigger.findMany({
    where: { intentStrength: null, deletedAt: null },
    select: { id: true, sourceCode: true, publishedAt: true, score: true, status: true },
  });
  console.log(`${triggers.length} Triggers sans intentStrength à backfill`);

  const histogram = new Map<number, number>();
  const sourceMap = new Map<string, number[]>();

  let processed = 0;
  for (const t of triggers) {
    const strength = computeIntentStrength(t.sourceCode, t.publishedAt);
    histogram.set(strength, (histogram.get(strength) ?? 0) + 1);
    if (!sourceMap.has(t.sourceCode)) sourceMap.set(t.sourceCode, []);
    sourceMap.get(t.sourceCode)!.push(strength);

    await db.trigger.update({
      where: { id: t.id },
      data: { intentStrength: strength },
    });
    processed++;
    if (processed % 100 === 0) process.stdout.write(`.`);
  }
  console.log(`\n\n✅ ${processed} Triggers backfillés.`);

  console.log("\nDistribution intentStrength:");
  for (let s = 5; s >= 1; s--) {
    const count = histogram.get(s) ?? 0;
    const pct = ((count / processed) * 100).toFixed(1);
    console.log(`  Strength ${s}: ${count} (${pct}%)`);
  }

  console.log("\nPar sourceCode (strength moyenne):");
  for (const [src, strengths] of [...sourceMap.entries()].sort()) {
    const avg = (strengths.reduce((a, b) => a + b, 0) / strengths.length).toFixed(1);
    console.log(`  ${src.padEnd(40)} n=${strengths.length} avg=${avg}`);
  }

  // Combien de Triggers verdict OUI (score>=8) seraient downgrade ?
  const ouiWithLowStrength = await db.trigger.count({
    where: {
      score: { gte: 8 },
      status: "NEW",
      intentStrength: { lt: 3 },
      deletedAt: null,
    },
  });
  console.log(`\n⚠️  Triggers status=NEW score>=8 avec intentStrength<3 (seraient downgrade): ${ouiWithLowStrength}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
