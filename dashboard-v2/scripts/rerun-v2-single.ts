// One-shot : relance V2 sur 1 trigger spécifique (post-merge SQUAREMIND).
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const TRIGGER_ID = process.argv[2];
if (!TRIGGER_ID) {
  console.error("Usage: npx tsx scripts/rerun-v2-single.ts <triggerId>");
  process.exit(1);
}

(async () => {
  const { db } = await import("../src/lib/db");
  const { qualifyTriggerV2WithValidation } = await import("../src/lib/qualify-trigger");

  const result = await qualifyTriggerV2WithValidation(TRIGGER_ID);
  if (!result.brief) {
    console.log(`No brief: ${result.reason}`);
    process.exit(0);
  }
  console.log(`V2=${result.brief.verdict} conf=${result.brief.confidence} shippable=${result.shippable}`);
  console.log(`Thesis: ${result.brief.thesis.slice(0, 250)}`);
  await db.trigger.update({
    where: { id: TRIGGER_ID },
    data: { briefV2Json: result.brief as any },
  });
  console.log("Updated DB.");
  process.exit(0);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
