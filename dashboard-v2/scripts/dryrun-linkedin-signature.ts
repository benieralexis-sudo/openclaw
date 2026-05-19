// Dry-run live du poller LinkedIn Jobs signature (Bombora FR Jour 9).
// Usage : npx tsx scripts/dryrun-linkedin-signature.ts [clientName]
// Default : Digidemat.
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const CLIENT_NAME = process.argv[2] ?? "Digidemat";

(async () => {
  const { db } = await import("../src/lib/db");
  const { pollLinkedinSignatureForClient } = await import(
    "../src/lib/apify-linkedin-signature-poller"
  );

  const client = await db.client.findFirst({
    where: { name: CLIENT_NAME, deletedAt: null },
    select: { id: true, name: true, status: true },
  });
  if (!client) {
    console.error(`Client "${CLIENT_NAME}" introuvable`);
    process.exit(1);
  }
  console.log(`Targeting ${client.name} (${client.id}, status=${client.status})`);
  console.log("Lancement DRY-RUN — pas d'écriture DB, MAIS appel Apify RÉEL...");
  console.log("Estimation coût : ~$1.50");

  const t0 = Date.now();
  const result = await pollLinkedinSignatureForClient(client.id, { dryRun: true });
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== RÉSULTAT (${dur}s) ===`);
  console.log(JSON.stringify(result, null, 2));

  // Échantillon : montre les keywords qui ont tourné ce run (rotation)
  const { getRotatedKeywords } = await import("../src/lib/keyword-rotation");
  const { getSignatureKeywords } = await import(
    "../src/lib/apify-linkedin-signature-poller"
  );
  const kw = await getSignatureKeywords(client.id);
  const rotated = getRotatedKeywords(kw, { batchSize: 6 });
  console.log(`\n=== KEYWORDS CYCLE COURANT (${rotated.length}/${kw.length}) ===`);
  console.log(rotated.join(", "));
  process.exit(0);
})();
