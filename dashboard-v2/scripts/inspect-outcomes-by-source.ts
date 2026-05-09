// @ts-nocheck — script CLI
/**
 * Question 2 — Outcomes capturés par source DTL
 * Un "outcome positif" = au moins 1 des suivants attaché au Lead.triggerId :
 *   - LeadActivity.type = MEETING_BOOKED
 *   - LeadActivity.type = DASHBOARD_INTERACTION (engagement client)
 *   - LeadActivity.type = EMAIL_SENT avec source MANUAL
 * 
 * Un "outcome négatif" = Lead.status = ARCHIVED + LeadActivity avec type DASHBOARD_INTERACTION
 *   et payload.kind = "archive_manual"
 * 
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/inspect-outcomes-by-source.ts
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
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Get all triggers with lead + activities
  const triggers = await db.trigger.findMany({
    where: {
      clientId: client.id,
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: {
      id: true,
      sourceCode: true,
      lead: {
        select: {
          id: true,
          status: true,
          activities: {
            select: {
              type: true,
              source: true,
              payload: true,
            },
          },
        },
      },
    },
  });

  console.log(`\n📊 iFIND Outcomes Analysis — DTL (90 derniers jours)`);
  console.log(`   Client: ${client.name}`);
  console.log(`   Since: ${since.toISOString().split('T')[0]}`);
  console.log(`   Total triggers: ${triggers.length}\n`);

  // Group by sourceCode
  const sources: Record<string, {
    total: number;
    positive: number;
    negative: number;
  }> = {};

  for (const t of triggers) {
    if (!sources[t.sourceCode]) {
      sources[t.sourceCode] = { total: 0, positive: 0, negative: 0 };
    }
    sources[t.sourceCode].total++;

    // Check for positive outcome
    if (t.lead) {
      let hasPositive = false;
      for (const act of t.lead.activities || []) {
        if (act.type === "MEETING_BOOKED") {
          hasPositive = true;
          break;
        }
        if (act.type === "DASHBOARD_INTERACTION") {
          hasPositive = true;
          break;
        }
        if (act.type === "EMAIL_SENT" && act.source === "MANUAL") {
          hasPositive = true;
          break;
        }
      }
      if (hasPositive) sources[t.sourceCode].positive++;

      // Check for negative outcome
      if (t.lead.status === "ARCHIVED") {
        for (const act of t.lead.activities || []) {
          if (act.type === "DASHBOARD_INTERACTION" && act.payload && typeof act.payload === "object") {
            const p = act.payload as Record<string, unknown>;
            if (p.kind === "archive_manual") {
              sources[t.sourceCode].negative++;
              break;
            }
          }
        }
      }
    }
  }

  // Sort by total desc
  const sorted = Object.entries(sources).sort((a, b) => b[1].total - a[1].total);

  console.log("┌─────────────────────────────────┬───────┬──────────┬──────────┬────────────┬────────────┐");
  console.log("│ Source                          │ Total │ Positive │ Negative │ % Pos      │ % Neg      │");
  console.log("├─────────────────────────────────┼───────┼──────────┼──────────┼────────────┼────────────┤");

  let dataReady = 0;

  for (const [sourceCode, stats] of sorted) {
    const source = sourceCode.padEnd(31);
    const total = String(stats.total).padStart(5);
    const positive = String(stats.positive).padStart(8);
    const negative = String(stats.negative).padStart(8);
    const pctPos = total !== "    0" ? ((stats.positive / stats.total) * 100).toFixed(1).padStart(10) : "    N/A".padStart(10);
    const pctNeg = total !== "    0" ? ((stats.negative / stats.total) * 100).toFixed(1).padStart(10) : "    N/A".padStart(10);

    console.log(`│ ${source} │ ${total} │ ${positive} │ ${negative} │ ${pctPos}% │ ${pctNeg}% │`);

    if (stats.positive + stats.negative >= 30) dataReady++;
  }
  console.log("└─────────────────────────────────┴───────┴──────────┴──────────┴────────────┴────────────┘");

  console.log("\n📈 Analyse d'outcomes:");
  console.log(`   • Sources avec >= 30 outcomes TOTAUX (calibration fiable): ${dataReady}`);
  console.log(`   • Suffisant pour Bonus B: ${dataReady >= 2 ? "Oui (min 2 sources)" : "Non (besoin de plus de data)"}\n`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
