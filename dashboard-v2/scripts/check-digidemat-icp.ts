// @ts-nocheck
import Module from "node:module";
const o = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return o.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });
async function main() {
  const { db } = await import("../src/lib/db");
  const c = await db.client.findUnique({ where: { slug: "digidemat" }, select: { id: true, slug: true, status: true, icp: true } });
  console.log(JSON.stringify(c, null, 2));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
