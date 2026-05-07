// @ts-nocheck — audit script Sprint D.0
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
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");
  const { buildLeadDossierForJudge, formatDossierForOpus } = await import("../src/lib/lead-dossier");

  const client = await db.client.findUnique({ where: { slug: "digitestlab" }, select: { id: true } });
  if (!client) throw new Error("DTL not found");

  console.log("\n=== AUDIT D.0 — chemins alternatifs ===");

  // B1. Idempotence
  try {
    const scored = await db.trigger.findFirst({
      where: { clientId: client.id, deletedAt: null, scoreReason: { not: null }, score: { gte: 7 } },
      select: { id: true, score: true, isHot: true, scoreReason: true, companyName: true },
    });
    if (scored) {
      const t0 = Date.now();
      const result = await qualifyTrigger(scored.id);
      const elapsed = Date.now() - t0;
      const sameScore = result?.opusScore === scored.score;
      const sameReason = result?.reason === scored.scoreReason;
      console.log(`B1 IDEMPOTENCE [${scored.companyName}] : ${elapsed < 100 ? "✅" : "❌"} ${elapsed}ms (devrait <100ms — pas Opus). Score=${result?.opusScore} ${sameScore ? "✅" : "❌"}. ReasonMatch=${sameReason ? "✅" : "❌"}`);
    }
  } catch (e) { console.log(`B1 IDEMPOTENCE ❌ ERR: ${e.message}`); }

  // B2. Pre-Opus reject
  try {
    const regie = await db.trigger.findFirst({
      where: {
        clientId: client.id, deletedAt: null,
        scoreReason: { contains: "C4-C5 pre-opus-reject", mode: "insensitive" },
      },
      select: { id: true, scoreReason: true, companyName: true, status: true },
    });
    if (regie) {
      const t0 = Date.now();
      const result = await qualifyTrigger(regie.id, { force: true });
      const elapsed = Date.now() - t0;
      const stillRejected = result?.opusScore === 2 && result?.reason?.includes("pre-opus-reject");
      console.log(`B2 PRE-REJECT [${regie.companyName}] : ${stillRejected ? "✅" : "❌"} ${elapsed}ms (devrait <500ms — pas Opus, pas dossier). Score=${result?.opusScore}`);
    } else {
      console.log("B2 PRE-REJECT : ⚠️ aucun trigger pre-rejected trouvé");
    }
  } catch (e) { console.log(`B2 PRE-REJECT ❌ ERR: ${e.message}`); }

  // B3. Trigger sans Lead
  try {
    const noLead = await db.trigger.findFirst({
      where: { clientId: client.id, deletedAt: null, lead: null, scoreReason: { not: null } },
      select: { id: true, companyName: true, score: true },
    });
    if (noLead) {
      const dossier = await buildLeadDossierForJudge(noLead.id);
      const expectedPersona = dossier?.blocks.persona.includes("non encore calculée");
      console.log(`B3 SANS LEAD [${noLead.companyName}] : dossier built=${dossier ? "✅" : "❌"}, persona "non encore calculée"=${expectedPersona ? "✅" : "❌"}`);
    } else {
      console.log("B3 SANS LEAD : ⚠️ tous les triggers DTL ont un Lead");
    }
  } catch (e) { console.log(`B3 SANS LEAD ❌ ERR: ${e.message}`); }

  // B5. Pseudo-SIRET (FT- prefix de rss-levees)
  try {
    const pseudo = await db.trigger.findFirst({
      where: {
        clientId: client.id, deletedAt: null,
        companySiret: { startsWith: "FT" },
        scoreReason: { not: null },
      },
      select: { id: true, companyName: true, companySiret: true },
    });
    if (pseudo) {
      const dossier = await buildLeadDossierForJudge(pseudo.id);
      const noCrossTenant = dossier?.blocks.crossTenant === "";
      const noPrior = dossier?.blocks.priorSignals === "";
      console.log(`B5 PSEUDO-SIRET [${pseudo.companyName}, ${pseudo.companySiret}] : crossTenant vide=${noCrossTenant ? "✅" : "❌"}, prior vide=${noPrior ? "✅" : "❌"}`);
    } else {
      console.log("B5 PSEUDO-SIRET : ⚠️ pas de trigger pseudo-SIRET DTL");
    }
  } catch (e) { console.log(`B5 PSEUDO-SIRET ❌ ERR: ${e.message}`); }

  // E1. Structure userPrompt
  try {
    const sample = await db.trigger.findFirst({
      where: { clientId: client.id, deletedAt: null, scoreReason: { not: null }, score: { gte: 7 } },
      select: { id: true },
    });
    if (sample) {
      const dossier = await buildLeadDossierForJudge(sample.id);
      if (dossier) {
        const prompt = formatDossierForOpus(dossier);
        const checks = {
          CLIENT: prompt.includes("CLIENT :"),
          ICP: prompt.includes("ICP :"),
          LEAD: prompt.includes("LEAD :"),
          SIGNAL: prompt.includes("SIGNAL :"),
          Évalue: prompt.includes("Évalue ce lead"),
        };
        const allOk = Object.values(checks).every(Boolean);
        console.log(`E1 PROMPT STRUCTURE : ${allOk ? "✅" : "❌"} ${JSON.stringify(checks)} length=${prompt.length}c (~${Math.round(prompt.length/4)}tk)`);
      }
    }
  } catch (e) { console.log(`E1 PROMPT ❌ ERR: ${e.message}`); }

  console.log("");
  await db.$disconnect();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
