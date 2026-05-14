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
  // Sêmeia trigger principal (Lead Mathieu Godart) — force re-qualify
  // pour intégrer le signal fundraising rss-levees du 12/05 via getPriorSignals.
  const r = await qualifyTrigger("cmopsp7uu000ml6f0qgexq7o0", { force: true });
  console.log(`Result:`, JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
