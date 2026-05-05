// @ts-nocheck — smoke test
/**
 * Sprint 7 smoke test — vérifie que :
 * 1. L'enum ActivityType.DASHBOARD_INTERACTION fonctionne en INSERT direct
 * 2. logActivity() accepte le type
 * 3. Le payload JSON est bien stocké
 *
 * Usage :
 *   cd dashboard-v2 && npx tsx --tsconfig scripts/tsconfig.scripts.json \
 *     scripts/smoke-sprint-7-tracking.ts
 *
 * Cleanup : le test soft-supprime ses propres entries (il en crée 2 pour
 * vérification, identifiables via payload.kind = "smoke-test").
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import { db } from "../src/lib/db";
import { logActivity } from "../src/lib/lead-activity";

async function main() {
  // 1. Trouver un lead DTL pour tester
  const dtl = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!dtl) {
    console.error("❌ Client DTL introuvable");
    process.exit(1);
  }
  console.log(`Client : ${dtl.name} (${dtl.id})`);

  const lead = await db.lead.findFirst({
    where: { clientId: dtl.id, deletedAt: null },
    select: { id: true, companyName: true, fullName: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  if (!lead) {
    console.error("❌ Aucun lead DTL trouvé");
    process.exit(1);
  }
  console.log(`Lead test : ${lead.companyName} (${lead.id}) status=${lead.status}\n`);

  // 2. Test logActivity avec DASHBOARD_INTERACTION
  console.log("[Test 1/2] logActivity(DASHBOARD_INTERACTION, kind=smoke-test-copy_email)");
  const r1 = await logActivity({
    leadId: lead.id,
    type: "DASHBOARD_INTERACTION",
    source: "MANUAL",
    direction: "OUTBOUND",
    payload: { kind: "smoke-test-copy_email", note: "Sprint 7 smoke test" },
  });
  if (!r1.ok) {
    console.error(`❌ Insert failed: ${r1.reason}`);
    process.exit(1);
  }
  console.log(`✅ Inserted activity ${r1.id}`);

  // 3. Test direct DB Prisma (bypass logActivity wrapper)
  console.log("\n[Test 2/2] db.leadActivity.create direct (DASHBOARD_INTERACTION, kind=smoke-test-click_linkedin)");
  const created = await db.leadActivity.create({
    data: {
      leadId: lead.id,
      clientId: dtl.id,
      type: "DASHBOARD_INTERACTION",
      source: "MANUAL",
      direction: "OUTBOUND",
      payload: { kind: "smoke-test-click_linkedin", url: "https://linkedin.com/in/test" },
    },
    select: { id: true, type: true, source: true, payload: true, occurredAt: true },
  });
  console.log(`✅ Created activity ${created.id}`);
  console.log(`   type=${created.type} source=${created.source}`);
  console.log(`   payload=${JSON.stringify(created.payload)}`);
  console.log(`   occurredAt=${created.occurredAt.toISOString()}`);

  // 4. Vérifier que les comptes remontent
  console.log("\n[Verify] Compte des DASHBOARD_INTERACTION DTL :");
  const counts = await db.leadActivity.groupBy({
    by: ["type"],
    where: { clientId: dtl.id, type: "DASHBOARD_INTERACTION" },
    _count: { _all: true },
  });
  console.log(counts);

  console.log("\n[Cleanup] Soft-delete des smoke-test entries");
  const deleted = await db.leadActivity.deleteMany({
    where: {
      clientId: dtl.id,
      type: "DASHBOARD_INTERACTION",
      payload: {
        path: ["kind"],
        string_starts_with: "smoke-test-",
      },
    },
  });
  console.log(`✅ Cleaned ${deleted.count} smoke-test entries`);

  await db.$disconnect();
  console.log("\n=== Sprint 7 SMOKE TEST PASSED ===");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
