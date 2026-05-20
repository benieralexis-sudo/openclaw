// @ts-nocheck — Investigation des 4 Pépites OUI bloquées en IGNORED + 254 orphelins
import { db } from "@/lib/db";

async function main() {
  console.log("━".repeat(80));
  console.log("PÉPITES PERDUES — Verdict OUI mais Trigger IGNORED");
  console.log("━".repeat(80));

  const lost = await db.trigger.findMany({
    where: {
      deletedAt: null,
      briefV2Json: { path: ["verdict"], equals: "OUI" },
      status: "IGNORED",
    },
    select: {
      id: true, companyName: true, sourceCode: true, score: true,
      ignoredAt: true, ignoredReason: true, briefV2Json: true,
      updatedAt: true, capturedAt: true,
      client: { select: { name: true } },
      lead: { select: { id: true, status: true, firstName: true, deletedAt: true } },
    },
  });

  console.log(`Total Pépites perdues: ${lost.length}`);
  for (const t of lost) {
    const v = t.briefV2Json as any;
    console.log(`\n[${t.client.name}] ${t.companyName} (${t.sourceCode}, score=${t.score})`);
    console.log(`  Verdict=${v?.verdict} conf=${v?.confidence}%`);
    console.log(`  ignoredAt=${t.ignoredAt?.toISOString()?.slice(0,16)} reason=${t.ignoredReason?.slice(0,100)}`);
    console.log(`  capturedAt=${t.capturedAt.toISOString()?.slice(0,16)} updatedAt=${t.updatedAt.toISOString()?.slice(0,16)}`);
    console.log(`  Lead: ${t.lead ? `id=${t.lead.id.slice(0,12)} status=${t.lead.status} firstName=${t.lead.firstName ?? "(vide)"} archived=${!!t.lead.deletedAt}` : "(absent)"}`);
    console.log(`  Thesis: ${v?.thesis?.slice(0, 200)}`);
  }

  console.log("\n" + "━".repeat(80));
  console.log("254 TRIGGERS SANS LEAD — Investigation par source");
  console.log("━".repeat(80));

  const orphans = await db.trigger.groupBy({
    by: ["clientId", "sourceCode", "status"],
    where: { deletedAt: null, lead: { is: null } },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });

  console.log("Répartition par client × source × status :");
  for (const o of orphans.slice(0, 30)) {
    const cl = await db.client.findUnique({ where: { id: o.clientId }, select: { name: true } });
    console.log(`  ${cl?.name?.padEnd(15)} | ${o.sourceCode.padEnd(30)} | ${o.status.padEnd(10)} : ${o._count._all}`);
  }

  // Quel est l'âge moyen des orphelins ? Sont-ils anciens (avant fix ensureLeads) ou récents ?
  const ages = await db.trigger.findMany({
    where: { deletedAt: null, lead: { is: null } },
    select: { capturedAt: true, status: true, briefV2Json: true },
  });
  const now = Date.now();
  const byAge: Record<string, number> = { "<24h": 0, "1-7j": 0, "7-30j": 0, ">30j": 0 };
  let orphansWithOuiVerdict = 0;
  for (const t of ages) {
    const ageMs = now - new Date(t.capturedAt).getTime();
    const days = ageMs / 86400 / 1000;
    if (days < 1) byAge["<24h"]++;
    else if (days < 7) byAge["1-7j"]++;
    else if (days < 30) byAge["7-30j"]++;
    else byAge[">30j"]++;
    if ((t.briefV2Json as any)?.verdict === "OUI") orphansWithOuiVerdict++;
  }
  console.log("\nÂge des Triggers orphelins :");
  for (const [k, v] of Object.entries(byAge)) console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(`\n⚠️  Orphelins avec verdict OUI (Pépites doublement perdues): ${orphansWithOuiVerdict}`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
