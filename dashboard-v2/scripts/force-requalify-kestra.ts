import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

(async () => {
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");
  const TRIGGER_ID = "cmoicpyei000ol6ejb7o0sm6f";
  console.log(`[v3bis] Force re-qualify Kestra ${TRIGGER_ID}...`);
  const r = await qualifyTrigger(TRIGGER_ID, { force: true });
  console.log(`[v3bis] Result:`, JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
