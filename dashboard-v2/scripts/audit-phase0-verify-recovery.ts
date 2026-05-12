// @ts-nocheck — script audit Phase 0 v3.0
/**
 * Vérifie que le rattrapage post-fix-423 a bien rempli le pipeline
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
  const c = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true },
  });
  if (!c) process.exit(1);

  const since6h = new Date(Date.now() - 6 * 3600 * 1000);
  const newRecent = await db.trigger.findMany({
    where: { clientId: c.id, capturedAt: { gte: since6h } },
    orderBy: { capturedAt: "desc" },
    select: {
      sourceCode: true,
      companyName: true,
      score: true,
      status: true,
      capturedAt: true,
      title: true,
    },
  });
  console.log(`Triggers DTL last 6h: ${newRecent.length}\n`);
  for (const t of newRecent) {
    console.log(
      `  ${t.capturedAt.toISOString().slice(11, 16)} | ${t.sourceCode.padEnd(30)} | score=${t.score ?? "?"} | ${t.status.padEnd(8)} | ${t.companyName.slice(0, 30).padEnd(30)} | "${(t.title ?? "").slice(0, 50)}"`,
    );
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
