// @ts-nocheck — AUDIT PERFECTION 20/05/2026
// Objectif Alexis : système littéralement parfait de bout en bout.
// 7 axes : état J, coûts/caps, cohérence DB, multi-tenant, code, monitoring, ROI.
import { db } from "@/lib/db";

function fmt(n: number, w = 5): string { return String(n).padStart(w, " "); }
function pct(n: number, total: number): string { return total > 0 ? `${((n/total)*100).toFixed(0)}%` : "0%"; }

async function main() {
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86400 * 1000);

  // ═══════════════════════════════════════════════════════════════
  // AXE 1 — État J par client
  // ═══════════════════════════════════════════════════════════════
  console.log("━".repeat(80));
  console.log("AXE 1 — État du jour par client");
  console.log("━".repeat(80));

  const clients = await db.client.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, status: true },
  });

  for (const c of clients) {
    const [triggers, leads] = await Promise.all([
      db.trigger.groupBy({
        by: ["status"],
        where: { clientId: c.id, deletedAt: null },
        _count: { _all: true },
      }),
      db.lead.groupBy({
        by: ["status"],
        where: { clientId: c.id, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    console.log(`\n[${c.name}] (${c.status})`);
    const tCounts: Record<string, number> = {};
    for (const t of triggers) tCounts[t.status] = t._count._all;
    const lCounts: Record<string, number> = {};
    for (const l of leads) lCounts[l.status] = l._count._all;

    // Verdicts dans briefV2Json
    const briefedTrigs = await db.trigger.findMany({
      where: { clientId: c.id, deletedAt: null, briefV2Json: { not: { equals: null as any } } },
      select: { briefV2Json: true, status: true },
    });
    let oui = 0, non = 0, enrich = 0;
    for (const t of briefedTrigs) {
      const v = (t.briefV2Json as any)?.verdict;
      if (v === "OUI") oui++;
      else if (v === "NON") non++;
      else if (v === "ENRICH") enrich++;
    }
    const totalT = Object.values(tCounts).reduce((a, b) => a + b, 0);

    console.log(`  Triggers total: ${totalT}`);
    for (const [k, v] of Object.entries(tCounts)) console.log(`    ${k.padEnd(12)} ${fmt(v)}`);
    console.log(`  Verdicts: OUI=${oui} NON=${non} ENRICH=${enrich} (${briefedTrigs.length} briefés)`);

    const totalL = Object.values(lCounts).reduce((a, b) => a + b, 0);
    console.log(`  Leads total: ${totalL}`);
    for (const [k, v] of Object.entries(lCounts)) console.log(`    ${k.padEnd(15)} ${fmt(v)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE 2 — Pépites en attente (= valeur business pas encore livrée)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE 2 — Pépites en attente d'envoi commercial");
  console.log("━".repeat(80));

  for (const c of clients) {
    const pepites = await db.lead.findMany({
      where: {
        clientId: c.id,
        deletedAt: null,
        status: { in: ["NEW", "INCOMPLETE", "ENRICHED"] },
        trigger: {
          briefV2Json: { path: ["verdict"], equals: "OUI" },
          deletedAt: null,
        },
      },
      select: {
        id: true, companyName: true, status: true, firstName: true, lastName: true,
        linkedinUrl: true, email: true, createdAt: true,
        trigger: { select: { briefV2Json: true, score: true, capturedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    console.log(`\n[${c.name}] Pépites OUI à enrichir/envoyer : ${pepites.length}`);
    for (const p of pepites.slice(0, 10)) {
      const v = p.trigger?.briefV2Json as any;
      const conf = v?.confidence ?? "?";
      const hasPersona = p.firstName && p.lastName ? "✓" : "✗";
      const hasLI = p.linkedinUrl ? "✓" : "✗";
      const hasEmail = p.email ? "✓" : "✗";
      console.log(`  [${p.status.padEnd(11)}] conf=${conf}% persona=${hasPersona} LI=${hasLI} email=${hasEmail} | ${p.companyName}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE 3 — Cohérence DB : orphelins + stagnants + verdicts incohérents
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE 3 — Cohérence DB");
  console.log("━".repeat(80));

  // Triggers sans Lead
  const triggersOrphans = await db.trigger.count({
    where: { deletedAt: null, lead: { is: null } },
  });
  console.log(`Triggers SANS Lead associé: ${triggersOrphans}`);

  // Leads INCOMPLETE depuis > 7j (devraient être archivés auto)
  const oldIncomplete = await db.lead.count({
    where: {
      deletedAt: null,
      status: "INCOMPLETE",
      createdAt: { lt: days(7) },
    },
  });
  console.log(`Leads INCOMPLETE > 7j (devraient être archivés): ${oldIncomplete}`);

  // Briefs périmés (scoreReason mais pas briefV2Json — V1 only, à reprocesser V2)
  const v1OnlyBriefs = await db.trigger.count({
    where: {
      deletedAt: null,
      status: "NEW",
      scoreReason: { not: null },
      briefV2Json: { equals: null as any },
    },
  });
  console.log(`Triggers V1-only (scoreReason mais sans briefV2Json): ${v1OnlyBriefs}`);

  // Backlog brief : Triggers NEW sans aucun brief
  const backlog = await db.trigger.count({
    where: {
      deletedAt: null,
      status: "NEW",
      scoreReason: null,
    },
  });
  console.log(`Backlog brief (NEW + scoreReason null): ${backlog}`);

  // Verdicts NON mais Trigger pas IGNORED (incohérence ancienne pré-fix)
  const verdictNonNotIgnored = await db.trigger.count({
    where: {
      deletedAt: null,
      briefV2Json: { path: ["verdict"], equals: "NON" },
      status: { not: "IGNORED" },
    },
  });
  console.log(`Verdict NON mais status != IGNORED (incohérence): ${verdictNonNotIgnored}`);

  // Triggers IGNORED mais verdict OUI (incohérence inverse — promotion ratée)
  const verdictOuiIgnored = await db.trigger.count({
    where: {
      deletedAt: null,
      briefV2Json: { path: ["verdict"], equals: "OUI" },
      status: "IGNORED",
    },
  });
  console.log(`Verdict OUI mais status = IGNORED (Pépite perdue !): ${verdictOuiIgnored}`);

  // ═══════════════════════════════════════════════════════════════
  // AXE 4 — Activité dernier cron + 24h
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE 4 — Activité 24h");
  console.log("━".repeat(80));

  const last24h = days(1);
  const trigCreated24h = await db.trigger.count({ where: { deletedAt: null, createdAt: { gte: last24h } } });
  const trigBriefed24h = await db.trigger.count({
    where: {
      deletedAt: null,
      updatedAt: { gte: last24h },
      briefV2Json: { not: { equals: null as any } },
    },
  });
  const leadsCreated24h = await db.lead.count({ where: { deletedAt: null, createdAt: { gte: last24h } } });
  console.log(`Triggers créés 24h: ${trigCreated24h}`);
  console.log(`Triggers briefés 24h: ${trigBriefed24h}`);
  console.log(`Leads créés 24h: ${leadsCreated24h}`);

  // ═══════════════════════════════════════════════════════════════
  // AXE 5 — Status table ServiceCost (si elle existe — Apify/Anthropic burn)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE 5 — Coûts services dernières 24h / 30j");
  console.log("━".repeat(80));
  try {
    const costs24h = await db.$queryRaw<Array<{service: string, cost: number}>>`
      SELECT service, SUM(cost::numeric)::float AS cost
      FROM "ServiceCost"
      WHERE "occurredAt" >= ${last24h}
      GROUP BY service
      ORDER BY cost DESC
    `;
    console.log("Dernières 24h :");
    for (const r of costs24h) console.log(`  ${r.service.padEnd(20)} $${r.cost.toFixed(2)}`);

    const costs30j = await db.$queryRaw<Array<{service: string, cost: number}>>`
      SELECT service, SUM(cost::numeric)::float AS cost
      FROM "ServiceCost"
      WHERE "occurredAt" >= ${days(30)}
      GROUP BY service
      ORDER BY cost DESC
    `;
    console.log("\nDerniers 30j :");
    let total30 = 0;
    for (const r of costs30j) { console.log(`  ${r.service.padEnd(20)} $${r.cost.toFixed(2)}`); total30 += r.cost; }
    console.log(`  TOTAL              $${total30.toFixed(2)}`);
  } catch (e: any) {
    console.log(`(ServiceCost table indispo: ${e?.message?.slice(0, 60)})`);
  }

  // ═══════════════════════════════════════════════════════════════
  // AXE 6 — Compte Apify (cap réel)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("AXE 6 — Apify quotas réels (via API)");
  console.log("━".repeat(80));
  try {
    const apifyToken = process.env.APIFY_API_TOKEN;
    if (!apifyToken) {
      console.log("(APIFY_API_TOKEN absent)");
    } else {
      const res = await fetch(`https://api.apify.com/v2/users/me/limits?token=${apifyToken}`);
      const data = await res.json() as any;
      const limits = data?.data?.limits ?? {};
      const usage = data?.data?.current ?? {};
      console.log(`Plan: ${data?.data?.plan?.name ?? "?"}`);
      console.log(`Monthly usage: $${(usage?.monthlyUsageUsd ?? 0).toFixed(2)} / $${limits?.maxMonthlyUsageUsd ?? "?"}`);
      console.log(`Compute units: ${usage?.monthlyActorComputeUnits ?? "?"} / ${limits?.maxMonthlyActorComputeUnits ?? "?"}`);
    }
  } catch (e: any) {
    console.log(`(Apify API erreur: ${e?.message?.slice(0, 80)})`);
  }

  await db.$disconnect();
}

main().catch(e => { console.error("AUDIT FAIL:", e); process.exit(1); });
