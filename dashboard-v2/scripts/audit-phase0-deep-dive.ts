// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.1 — Deep dive sur les 5 inconnues critiques
 * 1) Pourquoi 74% soft-deleted (Trigger.deletedAt)
 * 2) Causes latence Apify WTTJ 432h
 * 3) Pourquoi volume crash 116→2 en 9j
 * 4) Les 4 leads activés par Fred = quels triggers ?
 * 5) IGNORED reason=null distribution + boîtes
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
    select: { id: true, name: true },
  });
  if (!client) process.exit(1);

  const since90 = new Date();
  since90.setDate(since90.getDate() - 90);

  console.log(`\n📊 AUDIT A.0.1 — Deep Dive 5 inconnues critiques`);
  console.log(`   Client: ${client.name}\n`);

  // ════════════════════════════════════════════════════════════════════
  // 1) SOFT-DELETED — Quand / Pourquoi (574 sur 779 = 74%)
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`#1 — SOFT-DELETED Triggers DTL`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const deletedBySource = await db.$queryRaw<
    Array<{ source_code: string; total: bigint; deleted: bigint }>
  >`
    SELECT "sourceCode" AS source_code,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL) AS deleted
    FROM "Trigger"
    WHERE "clientId" = ${client.id} AND "capturedAt" >= ${since90}
    GROUP BY "sourceCode"
    ORDER BY total DESC
  `;

  console.log(`\nSource                              | Total | Deleted | %`);
  for (const r of deletedBySource) {
    const pct = ((Number(r.deleted) / Number(r.total)) * 100).toFixed(1);
    console.log(
      `${r.source_code.padEnd(35)} | ${String(r.total).padStart(5)} | ${String(r.deleted).padStart(7)} | ${pct.padStart(5)}%`,
    );
  }

  // Timing: quand sont supprimés vs créés ?
  const deletionTiming = await db.$queryRaw<
    Array<{ bucket: string; count: bigint }>
  >`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM ("deletedAt" - "capturedAt"))/3600 < 1 THEN '<1h après capture'
        WHEN EXTRACT(EPOCH FROM ("deletedAt" - "capturedAt"))/3600 < 24 THEN '1-24h'
        WHEN EXTRACT(EPOCH FROM ("deletedAt" - "capturedAt"))/3600 < 168 THEN '1-7j'
        WHEN EXTRACT(EPOCH FROM ("deletedAt" - "capturedAt"))/3600 < 720 THEN '7-30j'
        ELSE '>30j'
      END AS bucket,
      COUNT(*) AS count
    FROM "Trigger"
    WHERE "clientId" = ${client.id}
      AND "capturedAt" >= ${since90}
      AND "deletedAt" IS NOT NULL
    GROUP BY bucket
    ORDER BY MIN(EXTRACT(EPOCH FROM ("deletedAt" - "capturedAt"))/3600)
  `;
  console.log(`\nDélai capture → soft-delete :`);
  for (const r of deletionTiming) {
    console.log(`   ${r.bucket.padEnd(20)} : ${r.count}`);
  }

  // Échantillon 5 deleted récents — voir le payload
  const sampleDeleted = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since90 },
      deletedAt: { not: null },
    },
    orderBy: { deletedAt: "desc" },
    take: 5,
    select: {
      sourceCode: true,
      companyName: true,
      score: true,
      status: true,
      ignoredReason: true,
      capturedAt: true,
      deletedAt: true,
    },
  });
  console.log(`\n5 derniers soft-deleted (pour voir le pattern) :`);
  for (const t of sampleDeleted) {
    console.log(
      `   ${t.deletedAt?.toISOString().slice(0, 16)} | ${t.sourceCode.padEnd(30)} | score=${t.score} | ${t.status} | ${t.companyName.slice(0, 30)} | reason: ${t.ignoredReason ?? "(null)"}`,
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // 2) LATENCE WTTJ — distribution
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`#2 — LATENCE apify.wttj-jobs (médian 432h = 18j)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const wttjLatencyHistogram = await db.$queryRaw<
    Array<{ bucket: string; count: bigint }>
  >`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt"))/3600 < 24 THEN '<24h ✅'
        WHEN EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt"))/3600 < 72 THEN '1-3j'
        WHEN EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt"))/3600 < 168 THEN '3-7j'
        WHEN EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt"))/3600 < 720 THEN '7-30j'
        ELSE '>30j 🔴'
      END AS bucket,
      COUNT(*) AS count
    FROM "Trigger"
    WHERE "clientId" = ${client.id}
      AND "capturedAt" >= ${since90}
      AND "sourceCode" = 'apify.wttj-jobs'
      AND "publishedAt" IS NOT NULL
    GROUP BY bucket
    ORDER BY MIN(EXTRACT(EPOCH FROM ("capturedAt" - "publishedAt"))/3600)
  `;
  console.log(`Distribution latence WTTJ :`);
  for (const r of wttjLatencyHistogram) {
    console.log(`   ${r.bucket.padEnd(15)} : ${r.count}`);
  }

  // ════════════════════════════════════════════════════════════════════
  // 3) VOLUME CRASH — Triggers par source par jour (7 derniers jours)
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`#3 — VOLUME CRASH (116 → 2 en 9 jours)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const since14 = new Date();
  since14.setDate(since14.getDate() - 14);
  const sourcesByDay = await db.$queryRaw<
    Array<{ day: Date; source_code: string; count: bigint }>
  >`
    SELECT DATE_TRUNC('day', "capturedAt") AS day,
      "sourceCode" AS source_code,
      COUNT(*) AS count
    FROM "Trigger"
    WHERE "clientId" = ${client.id} AND "capturedAt" >= ${since14}
    GROUP BY day, source_code
    ORDER BY day DESC, count DESC
  `;
  console.log(`Triggers/source/jour (14 derniers jours) :`);
  let currentDay = "";
  for (const r of sourcesByDay) {
    const day = r.day.toISOString().slice(0, 10);
    if (day !== currentDay) {
      console.log(`\n${day} :`);
      currentDay = day;
    }
    console.log(`   ${r.source_code.padEnd(35)} : ${r.count}`);
  }

  // ════════════════════════════════════════════════════════════════════
  // 4) FRED ACTIONS — Les 4 leads avec activité = quels triggers ?
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`#4 — Les 4 LeadActivity = quels triggers / leads ?`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const activeLeads = await db.leadActivity.findMany({
    where: { clientId: client.id, occurredAt: { gte: since90 } },
    orderBy: { occurredAt: "desc" },
    select: {
      occurredAt: true,
      type: true,
      source: true,
      payload: true,
      lead: {
        select: {
          companyName: true,
          fullName: true,
          jobTitle: true,
          status: true,
          trigger: {
            select: {
              sourceCode: true,
              score: true,
              title: true,
              capturedAt: true,
            },
          },
        },
      },
    },
  });
  console.log(`\nDétail des ${activeLeads.length} activités :`);
  for (const a of activeLeads) {
    console.log(
      `\n   ${a.occurredAt.toISOString().slice(0, 16)} | ${a.type} | ${a.source}`,
    );
    console.log(
      `   Lead: ${a.lead.companyName} | ${a.lead.fullName ?? "?"} (${a.lead.jobTitle ?? "?"}) | status=${a.lead.status}`,
    );
    if (a.lead.trigger) {
      console.log(
        `   Trigger source: ${a.lead.trigger.sourceCode} | score=${a.lead.trigger.score} | "${a.lead.trigger.title}"`,
      );
    }
    if (a.payload) {
      console.log(
        `   Payload: ${JSON.stringify(a.payload).slice(0, 150)}`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 5) IGNORED reason=null — pattern ?
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`#5 — IGNORED reason=null (231 triggers, black box)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const ignoredNullBySource = await db.$queryRaw<
    Array<{ source_code: string; count: bigint; avg_score: number | null }>
  >`
    SELECT "sourceCode" AS source_code,
      COUNT(*) AS count,
      AVG("score") AS avg_score
    FROM "Trigger"
    WHERE "clientId" = ${client.id}
      AND "capturedAt" >= ${since90}
      AND status = 'IGNORED'
      AND "ignoredReason" IS NULL
    GROUP BY "sourceCode"
    ORDER BY count DESC
  `;
  console.log(`\nIGNORED null reason par source :`);
  for (const r of ignoredNullBySource) {
    console.log(
      `   ${r.source_code.padEnd(35)} : ${String(r.count).padStart(4)} | avg score=${r.avg_score !== null ? Number(r.avg_score).toFixed(1) : "?"}`,
    );
  }

  // Échantillon IGNORED reason=null avec score élevé (= "vrais Pépites ignorées" ?)
  const ignoredButHighScore = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since90 },
      status: "IGNORED",
      ignoredReason: null,
      score: { gte: 8 },
    },
    orderBy: { score: "desc" },
    take: 10,
    select: {
      sourceCode: true,
      companyName: true,
      score: true,
      title: true,
      capturedAt: true,
      ignoredAt: true,
    },
  });
  console.log(
    `\n🚨 IGNORED reason=null AVEC score ≥8 (${ignoredButHighScore.length} affichés, vraies Pépites perdues ?) :`,
  );
  for (const t of ignoredButHighScore) {
    console.log(
      `   ${t.capturedAt.toISOString().slice(0, 10)} | ${t.sourceCode.padEnd(30)} | score=${t.score} | ${t.companyName.slice(0, 30)} | "${t.title.slice(0, 50)}"`,
    );
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
