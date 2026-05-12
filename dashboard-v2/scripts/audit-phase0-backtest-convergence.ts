// @ts-nocheck — script audit Phase 0 v3.0
/**
 * Backtest "règle convergence triple" sur 6 mois DTL.
 *
 * Pour chaque SIRET DTL avec ≥1 Trigger sur 180j, compter les sources
 * distinctes qui ont émis un signal dans une fenêtre 90j glissante.
 *
 * Croiser avec tagging A.0.2 (Pépite/OK/Hors/Junk) pour mesurer :
 *   - recall (sensibilité) : % vraies Pépites capturées par la règle
 *   - specificity : % faux positifs correctement filtrés
 *   - lift sur chaque seuil (≥2, ≥3, ≥4, ≥5)
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
import { readFileSync } from "node:fs";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true },
  });
  if (!client) process.exit(1);

  // Charger le tagging A.0.2 (CSV)
  const csv = readFileSync(
    "/opt/moltbot/audit/v3-phase-0/data/leads-tagged-6mois.csv",
    "utf-8",
  );
  const lines = csv.split("\n").slice(1).filter(Boolean);
  const taggedLeads: Record<string, { tag: string; companyName: string }> = {};
  for (const line of lines) {
    const cols = line.split(",");
    const leadId = cols[0];
    const companyName = cols[1].replace(/"/g, "");
    const tag = cols[15];
    taggedLeads[leadId] = { tag, companyName };
  }
  console.log(`Loaded ${Object.keys(taggedLeads).length} tagged leads`);

  // Récupérer TOUS les triggers DTL sur 180 jours (avec SIRET)
  const since = new Date();
  since.setMonth(since.getMonth() - 6);

  const triggers = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since },
      companySiret: { not: null },
    },
    select: {
      id: true,
      companySiret: true,
      companyName: true,
      sourceCode: true,
      capturedAt: true,
    },
    orderBy: { capturedAt: "asc" },
  });
  console.log(`Loaded ${triggers.length} triggers with SIRET sur 6 mois`);

  // Récupérer les Lead → Trigger pour mapper leadId → SIRET
  const leads = await db.lead.findMany({
    where: { clientId: client.id, createdAt: { gte: since } },
    select: { id: true, companySiret: true, triggerId: true },
  });
  const leadIdToSiret: Record<string, string | null> = {};
  for (const l of leads) leadIdToSiret[l.id] = l.companySiret;

  // Pour chaque trigger, calculer "nb de sources distinctes du même SIRET sur 90j glissants jusqu'à capturedAt"
  // Optimisation : grouper d'abord par SIRET
  const triggersBySiret: Record<string, Array<{ source: string; ts: Date }>> = {};
  for (const t of triggers) {
    const siret = t.companySiret!;
    if (!triggersBySiret[siret]) triggersBySiret[siret] = [];
    triggersBySiret[siret].push({ source: t.sourceCode, ts: t.capturedAt });
  }

  // Pour chaque lead, trouver son SIRET et le max de sources distinctes 90j avant Trigger.capturedAt
  const leadConvergence: Record<string, number> = {}; // leadId → maxSources

  for (const lead of leads) {
    const siret = lead.companySiret;
    if (!siret) {
      leadConvergence[lead.id] = 0;
      continue;
    }
    const triggersForSiret = triggersBySiret[siret] ?? [];
    // Trouver le Trigger associé au Lead pour fixer la "date de référence"
    const leadTrigger = triggers.find((t) => t.id === lead.triggerId);
    const refDate = leadTrigger?.capturedAt ?? lead.createdAt;
    // Compter sources distinctes 90j avant refDate
    const windowStart = new Date(refDate.getTime() - 90 * 24 * 3600 * 1000);
    const sourcesInWindow = new Set<string>();
    for (const tr of triggersForSiret) {
      if (tr.ts >= windowStart && tr.ts <= refDate) {
        sourcesInWindow.add(tr.source);
      }
    }
    leadConvergence[lead.id] = sourcesInWindow.size;
  }

  // Distribution
  const dist: Record<number, { total: number; green: number; yellow: number; red: number; black: number }> = {};
  for (const [leadId, conv] of Object.entries(leadConvergence)) {
    const tag = taggedLeads[leadId]?.tag ?? "?";
    if (!dist[conv]) dist[conv] = { total: 0, green: 0, yellow: 0, red: 0, black: 0 };
    dist[conv].total++;
    if (tag === "GREEN") dist[conv].green++;
    else if (tag === "YELLOW") dist[conv].yellow++;
    else if (tag === "RED") dist[conv].red++;
    else if (tag === "BLACK") dist[conv].black++;
  }

  console.log(`\n📊 BACKTEST CONVERGENCE — distribution sources distinctes 90j par lead\n`);
  console.log(`Sources distinctes | Total | 🟢 |🟡 |🔴 |⚫ | % Pépite | % Pépite+OK`);
  for (const [conv, v] of Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const pctGreen = ((v.green / v.total) * 100).toFixed(0);
    const pctUtile = (((v.green + v.yellow) / v.total) * 100).toFixed(0);
    console.log(
      `   ${conv.padStart(17)} | ${String(v.total).padStart(5)} | ${String(v.green).padStart(2)} | ${String(v.yellow).padStart(2)} | ${String(v.red).padStart(2)} | ${String(v.black).padStart(2)} | ${pctGreen.padStart(7)}% | ${pctUtile.padStart(10)}%`,
    );
  }

  // Application de la règle par seuil
  console.log(`\n🎯 SIMULATION RÈGLE DE CONVERGENCE\n`);
  console.log(`Seuil ≥X | Leads filtrés | 🟢 recall | 🟢🟡 recall | 🔴⚫ filtered | Précision`);

  const totals = {
    green: Object.values(dist).reduce((acc, v) => acc + v.green, 0),
    yellow: Object.values(dist).reduce((acc, v) => acc + v.yellow, 0),
    red: Object.values(dist).reduce((acc, v) => acc + v.red, 0),
    black: Object.values(dist).reduce((acc, v) => acc + v.black, 0),
  };
  const totalBad = totals.red + totals.black;

  for (const seuil of [1, 2, 3, 4, 5]) {
    let kept = 0;
    let keptGreen = 0;
    let keptYellow = 0;
    let keptRed = 0;
    let keptBlack = 0;
    for (const [conv, v] of Object.entries(dist)) {
      if (Number(conv) >= seuil) {
        kept += v.total;
        keptGreen += v.green;
        keptYellow += v.yellow;
        keptRed += v.red;
        keptBlack += v.black;
      }
    }
    const recallGreen = totals.green > 0 ? ((keptGreen / totals.green) * 100).toFixed(0) : "0";
    const recallUtile =
      totals.green + totals.yellow > 0
        ? (((keptGreen + keptYellow) / (totals.green + totals.yellow)) * 100).toFixed(0)
        : "0";
    const filteredBad = totalBad > 0 ? (((totalBad - keptRed - keptBlack) / totalBad) * 100).toFixed(0) : "0";
    const precisionUtile = kept > 0 ? (((keptGreen + keptYellow) / kept) * 100).toFixed(0) : "0";
    console.log(
      `   ≥${seuil}      |        ${String(kept).padStart(4)} |       ${recallGreen.padStart(2)}% |        ${recallUtile.padStart(2)}% |           ${filteredBad.padStart(2)}% |        ${precisionUtile.padStart(2)}%`,
    );
  }

  console.log(`\nNote :`);
  console.log(`   - Recall 🟢 = % vraies Pépites gardées par le filtre`);
  console.log(`   - Recall 🟢🟡 = % "exploitables" (Pépite+OK) gardés`);
  console.log(`   - Filtered 🔴⚫ = % faux positifs correctement jetés`);
  console.log(`   - Précision = % "utile" parmi les leads gardés (vs aléatoire)`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
