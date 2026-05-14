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
  for (const id of ["cmp15a3ic0009l68nka6muafr", "cmp2cinku0003l6rxvmwbg4ab"]) {
    console.log(`Force re-qualify ${id}...`);
    const r = await qualifyTrigger(id, { force: true });
    console.log(`Result:`, JSON.stringify(r));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
