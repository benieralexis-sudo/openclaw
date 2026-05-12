// @ts-nocheck — script ponctuel post-audit qualité DTL 12/05/2026.
/**
 * Recovery candidats prioritaires ARCHIVED — 12/05/2026
 *
 * Cible les triggers IGNORED dont :
 *   - NAF dans whitelist ICP du client (vraie cible)
 *   - companyName ne matche pas antiPersonas (pas concurrent)
 *   - scoreReason ne contient PAS [V2-* ni [RE-JUDGED* ni [manual-IGNORED*
 *
 * Le sweep recovery auto (recoverIgnoredTriggersForClient, cron 4×/j) exclut
 * déjà ces patterns. Ce script fait un passage manuel ciblé pour rattraper
 * les leads que le sweep auto ne touche pas.
 *
 * Usage :
 *   npx tsx scripts/recover-priority-candidates.ts --client "Digi Test Lab"          # dry-run
 *   npx tsx scripts/recover-priority-candidates.ts --client "Digi Test Lab" --apply  # exécute
 */
import Module from "node:module";
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const clientIdx = args.indexOf("--client");
const clientName = clientIdx >= 0 ? args[clientIdx + 1] : null;

if (!clientName) {
  console.error('Usage: tsx scripts/recover-priority-candidates.ts --client "Digi Test Lab" [--apply]');
  process.exit(1);
}

async function main(): Promise<void> {
  const { db } = await import("../src/lib/db");
  const { qualifyTrigger } = await import("../src/lib/qualify-trigger");

  const client = await db.client.findFirst({
    where: { name: clientName!, deletedAt: null },
    select: { id: true, name: true, icp: true },
  });
  if (!client) {
    console.error(`Client "${clientName}" introuvable`);
    process.exit(1);
  }

  const icp = (client.icp ?? {}) as {
    naf_codes?: string[];
    antiPersonas?: string[];
  };
  const nafCodes = (icp.naf_codes ?? []).map((c: string) => c.replace(/\./g, ""));
  const antiPersonas = (icp.antiPersonas ?? [])
    .map((a: string) => (typeof a === "string" ? a.toLowerCase().trim() : ""))
    .filter((a: string) => a.length >= 3);

  if (nafCodes.length === 0) {
    console.error(`Client "${clientName}" sans icp.naf_codes — abort`);
    process.exit(1);
  }

  const triggers = await db.trigger.findMany({
    where: {
      clientId: client.id,
      status: "IGNORED",
      deletedAt: null,
      AND: [
        { scoreReason: { not: { startsWith: "[V2-" } } },
        { scoreReason: { not: { startsWith: "[RE-JUDGED" } } },
        { scoreReason: { not: { startsWith: "[manual-IGNORED" } } },
        { scoreReason: { not: { startsWith: "[antiPersona-hard" } } },
      ],
    },
    select: {
      id: true,
      companyName: true,
      companyNaf: true,
      score: true,
      sourceCode: true,
      scoreReason: true,
      capturedAt: true,
    },
    orderBy: { capturedAt: "desc" },
    take: 200,
  });

  const candidates = triggers.filter((t: any) => {
    if (!t.companyNaf) return false;
    const nafNorm = t.companyNaf.replace(/\./g, "");
    const nafOk = nafCodes.some((c: string) => nafNorm === c || nafNorm.startsWith(c));
    if (!nafOk) return false;
    const nameLower = (t.companyName ?? "").toLowerCase();
    const isAnti = antiPersonas.some((a: string) => nameLower.includes(a));
    if (isAnti) return false;
    return true;
  });

  console.log(`\n=== Recovery prioritaires pour ${client.name} ===`);
  console.log(`  Triggers IGNORED inspectés : ${triggers.length}`);
  console.log(`  Candidats ICP-NAF whitelist + non-antiPersona : ${candidates.length}`);
  console.log(`  Mode : ${apply ? "APPLY" : "DRY-RUN"}\n`);

  if (candidates.length === 0) {
    console.log("Aucun candidat. Le sweep automatique fait déjà le travail.");
    return;
  }

  const stats = { qualified: 0, recovered: 0, stillIgnored: 0, errors: 0 };

  for (const c of candidates) {
    const oldScore = c.score;
    const tag = `[${c.companyName} | NAF ${c.companyNaf} | score=${oldScore} | source=${c.sourceCode}]`;

    if (!apply) {
      console.log(`  DRY-RUN ${tag} reason="${(c.scoreReason ?? "").slice(0, 80)}..."`);
      continue;
    }

    try {
      await db.trigger.update({
        where: { id: c.id },
        data: { scoreReason: null, status: "NEW" },
      });
      const result = await qualifyTrigger(c.id, { force: true });
      stats.qualified += 1;
      if (!result) {
        console.log(`  ${tag} → null (Anthropic erreur ?)`);
        stats.errors += 1;
        continue;
      }
      const after = await db.trigger.findUnique({
        where: { id: c.id },
        select: { status: true },
      });
      if (after?.status === "NEW") {
        stats.recovered += 1;
        console.log(`  ✓ RECOVERED ${tag} ${oldScore}→${result.opusScore}`);
        await db.trigger.update({
          where: { id: c.id },
          data: {
            scoreReason: `[RE-JUDGED v2 manual-recovery ${oldScore}→${result.opusScore} RECOVERED] ${result.reason}`.slice(0, 500),
          },
        });
        // Fix B3 (12/05/2026) — Unarchive le Lead lié pour qu'il réapparaisse
        // dans le pool contactable. Sans ça, la dashboard query reste cohérente
        // (filtre sur Trigger.status), mais l'API Lead /api/leads listant les
        // contacts ARCHIVED les exclut → bug d'affichage selon le flow.
        const unarchiveResult = await db.lead.updateMany({
          where: { triggerId: c.id, status: "ARCHIVED", deletedAt: null },
          data: { status: "NEW" },
        });
        if (unarchiveResult.count > 0) {
          console.log(`    └─ Lead unarchive: ${unarchiveResult.count} row(s) ARCHIVED→NEW`);
        }
      } else {
        stats.stillIgnored += 1;
        console.log(`  · still-IGNORED ${tag} ${oldScore}→${result.opusScore}`);
        await db.trigger.update({
          where: { id: c.id },
          data: {
            scoreReason: `[RE-JUDGED v2 manual-recovery ${oldScore}→${result.opusScore} still-IGNORED] ${result.reason}`.slice(0, 500),
          },
        });
      }
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      stats.errors += 1;
      console.log(`  ✗ ERROR ${tag}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n=== Stats finales ===`);
  console.log(`  Qualified : ${stats.qualified}`);
  console.log(`  RECOVERED → NEW : ${stats.recovered}`);
  console.log(`  still-IGNORED : ${stats.stillIgnored}`);
  console.log(`  Errors : ${stats.errors}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
