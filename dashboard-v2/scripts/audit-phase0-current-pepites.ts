// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.1 — Les 16 leads NEW actuels = état du pool Fred aujourd'hui
 * Plus 8 leads ENRICHED = en cours d'enrichissement
 * Verdict V2 + signaux + contactabilité + ancienneté
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true },
  });
  if (!client) process.exit(1);

  // Tous les leads NEW + ENRICHED DTL = "pool actif" Fred
  const activePool = await db.lead.findMany({
    where: {
      clientId: client.id,
      status: { in: ["NEW", "ENRICHED"] },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyName: true,
      companySiret: true,
      fullName: true,
      jobTitle: true,
      personaTier: true,
      personaSource: true,
      email: true,
      emailStatus: true,
      phone: true,
      linkedinUrl: true,
      status: true,
      enrichedAt: true,
      createdAt: true,
      trigger: {
        select: {
          sourceCode: true,
          score: true,
          isHot: true,
          title: true,
          briefV2Json: true,
          companyNaf: true,
          industry: true,
          size: true,
          capturedAt: true,
          publishedAt: true,
        },
      },
    },
  });

  console.log(`\n📊 AUDIT — Pool ACTIF DTL (NEW + ENRICHED)\n`);
  console.log(`Total leads actifs : ${activePool.length}`);
  console.log(`  - NEW (jugés OUI/ENRICH par Brain, attente Fred) : ${
    activePool.filter((l) => l.status === "NEW").length
  }`);
  console.log(`  - ENRICHED (enrichissement complet, prêt à contacter) : ${
    activePool.filter((l) => l.status === "ENRICHED").length
  }`);

  // Tier qualité pool : score, contactabilité, fraîcheur
  let pepiteHot = 0; // score>=9 + email + LinkedIn
  let pepiteWarm = 0; // score>=7 + email + LinkedIn
  let pepiteTepid = 0; // score>=6 ou contact incomplet
  let needsEnrich = 0;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 Détail pool actif (ordre antichronologique)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  for (const l of activePool) {
    const t = l.trigger;
    const score = t?.score ?? 0;
    const hasEmail = !!l.email && l.emailStatus === "VALID";
    const hasLI = !!l.linkedinUrl;
    const hasPhone = !!l.phone;
    const ageDays = Math.floor(
      (Date.now() - l.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Tier classification
    let tier = "TEPID";
    if (score >= 9 && hasEmail && hasLI) {
      tier = "HOT 🔥";
      pepiteHot++;
    } else if (score >= 7 && hasEmail && hasLI) {
      tier = "WARM";
      pepiteWarm++;
    } else if (score >= 6) {
      tier = "TEPID";
      pepiteTepid++;
    } else {
      needsEnrich++;
    }

    const v2 = t?.briefV2Json as any;
    const verdict = v2?.verdict ?? "?";
    const conf = v2?.confidence ?? "?";
    const thesis = (v2?.thesis ?? "").slice(0, 100);

    console.log(`\n${tier} | ${l.status} | age ${ageDays}j | score=${score} | ${t?.sourceCode}`);
    console.log(`   ${l.companyName} ${t?.companyNaf ? `(NAF ${t.companyNaf})` : ""} ${t?.size ? `| ${t.size}` : ""}`);
    console.log(`   Persona: ${l.fullName ?? "?"} (${l.jobTitle ?? "?"}) tier=${l.personaTier ?? "?"} src=${l.personaSource ?? "?"}`);
    console.log(`   Contact: email=${hasEmail ? "✅" : "❌"}${l.email ? ` ${l.email}` : ""} | LI=${hasLI ? "✅" : "❌"} | phone=${hasPhone ? "✅" : "❌"}`);
    console.log(`   V2: ${verdict} conf=${conf} | "${thesis}"`);
    console.log(`   Trigger: "${(t?.title ?? "").slice(0, 80)}"`);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔥 SYNTHÈSE POOL ACTIF`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   HOT (score≥9 + email + LinkedIn) : ${pepiteHot}`);
  console.log(`   WARM (score≥7 + email + LinkedIn) : ${pepiteWarm}`);
  console.log(`   TEPID (score≥6 mais contact incomplet) : ${pepiteTepid}`);
  console.log(`   Incomplete (score<6) : ${needsEnrich}`);

  // Sources : qui produit ces Pépites actives ?
  const bySource: Record<string, number> = {};
  for (const l of activePool) {
    const s = l.trigger?.sourceCode ?? "(no_trigger)";
    bySource[s] = (bySource[s] ?? 0) + 1;
  }
  console.log(`\n📊 Sources du pool actif :`);
  for (const [s, c] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${s.padEnd(35)} : ${c}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
