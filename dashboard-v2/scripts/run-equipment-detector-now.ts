// @ts-nocheck — Run le equipment detector en live sur 1 client (debug/test)
import { db } from "@/lib/db";
import { runEquipmentDetectorForClient } from "@/lib/equipment-detector-runner";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: pnpm tsx scripts/run-equipment-detector-now.ts <client-slug>");
    process.exit(1);
  }
  const client = await db.client.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (!client) {
    console.error(`Client ${slug} introuvable`);
    process.exit(1);
  }
  console.log(`=== Run equipment detector pour ${client.slug} (${client.id}) ===\n`);
  const start = Date.now();
  const result = await runEquipmentDetectorForClient(client.id, { limit: 30 });
  const elapsed = Date.now() - start;
  console.log("\n=== Résultat ===");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nElapsed: ${(elapsed / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
