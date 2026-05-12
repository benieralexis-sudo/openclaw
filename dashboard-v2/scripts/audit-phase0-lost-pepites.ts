// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.1 — Pourquoi Opus dit NON sur des Pépites score ≥8 ?
 * Lit scoreReason + briefV2Json pour comprendre les "rejected gold"
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

  const since90 = new Date();
  since90.setDate(since90.getDate() - 90);

  // Top 20 IGNORED avec score initial ≥8 (= "Pépites perdues")
  const lostPepites = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since90 },
      status: "IGNORED",
      score: { gte: 8 },
    },
    orderBy: { score: "desc" },
    take: 20,
    select: {
      id: true,
      sourceCode: true,
      companyName: true,
      companyNaf: true,
      industry: true,
      size: true,
      score: true,
      title: true,
      scoreReason: true,
      briefV2Json: true,
      ignoredReason: true,
      capturedAt: true,
    },
  });

  console.log(`\n📊 AUDIT — Pépites score ≥8 IGNORED (90j)\n`);
  console.log(`Total trouvées : ${lostPepites.length}\n`);

  for (const t of lostPepites) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📌 ${t.companyName} | score=${t.score} | ${t.sourceCode}`);
    console.log(`   NAF: ${t.companyNaf ?? "?"} | Industry: ${t.industry ?? "?"} | Size: ${t.size ?? "?"}`);
    console.log(`   Capture: ${t.capturedAt.toISOString().slice(0, 16)}`);
    console.log(`   Title: "${t.title}"`);
    console.log(`   ignoredReason (DB col): ${t.ignoredReason ?? "(null)"}`);
    console.log(`   scoreReason: ${t.scoreReason ?? "(null)"}`);
    if (t.briefV2Json) {
      const brief = t.briefV2Json as any;
      console.log(`   V2 verdict: ${brief.verdict} | conf=${brief.confidence}`);
      console.log(`   V2 thesis: ${(brief.thesis ?? "").slice(0, 200)}`);
      if (Array.isArray(brief.risks) && brief.risks.length > 0) {
        console.log(`   V2 risks (${brief.risks.length}) :`);
        for (const r of brief.risks.slice(0, 3)) {
          console.log(`      - ${typeof r === "string" ? r.slice(0, 150) : JSON.stringify(r).slice(0, 150)}`);
        }
      }
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
