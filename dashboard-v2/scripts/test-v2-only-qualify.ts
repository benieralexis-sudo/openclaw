// Test one-shot du nouveau qualifyTrigger V2-only.
// Prend 1 trigger existant et le re-qualifie via force=true pour vérifier
// que le nouveau code marche end-to-end.
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const TRIGGER_ID = process.argv[2] ?? "te-digitestlab-845228303-fundi";

(async () => {
  const { db } = await import("../src/lib/db");
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");

  const before = await db.trigger.findUnique({
    where: { id: TRIGGER_ID },
    select: { companyName: true, score: true, status: true, scoreReason: true, briefV2Json: true },
  });
  if (!before) {
    console.error(`Trigger ${TRIGGER_ID} introuvable`);
    process.exit(1);
  }

  console.log(`\n=== AVANT ===`);
  console.log(`  Company: ${before.companyName}`);
  console.log(`  Score: ${before.score} | Status: ${before.status}`);
  console.log(`  ScoreReason: ${before.scoreReason?.slice(0, 100)}`);
  console.log(`  V2: ${before.briefV2Json ? "présent" : "absent"}`);

  console.log(`\n=== Force qualify (V2-only)... ===`);
  const t0 = Date.now();
  const result = await qualifyTrigger(TRIGGER_ID, { force: true });
  const elapsed = Date.now() - t0;

  console.log(`  Result: ${JSON.stringify(result)}`);
  console.log(`  Elapsed: ${elapsed}ms`);

  const after = await db.trigger.findUnique({
    where: { id: TRIGGER_ID },
    select: { companyName: true, score: true, status: true, scoreReason: true, briefV2Json: true },
  });
  console.log(`\n=== APRÈS ===`);
  console.log(`  Score: ${after?.score} | Status: ${after?.status}`);
  console.log(`  ScoreReason: ${after?.scoreReason?.slice(0, 150)}`);
  const v2 = after?.briefV2Json as { verdict?: string; confidence?: number } | null;
  console.log(`  V2: verdict=${v2?.verdict} conf=${v2?.confidence}`);

  process.exit(0);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
