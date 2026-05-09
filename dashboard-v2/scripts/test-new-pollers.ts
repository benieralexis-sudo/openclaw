import { pollRssLeveesForClient } from "../src/lib/rss-levees-poller";
import { pollBodaccForClient } from "../src/lib/bodacc-poller";

const DTL_CLIENT_ID = "cmoevcce00001l6uuklcp13wx";

async function main() {
  console.log("\n=== TEST 1 : RSS-levées ===");
  const rss = await pollRssLeveesForClient(DTL_CLIENT_ID);
  console.log(JSON.stringify(rss, null, 2));

  console.log("\n=== TEST 2 : BODACC ===");
  const bodacc = await pollBodaccForClient(DTL_CLIENT_ID, { lookbackDays: 7, limit: 30 });
  console.log(JSON.stringify(bodacc, null, 2));

  console.log("\n=== Triggers crees aujourd'hui par les nouveaux pollers ===");
  const { db } = await import("../src/lib/db");
  const triggers = await db.trigger.findMany({
    where: {
      clientId: DTL_CLIENT_ID,
      sourceCode: { in: ["rss-levees", "bodacc.capital_increase", "bodacc.company_merger", "bodacc.modification_statuts"] },
      capturedAt: { gte: new Date(Date.now() - 2 * 60 * 1000) }, // <2 min
    },
    select: { id: true, sourceCode: true, companyName: true, score: true, scoreReason: true },
  });
  console.log(`Created in last 2 min: ${triggers.length}`);
  triggers.forEach(t => console.log(`  ${t.sourceCode} | ${t.companyName} | score=${t.score} | ${t.scoreReason?.slice(0, 80)}`));
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
