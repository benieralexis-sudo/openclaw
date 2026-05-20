// @ts-nocheck — Pilier 3 backfill : marque les Triggers verdict OUI existants
// avec equipmentStatus=PENDING pour qu'ils soient pris par le runner async.
// Idempotent : ne touche que les Triggers qui n'ont pas déjà un check.
import { db } from "@/lib/db";

async function main() {
  console.log("=== Backfill equipmentStatus=PENDING pour Triggers OUI sans check ===\n");

  // Cible : Triggers status=NEW, score>=6 (= verdict OUI/ENRICH dans le pipeline),
  // sans check équipement déjà fait, et non supprimés.
  const count = await db.trigger.count({
    where: {
      status: "NEW",
      score: { gte: 6 },
      equipmentStatus: null,
      equipmentCheckedAt: null,
      deletedAt: null,
    },
  });
  console.log(`Triggers à backfill: ${count}`);

  if (count === 0) {
    console.log("Rien à faire.");
    process.exit(0);
  }

  const updated = await db.trigger.updateMany({
    where: {
      status: "NEW",
      score: { gte: 6 },
      equipmentStatus: null,
      equipmentCheckedAt: null,
      deletedAt: null,
    },
    data: { equipmentStatus: "PENDING" },
  });
  console.log(`✅ ${updated.count} Triggers marqués PENDING — prêts pour le runner.`);

  // Breakdown par client
  const byClient = await db.trigger.groupBy({
    by: ["clientId"],
    where: { equipmentStatus: "PENDING", deletedAt: null },
    _count: { _all: true },
  });
  console.log("\nBreakdown par client (PENDING):");
  for (const row of byClient) {
    const client = await db.client.findUnique({
      where: { id: row.clientId },
      select: { slug: true },
    });
    console.log(`  ${client?.slug ?? row.clientId}: ${row._count._all} pending`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
