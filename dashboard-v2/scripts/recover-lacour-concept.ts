// @ts-nocheck — recovery ciblé LACOUR CONCEPT post-audit 12/05/2026
import Module from "node:module";
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const TRIGGER_ID = "te-digitestlab-403154263-tech-";

async function main(): Promise<void> {
  const { db } = await import("../src/lib/db");
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");

  const before = await db.trigger.findUnique({
    where: { id: TRIGGER_ID },
    select: { id: true, companyName: true, score: true, status: true, scoreReason: true },
  });
  if (!before) {
    console.error("LACOUR CONCEPT trigger introuvable");
    process.exit(1);
  }
  console.log(`AVANT: ${before.companyName} score=${before.score} status=${before.status}`);
  console.log(`  reason: ${before.scoreReason?.slice(0, 150)}`);

  await db.trigger.update({
    where: { id: TRIGGER_ID },
    data: { scoreReason: null, status: "NEW" },
  });
  const result = await qualifyTrigger(TRIGGER_ID, { force: true });
  if (!result) {
    console.error("qualifyTrigger returned null");
    process.exit(1);
  }
  const after = await db.trigger.findUnique({
    where: { id: TRIGGER_ID },
    select: { status: true },
  });
  console.log(`\nAPRÈS: score=${result.opusScore} status=${after?.status} hot=${result.isHot}`);
  console.log(`  reason: ${result.reason.slice(0, 250)}`);

  // Annotation manual-recovery
  await db.trigger.update({
    where: { id: TRIGGER_ID },
    data: {
      scoreReason: `[RE-JUDGED v2 manual-recovery ${before.score}→${result.opusScore} ${after?.status === "NEW" ? "RECOVERED" : "still-IGNORED"}] ${result.reason}`.slice(0, 500),
    },
  });

  // Fix B3 (12/05/2026) — Unarchive le Lead si recovery réussi.
  if (after?.status === "NEW") {
    const unarchiveResult = await db.lead.updateMany({
      where: { triggerId: TRIGGER_ID, status: "ARCHIVED", deletedAt: null },
      data: { status: "NEW" },
    });
    console.log(`  Lead unarchive: ${unarchiveResult.count} row(s) ARCHIVED→NEW`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
