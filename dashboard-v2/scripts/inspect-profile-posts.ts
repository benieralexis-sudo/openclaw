// @ts-nocheck — script CLI
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

(async () => {
  const { db } = await import("../src/lib/db");
  const leads = await db.lead.findMany({
    where: { linkedinProfileJson: { not: null }, deletedAt: null },
    select: { fullName: true, linkedinProfileJson: true },
    take: 3,
  });
  for (const lead of leads) {
    const p = lead.linkedinProfileJson as any;
    if (!p) continue;
    console.log(`\n=== ${lead.fullName} ===`);
    console.log(`Top keys: ${Object.keys(p).join(", ")}`);
    const postFields = ["posts", "activity", "recentActivity", "publications"];
    for (const f of postFields) {
      if (p[f]) {
        const arr = Array.isArray(p[f]) ? p[f] : [];
        console.log(`  ${f}: ${arr.length} items`);
        if (arr.length > 0) {
          console.log(`  sample: ${JSON.stringify(arr[0]).slice(0, 250)}`);
        }
      }
    }
  }
  await db.$disconnect();
})();
