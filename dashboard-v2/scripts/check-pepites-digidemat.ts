// @ts-nocheck — script ad hoc vérif 5 Pépites Digidemat 20/05/2026
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const PEPITE_SIRETS = [
  { name: "UCANSS", siret: "784621435", dl: "15 juin" },
  { name: "CNFPT", siret: "180014045", dl: "18 mai ⚠️" },
  { name: "CD Calvados", siret: "517974432", dl: "—" },
  { name: "CH Lens", siret: "266209329", dl: "—" },
  { name: "SICIO", siret: "259400117", dl: "11 juin" },
];

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digidemat" },
    select: { id: true, slug: true, status: true },
  });
  if (!client) {
    console.error("❌ client digidemat introuvable");
    process.exit(1);
  }
  console.log(`✓ client digidemat : ${client.id} (${client.status})`);
  console.log("");

  for (const p of PEPITE_SIRETS) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎯 ${p.name} — SIRET ${p.siret} — DL ${p.dl}`);

    const triggers = await db.trigger.findMany({
      where: {
        clientId: client.id,
        companySiret: p.siret,
        deletedAt: null,
      },
      select: {
        id: true,
        sourceCode: true,
        signalCode: true,
        sourceUrl: true,
        companyName: true,
        companyNaf: true,
        title: true,
        detail: true,
        score: true,
        priorityScore: true,
        isHot: true,
        isCombo: true,
        status: true,
        briefV2Json: true,
        publishedAt: true,
        capturedAt: true,
      },
      orderBy: { capturedAt: "desc" },
    });

    console.log(`  Triggers (${triggers.length}):`);
    for (const t of triggers) {
      const v = (t.briefV2Json as any)?.opusVerdict ?? "—";
      const c = (t.briefV2Json as any)?.opusConfidence ?? "—";
      const opener = (t.briefV2Json as any)?.opener;
      console.log(
        `    [${t.sourceCode}/${t.signalCode}] score=${t.score} prio=${t.priorityScore} isHot=${t.isHot} combo=${t.isCombo} status=${t.status} verdict=${v} conf=${c} naf=${t.companyNaf}`,
      );
      console.log(`      title: ${(t.title || "").slice(0, 110)}`);
      console.log(`      detail: ${(t.detail || "").slice(0, 110)}`);
      console.log(`      url: ${t.sourceUrl || "—"}`);
      if (opener) console.log(`      opener: ${String(opener).slice(0, 180)}…`);
    }

    const leads = await db.lead.findMany({
      where: {
        clientId: client.id,
        companySiret: p.siret,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        firstName: true,
        lastName: true,
        fullName: true,
        jobTitle: true,
        linkedinUrl: true,
        email: true,
        phone: true,
        personaTier: true,
        personaSource: true,
        createdAt: true,
      },
    });

    console.log(`  Leads (${leads.length}):`);
    for (const l of leads) {
      console.log(
        `    [${l.status}] ${l.fullName || "—"} | ${l.jobTitle || "—"} | tier=${l.personaTier} src=${l.personaSource}`,
      );
      console.log(
        `      linkedinUrl: ${l.linkedinUrl || "—"} | email: ${l.email || "—"} | phone: ${l.phone || "—"}`,
      );
    }
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
