// Run live (non-dry) du poller LinkedIn Jobs signature pour valider qualité.
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
  console.log(`LIVE RUN sur ${client.name} (${client.id})`);
  const t0 = Date.now();
  const result = await pollLinkedinSignatureForClient(client.id);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== RÉSULTAT (${dur}s) ===`);
  console.log(JSON.stringify(result, null, 2));

  // Inspection des triggers créés
  const triggers = await db.trigger.findMany({
    where: { clientId: client.id, sourceCode: "apify.linkedin-jobs-signature" },
    orderBy: { capturedAt: "desc" },
    select: { id: true, companyName: true, title: true, score: true, scoreReason: true, sourceUrl: true },
    take: 30,
  });
  console.log(`\n=== TRIGGERS EN DB (${triggers.length}) ===`);
  for (const t of triggers) {
    console.log(`- [${t.score}] ${t.companyName} — ${t.title?.slice(0, 100)}`);
    console.log(`  reason: ${t.scoreReason}`);
  }
  process.exit(0);
})();
