// @ts-nocheck — AUDIT PROFOND BOMBORA FR — Tout pour avancer drastiquement
import { db } from "@/lib/db";

async function main() {
  const now = Date.now();
  const days30 = new Date(now - 30 * 86400 * 1000);
  const days14 = new Date(now - 14 * 86400 * 1000);

  // ═══════════════════════════════════════════════════════════════
  // PART 1 — État DIGIDEMAT (config + Pépites + blocages)
  // ═══════════════════════════════════════════════════════════════
  console.log("━".repeat(80));
  console.log("PART 1 — État Digidemat (config + Pépites + blocages enrichissement)");
  console.log("━".repeat(80));

  const digidemat = await db.client.findFirst({
    where: { name: "Digidemat" },
    select: { id: true, name: true, status: true, icp: true, createdAt: true },
  });
  if (!digidemat) { console.log("❌ Digidemat introuvable"); return; }

  console.log(`Client: ${digidemat.name} | Status: ${digidemat.status}`);
  console.log(`Créé le: ${digidemat.createdAt.toISOString().slice(0,10)}`);
  console.log(`\nICP (JSON):`);
  const icp = digidemat.icp as any;
  if (icp) {
    console.log(`  signalConfig: ${JSON.stringify(Object.keys(icp.signalConfig ?? {}))}`);
    console.log(`  bomboraTopics: ${JSON.stringify(icp.bomboraTopics ?? icp.signatureTopics ?? "MISSING")}`);
    console.log(`  disabledSources: ${JSON.stringify(icp.disabledSources ?? "all-on")}`);
    console.log(`  buyingIntentTechSlugs: ${JSON.stringify(icp.buyingIntentTechSlugs ?? "MISSING")}`);
    console.log(`  personaDomain: ${icp.personaDomain ?? "?"}`);
    console.log(`  cibleNAF: ${JSON.stringify(icp.cibleNAF ?? icp.allowedNafCodes ?? "?")}`);
  }

  // État précis des 5 Pépites
  console.log(`\n5 PÉPITES Digidemat — état détaillé:`);
  const pepites = await db.lead.findMany({
    where: {
      clientId: digidemat.id, deletedAt: null,
      trigger: { briefV2Json: { path: ["verdict"], equals: "OUI" }, deletedAt: null },
    },
    select: {
      id: true, companyName: true, status: true,
      firstName: true, lastName: true, linkedinUrl: true, email: true, phone: true, jobTitle: true,
      kasprAttemptedAt: true, fullenrichAttemptedAt: true, harvestapiAttemptedAt: true,
      personaSource: true, createdAt: true,
      trigger: { select: { sourceCode: true, score: true, briefV2Json: true, status: true, companySiret: true } },
    },
  });
  for (const p of pepites) {
    const v = p.trigger?.briefV2Json as any;
    console.log(`\n  ${p.companyName} (${p.trigger?.sourceCode}, score=${p.trigger?.score})`);
    console.log(`    Lead status=${p.status} createdAt=${p.createdAt.toISOString().slice(0,10)}`);
    console.log(`    SIRET: ${p.trigger?.companySiret ?? "(vide)"}`);
    console.log(`    Persona: firstName=${p.firstName ?? "✗"} lastName=${p.lastName ?? "✗"} job=${p.jobTitle ?? "✗"} source=${p.personaSource ?? "✗"}`);
    console.log(`    Contact: LI=${p.linkedinUrl ? "✓" : "✗"} email=${p.email ? "✓" : "✗"} phone=${p.phone ? "✓" : "✗"}`);
    console.log(`    Enrichers attempted:`);
    console.log(`      Kaspr=${p.kasprAttemptedAt?.toISOString().slice(0,10) ?? "JAMAIS"}`);
    console.log(`      FullEnrich=${p.fullenrichAttemptedAt?.toISOString().slice(0,10) ?? "JAMAIS"}`);
    console.log(`      HarvestAPI=${p.harvestapiAttemptedAt?.toISOString().slice(0,10) ?? "JAMAIS"}`);
    console.log(`    Verdict Opus: ${v?.verdict} conf=${v?.confidence}%`);
    console.log(`    Brief opener: ${v?.opener?.slice(0, 120)}...`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PART 2 — Performance des 6 sources Bombora FR sur Digidemat
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("PART 2 — Performance des sources Bombora pour Digidemat");
  console.log("━".repeat(80));

  const bomboraSources = [
    "boamp.tender",
    "ted-europa.tender",
    "github.commit",
    "apify.linkedin-jobs-signature",
    "rss-medias.signature",
    "francetravail.signature",
  ];

  console.log(`\n${"Source".padEnd(35)} | ${"Total".padStart(6)} | ${"Briefés".padStart(8)} | ${"OUI".padStart(4)} | ${"NON".padStart(4)} | ${"ENRICH".padStart(7)} | ${"OUI%".padStart(6)}`);
  console.log(`${"-".repeat(35)}-+-${"-".repeat(6)}-+-${"-".repeat(8)}-+-${"-".repeat(4)}-+-${"-".repeat(4)}-+-${"-".repeat(7)}-+-${"-".repeat(6)}`);

  for (const src of bomboraSources) {
    const total = await db.trigger.count({
      where: { clientId: digidemat.id, deletedAt: null, sourceCode: src },
    });
    if (total === 0) {
      console.log(`${src.padEnd(35)} | ${String(0).padStart(6)} | ${"-".padStart(8)} | ${"-".padStart(4)} | ${"-".padStart(4)} | ${"-".padStart(7)} | ${"NEVER".padStart(6)}`);
      continue;
    }
    const briefed = await db.trigger.count({
      where: { clientId: digidemat.id, deletedAt: null, sourceCode: src, briefV2Json: { not: { equals: null as any } } },
    });
    const oui = await db.trigger.count({
      where: { clientId: digidemat.id, deletedAt: null, sourceCode: src, briefV2Json: { path: ["verdict"], equals: "OUI" } },
    });
    const non = await db.trigger.count({
      where: { clientId: digidemat.id, deletedAt: null, sourceCode: src, briefV2Json: { path: ["verdict"], equals: "NON" } },
    });
    const enrich = await db.trigger.count({
      where: { clientId: digidemat.id, deletedAt: null, sourceCode: src, briefV2Json: { path: ["verdict"], equals: "ENRICH" } },
    });
    const ouiPct = briefed > 0 ? `${((oui/briefed)*100).toFixed(0)}%` : "0%";
    console.log(`${src.padEnd(35)} | ${String(total).padStart(6)} | ${String(briefed).padStart(8)} | ${String(oui).padStart(4)} | ${String(non).padStart(4)} | ${String(enrich).padStart(7)} | ${ouiPct.padStart(6)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PART 3 — Quand le cron tourne-t-il sur Digidemat ? Et les sources Bombora tournent-elles ?
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("PART 3 — Cron Digidemat : tourne ou pas ? Sources activées ?");
  console.log("━".repeat(80));

  const lastTrig = await db.trigger.findFirst({
    where: { clientId: digidemat.id, deletedAt: null },
    orderBy: { capturedAt: "desc" },
    select: { capturedAt: true, sourceCode: true, companyName: true },
  });
  console.log(`Dernier Trigger Digidemat: ${lastTrig?.capturedAt.toISOString()} (${lastTrig?.sourceCode})`);
  const ageH = lastTrig ? (now - lastTrig.capturedAt.getTime()) / 3600000 : 0;
  console.log(`Âge: ${ageH.toFixed(1)}h`);
  console.log(`Status client: ${digidemat.status}`);
  console.log(`→ Si PROSPECT et derniers triggers récents = des sources tournent (peut-être pas via cron iFIND mais via script manuel ou polling séparé)`);

  // Combien de triggers par jour récents ?
  const byDay = await db.$queryRaw<Array<{day: Date, count: bigint}>>`
    SELECT DATE_TRUNC('day', "capturedAt") AS day, COUNT(*)::bigint AS count
    FROM "Trigger"
    WHERE "clientId" = ${digidemat.id} AND "deletedAt" IS NULL AND "capturedAt" >= ${days14}
    GROUP BY day
    ORDER BY day DESC
  `;
  console.log(`\nVolume Triggers Digidemat 14 derniers jours:`);
  for (const r of byDay) {
    console.log(`  ${r.day.toISOString().slice(0, 10)} : ${r.count}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PART 4 — Que peut-on apprendre pour pousser Bombora ?
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "━".repeat(80));
  console.log("PART 4 — Analyse stratégique");
  console.log("━".repeat(80));

  // Pour chaque source, montrer un exemple de Trigger OUI (s'il y en a)
  console.log(`\nExemples concrets de Pépites OUI par source (max 2 par source):`);
  for (const src of bomboraSources) {
    const exs = await db.trigger.findMany({
      where: {
        clientId: digidemat.id, deletedAt: null, sourceCode: src,
        briefV2Json: { path: ["verdict"], equals: "OUI" },
      },
      select: { companyName: true, title: true, briefV2Json: true, score: true },
      take: 2,
    });
    if (exs.length === 0) continue;
    console.log(`\n[${src}]`);
    for (const e of exs) {
      const v = e.briefV2Json as any;
      console.log(`  ${e.companyName} (score=${e.score}, conf=${v?.confidence}%)`);
      console.log(`    Trigger: ${e.title?.slice(0, 100)}`);
      console.log(`    Opus thesis: ${v?.thesis?.slice(0, 180)}`);
    }
  }

  await db.$disconnect();
}

main().catch(e => { console.error("AUDIT FAIL:", e); process.exit(1); });
