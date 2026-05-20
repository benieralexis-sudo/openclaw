// @ts-nocheck — AUDIT BUSINESS — Sommes-nous là où on a promis d'être ?
//
// Promesses iFIND Growth 390€/mois :
//   - 100 leads qualifiés / mois inclus
//   - 6 Pépites minimum garanties / mois (sinon quota doublé mois suivant)
//   - Coût variable réel cible : ~$93/mo → marge 77%
//
// Comparé à la réalité 30 derniers jours par client.

import { db } from "@/lib/db";

function fmt(n: number, w = 5): string { return String(n).padStart(w, " "); }
function pct(n: number, total: number): string { return total > 0 ? `${((n/total)*100).toFixed(0)}%` : "0%"; }
function dollars(n: number): string { return `$${n.toFixed(2)}`; }

async function main() {
  const now = Date.now();
  const days30 = new Date(now - 30 * 86400 * 1000);
  const days7 = new Date(now - 7 * 86400 * 1000);
  const days1 = new Date(now - 1 * 86400 * 1000);

  // ═══════════════════════════════════════════════════════════════
  // AXE A — FUNNEL 30J par client (la vraie performance business)
  // ═══════════════════════════════════════════════════════════════
  console.log("━".repeat(80));
  console.log("AXE A — FUNNEL 30j (capté → livré → utilisé) par client");
  console.log("━".repeat(80));

  const clients = await db.client.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, status: true },
  });

  for (const c of clients) {
    const triggersCaptured = await db.trigger.count({
      where: { clientId: c.id, deletedAt: null, capturedAt: { gte: days30 } },
    });
    const triggersBriefed = await db.trigger.count({
      where: {
        clientId: c.id, deletedAt: null, capturedAt: { gte: days30 },
        briefV2Json: { not: { equals: null as any } },
      },
    });
    const verdictOui = await db.trigger.count({
      where: {
        clientId: c.id, deletedAt: null, capturedAt: { gte: days30 },
        briefV2Json: { path: ["verdict"], equals: "OUI" },
      },
    });
    const verdictNon = await db.trigger.count({
      where: {
        clientId: c.id, deletedAt: null, capturedAt: { gte: days30 },
        briefV2Json: { path: ["verdict"], equals: "NON" },
      },
    });
    const verdictEnrich = await db.trigger.count({
      where: {
        clientId: c.id, deletedAt: null, capturedAt: { gte: days30 },
        briefV2Json: { path: ["verdict"], equals: "ENRICH" },
      },
    });
    const leadsCreated = await db.lead.count({
      where: { clientId: c.id, deletedAt: null, createdAt: { gte: days30 } },
    });
    const leadsNew = await db.lead.count({
      where: { clientId: c.id, deletedAt: null, status: "NEW", createdAt: { gte: days30 } },
    });
    const leadsEnriched = await db.lead.count({
      where: { clientId: c.id, deletedAt: null, status: "ENRICHED", createdAt: { gte: days30 } },
    });
    const leadsContacted = await db.lead.count({
      where: { clientId: c.id, deletedAt: null, status: "CONTACTED" },
    });
    const leadsReplied = await db.lead.count({
      where: { clientId: c.id, status: { in: ["NOT_INTERESTED"] } },
    });

    // Pépites livrables = verdict OUI ET Lead pas archivé (le commercial peut bosser)
    const pepitesLivrables = await db.lead.count({
      where: {
        clientId: c.id, deletedAt: null, status: { in: ["NEW", "ENRICHED", "INCOMPLETE"] },
        trigger: { briefV2Json: { path: ["verdict"], equals: "OUI" }, deletedAt: null },
      },
    });
    // Pépites RÉELLEMENT envoyables (persona + LI + email)
    const pepitesPretes = await db.lead.count({
      where: {
        clientId: c.id, deletedAt: null, status: { in: ["NEW", "ENRICHED"] },
        firstName: { not: null }, lastName: { not: null },
        linkedinUrl: { not: null }, email: { not: null },
        trigger: { briefV2Json: { path: ["verdict"], equals: "OUI" }, deletedAt: null },
      },
    });

    console.log(`\n[${c.name}] (${c.status})`);
    console.log(`  Triggers captés 30j:           ${fmt(triggersCaptured)}`);
    console.log(`  Triggers briefés Opus:         ${fmt(triggersBriefed)} (${pct(triggersBriefed, triggersCaptured)})`);
    console.log(`  Verdicts 30j:`);
    console.log(`    OUI  ${fmt(verdictOui)}  (${pct(verdictOui, triggersBriefed)} des briefés)`);
    console.log(`    NON  ${fmt(verdictNon)}  (${pct(verdictNon, triggersBriefed)} des briefés)`);
    console.log(`    ENRICH ${fmt(verdictEnrich)} (${pct(verdictEnrich, triggersBriefed)} des briefés)`);
    console.log(`  Leads créés 30j:               ${fmt(leadsCreated)}`);
    console.log(`    dont status NEW              ${fmt(leadsNew)}`);
    console.log(`    dont status ENRICHED         ${fmt(leadsEnriched)}`);
    console.log(`  💎 Pépites livrables (Total):  ${fmt(pepitesLivrables)}`);
    console.log(`  ✅ Pépites READY (persona+LI+email): ${fmt(pepitesPretes)}`);
    console.log(`  📞 Leads CONTACTED (Fred a bossé): ${fmt(leadsContacted)}`);
    console.log(`  🚫 Leads NOT_INTERESTED:       ${fmt(leadsReplied)}`);

    // Vérif vs promesse commerciale (390€/mois Growth)
    console.log(`\n  PROMESSE iFIND Growth 390€/mois :`);
    const promiseLeads = 100;
    const promisePepites = 6;
    console.log(`    Leads/mois : ${leadsCreated}/${promiseLeads}  ${leadsCreated >= promiseLeads ? "✅" : "❌ MANQUE " + (promiseLeads - leadsCreated)}`);
    console.log(`    Pépites/mois : ${pepitesLivrables}/${promisePepites}  ${pepitesLivrables >= promisePepites ? "✅" : "❌ MANQUE " + (promisePepites - pepitesLivrables)}`);
    console.log(`    Pépites READY-to-send : ${pepitesPretes}/${promisePepites}  ${pepitesPretes >= promisePepites ? "✅" : "⚠️  manque enrichissement"}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE B — Performance par SIGNAL / SOURCE (qu'est-ce qui marche ?)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE B — ROI par SOURCE 30j (volume × OUI rate × Pépites livrables)");
  console.log("━".repeat(80));

  for (const c of clients.filter(c => c.status === "ACTIVE")) {
    const bySrc = await db.trigger.groupBy({
      by: ["sourceCode"],
      where: { clientId: c.id, deletedAt: null, capturedAt: { gte: days30 } },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    });
    console.log(`\n[${c.name}] sources 30j:`);
    console.log(`  ${"Source".padEnd(30)} | ${"Captés".padStart(8)} | ${"Briefés".padStart(8)} | ${"OUI".padStart(5)} | ${"OUI%".padStart(6)} | ${"Pépites".padStart(8)}`);
    console.log(`  ${"-".repeat(30)}-+-${"-".repeat(8)}-+-${"-".repeat(8)}-+-${"-".repeat(5)}-+-${"-".repeat(6)}-+-${"-".repeat(8)}`);
    for (const s of bySrc.slice(0, 15)) {
      const oui = await db.trigger.count({
        where: {
          clientId: c.id, deletedAt: null, sourceCode: s.sourceCode,
          capturedAt: { gte: days30 },
          briefV2Json: { path: ["verdict"], equals: "OUI" },
        },
      });
      const briefed = await db.trigger.count({
        where: {
          clientId: c.id, deletedAt: null, sourceCode: s.sourceCode,
          capturedAt: { gte: days30 },
          briefV2Json: { not: { equals: null as any } },
        },
      });
      const pepites = await db.lead.count({
        where: {
          clientId: c.id, deletedAt: null,
          status: { in: ["NEW", "ENRICHED", "INCOMPLETE"] },
          trigger: {
            deletedAt: null, sourceCode: s.sourceCode,
            briefV2Json: { path: ["verdict"], equals: "OUI" },
          },
        },
      });
      const ouiRate = briefed > 0 ? ((oui/briefed)*100).toFixed(0) + "%" : "0%";
      console.log(`  ${s.sourceCode.padEnd(30)} | ${String(s._count._all).padStart(8)} | ${String(briefed).padStart(8)} | ${String(oui).padStart(5)} | ${ouiRate.padStart(6)} | ${String(pepites).padStart(8)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE C — Cadence et fraîcheur du pipeline
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE C — Cadence / fraîcheur signaux par client");
  console.log("━".repeat(80));

  for (const c of clients) {
    const dernier = await db.trigger.findFirst({
      where: { clientId: c.id, deletedAt: null },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true, sourceCode: true, companyName: true },
    });
    const last7days = await db.trigger.count({
      where: { clientId: c.id, deletedAt: null, capturedAt: { gte: days7 } },
    });
    const last1day = await db.trigger.count({
      where: { clientId: c.id, deletedAt: null, capturedAt: { gte: days1 } },
    });

    console.log(`\n[${c.name}]`);
    console.log(`  Dernier trigger : ${dernier?.capturedAt.toISOString()?.slice(0,16)} (${dernier?.sourceCode} / ${dernier?.companyName})`);
    const ageH = dernier ? (now - dernier.capturedAt.getTime()) / 3600000 : 0;
    console.log(`  Âge dernier trigger : ${ageH.toFixed(1)}h ${ageH > 24 ? "⚠️ stale" : "✅"}`);
    console.log(`  Volume 7j  : ${last7days}`);
    console.log(`  Volume 24h : ${last1day} (avg = ${(last1day/24).toFixed(1)}/h)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE D — Vélocité Trigger→Pépite envoyable (jours)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE D — Vélocité Trigger→Pépite ready");
  console.log("━".repeat(80));

  for (const c of clients) {
    const readyPepites = await db.lead.findMany({
      where: {
        clientId: c.id, deletedAt: null,
        status: { in: ["NEW", "ENRICHED"] },
        firstName: { not: null }, lastName: { not: null },
        linkedinUrl: { not: null }, email: { not: null },
        trigger: { briefV2Json: { path: ["verdict"], equals: "OUI" }, deletedAt: null },
        createdAt: { gte: days30 },
      },
      select: { createdAt: true, enrichedAt: true, trigger: { select: { capturedAt: true } } },
    });
    if (readyPepites.length === 0) {
      console.log(`\n[${c.name}] : 0 Pépite ready sur 30j → vélocité non mesurable`);
      continue;
    }
    const lags = readyPepites.map(p => {
      const triggerT = p.trigger?.capturedAt?.getTime() ?? 0;
      const enrichT = p.enrichedAt?.getTime() ?? p.createdAt.getTime();
      return Math.max(0, (enrichT - triggerT) / 86400 / 1000);
    });
    const avg = lags.reduce((a, b) => a + b, 0) / lags.length;
    const max = Math.max(...lags);
    const min = Math.min(...lags);
    console.log(`\n[${c.name}] sur ${readyPepites.length} Pépites ready 30j :`);
    console.log(`  Vélocité moyenne Trigger→Pépite ready : ${avg.toFixed(1)} jours`);
    console.log(`  Min : ${min.toFixed(1)}j  | Max : ${max.toFixed(1)}j`);
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE E — Engagement commercial (Fred utilise vraiment ?)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE E — Engagement commercial");
  console.log("━".repeat(80));

  for (const c of clients) {
    const leadStatus = await db.lead.groupBy({
      by: ["status"],
      where: { clientId: c.id, deletedAt: null },
      _count: { _all: true },
    });
    const total = leadStatus.reduce((a, b) => a + b._count._all, 0);
    const contacted = leadStatus.find(s => s.status === "CONTACTED")?._count._all ?? 0;
    const notInt = leadStatus.find(s => s.status === "NOT_INTERESTED")?._count._all ?? 0;
    const contactable = leadStatus.find(s => s.status === "CONTACTABLE")?._count._all ?? 0;
    console.log(`\n[${c.name}]`);
    console.log(`  Status flow : NEW → CONTACTABLE → CONTACTED → (NOT_INTERESTED ou meeting)`);
    console.log(`  CONTACTED total : ${contacted}`);
    console.log(`  NOT_INTERESTED : ${notInt}`);
    console.log(`  CONTACTABLE en attente : ${contactable}`);
    if (contacted === 0 && total > 5) {
      console.log(`  ⚠️  0 lead CONTACTED — le commercial n'utilise PAS l'outil`);
    }
  }

  await db.$disconnect();
}

main().catch(e => { console.error("AUDIT FAIL:", e); process.exit(1); });
