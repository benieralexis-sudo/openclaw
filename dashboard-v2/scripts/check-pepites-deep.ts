// @ts-nocheck — investigation profonde 5 Pépites
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const PEPITES = [
  { name: "UCANSS", siret: "784621435", patterns: ["UCANSS", "Sécurité Sociale"] },
  { name: "CNFPT", siret: "180014045", patterns: ["CNFPT", "Centre National Fonction Publique Territoriale"] },
  { name: "CD Calvados", siret: "517974432", patterns: ["Calvados", "Département du Calvados"] },
  { name: "CH Lens", siret: "266209329", patterns: ["LENS", "Centre Hospitalier de Lens", "Artois"] },
  { name: "SICIO", siret: "259400117", patterns: ["SICIO"] },
];

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digidemat" },
    select: { id: true },
  });
  if (!client) process.exit(1);

  for (const p of PEPITES) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔍 ${p.name} (SIRET ${p.siret})`);

    // Recherche par SIRET sans filtre deletedAt
    const bySiret = await db.trigger.findMany({
      where: { clientId: client.id, companySiret: p.siret },
      select: {
        id: true,
        sourceCode: true,
        companyName: true,
        title: true,
        score: true,
        status: true,
        deletedAt: true,
        ignoredAt: true,
        ignoredReason: true,
        capturedAt: true,
        briefV2Json: true,
      },
      orderBy: { capturedAt: "desc" },
    });
    console.log(`  Triggers par SIRET (any state): ${bySiret.length}`);
    for (const t of bySiret) {
      console.log(`    [${t.sourceCode}] status=${t.status} deletedAt=${t.deletedAt?.toISOString() ?? "—"} ignoredAt=${t.ignoredAt?.toISOString() ?? "—"} reason=${t.ignoredReason ?? "—"}`);
      console.log(`      title: ${t.title}`);
      console.log(`      score=${t.score} captured=${t.capturedAt.toISOString()}`);
      if (t.briefV2Json) {
        const b = t.briefV2Json as any;
        console.log(`      briefV2 keys: ${Object.keys(b).join(", ")}`);
        console.log(`      verdict=${b.opusVerdict ?? b.verdict ?? "—"}  conf=${b.opusConfidence ?? b.confidence ?? "—"}`);
        if (b.opener) console.log(`      opener: ${String(b.opener).slice(0, 200)}…`);
      } else {
        console.log(`      briefV2Json: NULL`);
      }
    }

    // Recherche par companyName patterns
    for (const pattern of p.patterns) {
      const byName = await db.trigger.findMany({
        where: {
          clientId: client.id,
          companyName: { contains: pattern, mode: "insensitive" },
        },
        select: {
          id: true,
          sourceCode: true,
          companySiret: true,
          companyName: true,
          title: true,
          status: true,
          deletedAt: true,
          score: true,
          capturedAt: true,
        },
        orderBy: { capturedAt: "desc" },
        take: 5,
      });
      if (byName.length > 0) {
        console.log(`  Triggers par nom "${pattern}": ${byName.length}`);
        for (const t of byName) {
          console.log(`    [${t.sourceCode}] SIRET=${t.companySiret ?? "—"} name=${t.companyName} status=${t.status} del=${t.deletedAt?.toISOString().slice(0, 10) ?? "—"} score=${t.score}`);
          console.log(`      title: ${t.title.slice(0, 100)}`);
        }
      }
    }

    // Leads pour ce SIRET (any state)
    const leads = await db.lead.findMany({
      where: { clientId: client.id, companySiret: p.siret },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        fullName: true,
        jobTitle: true,
        linkedinUrl: true,
        email: true,
        triggerId: true,
        createdAt: true,
      },
    });
    console.log(`  Leads par SIRET (any state): ${leads.length}`);
    for (const l of leads) {
      console.log(`    [${l.status}] del=${l.deletedAt?.toISOString().slice(0, 10) ?? "—"} ${l.fullName ?? "—"} | ${l.jobTitle ?? "—"} | LI=${l.linkedinUrl ?? "—"} | trigger=${l.triggerId ?? "—"}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
