// Run réel du poller RSS médias FR signature (Bombora FR Jour 10).
// Usage : npx tsx scripts/run-rss-medias-signature.ts [clientName]
// Default : Digidemat. ÉCRIT en DB.
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
  const { pollRssMediasSignatureForClient } = await import(
    "../src/lib/rss-medias-signature-poller"
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

  const t0 = Date.now();
  const result = await pollRssMediasSignatureForClient(client.id);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== RÉSULTAT (${dur}s) ===`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})();
