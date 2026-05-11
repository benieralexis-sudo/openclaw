// One-shot : force re-qualify Audion pour tester le fix B2 (NAF obsolète).
// Audion : trigger cmoicpyvf000sl6ej92ko3zjb, NAF 74.2A, source rodz.fundraising.
// Attendu post-fix : verdict OUI (était ENRICH 58 avant fix prompt B2).

import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const TRIGGER_ID = "cmoicpyvf000sl6ej92ko3zjb";

(async () => {
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");
  console.log(`[force-requalify] Audion ${TRIGGER_ID} avec force=true...`);
  const r = await qualifyTrigger(TRIGGER_ID, { force: true });
  console.log(`[force-requalify] Done. Result:`, JSON.stringify(r));
  process.exit(0);
})().catch((err) => {
  console.error("[force-requalify] FAIL:", err);
  process.exit(1);
});
