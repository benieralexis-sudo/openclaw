// @ts-nocheck — Pipeline manuel post-restauration : créer Leads shell pour
// les 4 triggers BOAMP Digidemat sans Lead (CNFPT, CD Calvados, CH Lens,
// SICIO) puis lancer HarvestAPI pour trouver le décideur (DSI/DPO/Direction
// Achats des collectivités cibles).
//
// Utilise le code source local (patché bug regex pruning) sans passer par
// l'API HTTP du serveur (qui tourne sur l'ancien build jusqu'au prochain deploy).

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");
  const { ensureLeadsForAllTriggers } = await import("../src/lib/ensure-lead-for-trigger");
  const { enrichDecisionMakersForClient } = await import("../src/lib/harvestapi-decision-makers");

  const client = await db.client.findUnique({
    where: { slug: "digidemat" },
    select: { id: true, slug: true },
  });
  if (!client) {
    console.error("client digidemat introuvable");
    process.exit(1);
  }
  console.log(`✓ client digidemat : ${client.id}`);

  // Étape 1 : créer Leads shells pour les triggers sans Lead
  console.log("\n━━━ Étape 1 — ensureLeadsForAllTriggers ━━━");
  const leadsStats = await ensureLeadsForAllTriggers(client.id);
  console.log(JSON.stringify(leadsStats, null, 2));

  // Vérif état avant HarvestAPI
  const before = await db.lead.findMany({
    where: {
      clientId: client.id,
      companySiret: { in: ["784621435", "180014045", "517974432", "266209329", "259400117"] },
      deletedAt: null,
    },
    select: {
      companySiret: true,
      companyName: true,
      status: true,
      firstName: true,
      lastName: true,
      linkedinUrl: true,
      harvestapiAttemptedAt: true,
    },
  });
  console.log("\n━━━ Leads des 5 Pépites avant HarvestAPI ━━━");
  for (const l of before) {
    console.log(`  ${l.companySiret} ${l.companyName} [${l.status}] persona=${l.firstName ?? "—"} ${l.lastName ?? ""} LI=${l.linkedinUrl ?? "—"} attempted=${l.harvestapiAttemptedAt?.toISOString() ?? "never"}`);
  }

  // Étape 2 : HarvestAPI search-by-company
  console.log("\n━━━ Étape 2 — enrichDecisionMakersForClient (HarvestAPI Apify) ━━━");
  console.log("  ⏳ Crédits Apify consommés selon nb de profils scannés (~$0.004/profile × maxItems)");
  const harvestStats = await enrichDecisionMakersForClient(client.id, { limit: 10 });
  console.log(JSON.stringify(harvestStats, null, 2));

  // Vérif état après
  const after = await db.lead.findMany({
    where: {
      clientId: client.id,
      companySiret: { in: ["784621435", "180014045", "517974432", "266209329", "259400117"] },
      deletedAt: null,
    },
    select: {
      companySiret: true,
      companyName: true,
      status: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      linkedinUrl: true,
      personaTier: true,
      personaSource: true,
    },
  });
  console.log("\n━━━ Leads des 5 Pépites après HarvestAPI ━━━");
  for (const l of after) {
    console.log(`  ${l.companySiret} ${l.companyName}`);
    console.log(`    [${l.status}] tier=${l.personaTier ?? "—"} src=${l.personaSource ?? "—"}`);
    console.log(`    persona: ${l.firstName ?? "—"} ${l.lastName ?? ""} | ${l.jobTitle ?? "—"}`);
    console.log(`    LI: ${l.linkedinUrl ?? "—"}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
