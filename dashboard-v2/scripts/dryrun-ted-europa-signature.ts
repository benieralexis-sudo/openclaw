// Dry-run live du poller TED Europa signature (Bombora FR Jour 13).
// Usage : npx tsx scripts/dryrun-ted-europa-signature.ts [clientName]
// Default : Digidemat.
// Lance le vrai fetch API TED v3 + appel Pappers réel, mais N'ÉCRIT PAS la DB.
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
  const { pollTedEuropaSignatureForClient } = await import(
    "../src/lib/ted-europa-signature-poller"
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
  console.log(
    "Lancement DRY-RUN — TED v3 fetch RÉEL, Pappers RÉEL, pas d'écriture DB",
  );

  const t0 = Date.now();
  const result = await pollTedEuropaSignatureForClient(client.id, {
    lookbackDays: 60,
    dryRun: true,
  });
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== RÉSULTAT (${dur}s) ===`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})();
