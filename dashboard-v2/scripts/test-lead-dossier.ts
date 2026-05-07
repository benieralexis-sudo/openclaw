// @ts-nocheck — script CLI test
/**
 * Sprint C.5 test — vérifie que buildLeadDossierForJudge + formatDossierForOpus
 * produisent un userPrompt cohérent et structurellement identique à celui
 * généré par qualify-trigger.ts aujourd'hui.
 *
 * Usage : npx tsx scripts/test-lead-dossier.ts
 */
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

(async () => {
  const { db } = await import("../src/lib/db");
  const { buildLeadDossierForJudge, formatDossierForOpus, formatDossierAsJsonForDebug } =
    await import("../src/lib/lead-dossier");

  // Sample : 3 triggers DTL récents
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true },
  });
  if (!client) throw new Error("DTL not found");

  const triggers = await db.trigger.findMany({
    where: { clientId: client.id, deletedAt: null, scoreReason: { not: null } },
    select: { id: true, companyName: true },
    orderBy: { capturedAt: "desc" },
    take: 3,
  });

  for (const t of triggers) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Trigger ${t.id} (${t.companyName})`);
    console.log("=".repeat(80));

    const dossier = await buildLeadDossierForJudge(t.id);
    if (!dossier) {
      console.log("❌ buildLeadDossierForJudge returned null");
      continue;
    }

    console.log("\n--- DOSSIER STRUCTURE ---");
    console.log(formatDossierAsJsonForDebug(dossier));

    console.log("\n--- USER PROMPT GENERATED ---");
    const userPrompt = formatDossierForOpus(dossier);
    console.log(userPrompt);
    console.log(`\n[length: ${userPrompt.length} chars (~${Math.round(userPrompt.length / 4)} tokens)]`);
  }

  await db.$disconnect();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
