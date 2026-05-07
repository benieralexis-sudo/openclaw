// @ts-nocheck — audit script Sprint D.1
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
  const {
    LeadBriefV2Schema,
    parseLeadBriefV2,
    parseLeadBriefV2WithError,
    isLeadBriefV2,
  } = await import("../src/lib/lead-brief-v2");

  console.log("\n=== AUDIT D.1 — schéma + migration briefV2Json ===");

  // V1. Zod schema accepte un brief valide
  const validBrief = {
    verdict: "OUI",
    confidence: 87,
    thesis: "DiXiO éditeur SaaS fintech FR (NAF 6201Z) recrute Lead QA frais : signal d'achat ICP fort [src:#1] confirmé par homepage SWIFT/cloud [src:#2].",
    triggers: [
      { source: "Apify WTTJ", date: "2026-05-07", relevance: "Hire Lead QA <1j ICP éditeur SaaS" },
    ],
    risks: [
      { severity: "medium", description: "Effectif Pappers 1-2p incohérent avec '50 pays' homepage [src:#3] — taille réelle à vérifier" },
      { severity: "low", description: "Pas d'historique cross-tenant chez les autres clients iFIND" },
    ],
    opener: "Hello, j'ai vu que vous recrutez un Lead QA pour structurer la stratégie testing chez DiXiO. On bosse avec des éditeurs SaaS fintech qui ont les mêmes défis CI/CD — un échange de 15 min pourrait avoir du sens ?",
    sources: [
      { id: 1, type: "trigger", ref: "apify.wttj-jobs:cmovbtzgu000tl6pt0phh9f2h" },
      { id: 2, type: "homepage", ref: "https://dixio.cloud" },
      { id: 3, type: "pappers", ref: "SIRET 88123456700015" },
    ],
  };
  const r1 = parseLeadBriefV2(validBrief);
  console.log(`V1 Zod parse brief valide : ${r1 ? "✅" : "❌"} verdict=${r1?.verdict} confidence=${r1?.confidence}`);

  // V2. Reject si <2 risks (devrait être ≥2 par schéma — D.3 ajoutera la règle de citations)
  const invalidOneRisk = { ...validBrief, risks: [validBrief.risks[0]] };
  const r2 = parseLeadBriefV2WithError(invalidOneRisk);
  console.log(`V2 Reject 1 seul risk : ${!r2.ok ? "✅" : "❌"} ${!r2.ok ? r2.error : "ACCEPTED (bug!)"}`);

  // V3. Reject verdict invalide
  const invalidVerdict = { ...validBrief, verdict: "MAYBE" };
  const r3 = parseLeadBriefV2WithError(invalidVerdict);
  console.log(`V3 Reject verdict "MAYBE" : ${!r3.ok ? "✅" : "❌"} ${!r3.ok ? r3.error.slice(0, 80) : "ACCEPTED"}`);

  // V4. Reject confidence > 100
  const invalidConf = { ...validBrief, confidence: 150 };
  const r4 = parseLeadBriefV2WithError(invalidConf);
  console.log(`V4 Reject confidence=150 : ${!r4.ok ? "✅" : "❌"} ${!r4.ok ? r4.error.slice(0, 80) : "ACCEPTED"}`);

  // V5. Accepte enrichmentNeeded optionnel (verdict=ENRICH)
  const enrichBrief = { ...validBrief, verdict: "ENRICH", enrichmentNeeded: ["taille réelle Pappers", "stack tech homepage"] };
  const r5 = parseLeadBriefV2(enrichBrief);
  console.log(`V5 Accepte ENRICH + enrichmentNeeded : ${r5 ? "✅" : "❌"} verdict=${r5?.verdict} needs=${r5?.enrichmentNeeded?.length}`);

  // V6. Type guard isLeadBriefV2
  const guardOk = isLeadBriefV2(validBrief) && !isLeadBriefV2({ verdict: "OUI" });
  console.log(`V6 Type guard isLeadBriefV2 : ${guardOk ? "✅" : "❌"}`);

  // M1. DB write/read briefV2Json sur 1 trigger DTL
  const client = await db.client.findUnique({ where: { slug: "digitestlab" }, select: { id: true } });
  // Filter Json NULL Prisma 6 nécessite Prisma.DbNull — on prend juste un
  // trigger récent et on restaure briefV2Json=null en cleanup.
  const sample = await db.trigger.findFirst({
    where: { clientId: client.id, deletedAt: null },
    select: { id: true, companyName: true, briefV2Json: true },
    orderBy: { capturedAt: "desc" },
  });
  if (sample && r1) {
    await db.trigger.update({
      where: { id: sample.id },
      data: { briefV2Json: r1 },
    });
    const back = await db.trigger.findUnique({
      where: { id: sample.id },
      select: { briefV2Json: true },
    });
    const parsed = parseLeadBriefV2(back?.briefV2Json);
    const roundtripOk = parsed?.verdict === "OUI" && parsed?.confidence === 87 && parsed?.risks.length === 2;
    console.log(`M1 DB roundtrip [${sample.companyName}] : ${roundtripOk ? "✅" : "❌"} verdict=${parsed?.verdict} risks=${parsed?.risks?.length}`);
    // Cleanup pour ne pas polluer la DB
    await db.trigger.update({
      where: { id: sample.id },
      data: { briefV2Json: null },
    });
    console.log(`M1 Cleanup briefV2Json=null : ✅`);
  }

  // M2. Vérifier que l'absence du champ ne casse pas les lectures Trigger existantes
  const all = await db.trigger.findMany({
    where: { clientId: client.id, deletedAt: null },
    select: { id: true, briefV2Json: true },
    take: 5,
  });
  const allNull = all.every((t) => t.briefV2Json === null);
  console.log(`M2 Lecture 5 triggers existants briefV2Json=null : ${allNull ? "✅" : "❌"}`);

  console.log("");
  await db.$disconnect();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
