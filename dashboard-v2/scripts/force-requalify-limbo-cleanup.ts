/**
 * Cleanup audit massif 14/05/2026 — Force re-qualify les 3 triggers DTL
 * en limbo : briefV2Json scalaire null + scoreReason intact + status NEW.
 *
 * Cause : datent d'avant le fix clear-stale-briefs (commit 9f964c203) qui
 * clearait briefV2Json mais pas scoreReason. Au prochain qualifyPendingTriggers
 * ils ne sont pas re-pickés (le filtre exige briefV2Json null + status NEW,
 * ce qui est leur cas, mais leur scoreReason les fait ressembler à "déjà
 * qualifié" côté pipeline aval).
 *
 * Cibles : GitGuardian, Koralplay, StrangeBee (NEW). Allisone (IGNORED) on
 * laisse — statut correct.
 *
 * Usage : npx tsx scripts/force-requalify-limbo-cleanup.ts
 */
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
  const ids = [
    "cmopsp7ty000gl6f0zj5d8fe1", // GitGuardian
    "cmopsp7u9000il6f0epg4n4aj", // Koralplay
    "cmopsp7ts000fl6f051yaieqo", // StrangeBee
  ];
  for (const id of ids) {
    console.log(`Force re-qualify ${id}...`);
    const r = await qualifyTrigger(id, { force: true });
    console.log(`  Result:`, JSON.stringify(r));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
