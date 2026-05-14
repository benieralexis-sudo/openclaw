/**
 * Backfill (14/05/2026) — Fix WeWard cohérent.
 *
 * Reset la persona sur les Leads qui ont :
 *   - Trigger.type = 'HIRING_KEY' AND companyNaf tech (NAF 62.x, 58.29, 63.x)
 *   - Lead.personaSource ILIKE 'pappers%' (persona posée par Pappers RCS)
 *   - Lead.jobTitle matche CEO/Pr/DG/PDG/MD/Gérant
 *
 * Ces Leads ont été posés AVANT le fix tech-hire-guard du 11/05 (qui skip
 * dirigeants RCS non-tech sur HIRING_KEY tech) → Lead a une persona CEO sur
 * un trigger QA hire → Fred contacterait la mauvaise personne.
 *
 * Action : utilise clearStaleBriefsOnPersonaChange pour reset proprement
 * email/phone/brief, puis vide firstName/lastName/jobTitle/linkedinUrl/
 * personaSource + status=INCOMPLETE + reset harvestapi/dirigeants attempts
 * pour permettre au prochain run-pollers de re-chercher le bon décideur
 * tech.
 *
 * Vérifié 14/05 : 0 activity sur ces 12 Leads, donc safe.
 *
 * Usage : npx tsx scripts/backfill-bad-persona-ceo-on-tech-hire.ts
 *         (ajouter --apply pour exécuter, sinon dry-run)
 */
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const APPLY = process.argv.includes("--apply");

(async () => {
  const { db } = await import("../src/lib/db");
  const { clearStaleBriefsOnPersonaChange } = await import(
    "../src/lib/clear-stale-briefs"
  );

  // Sélection des Leads suspects
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: string;
      companyName: string;
      firstName: string | null;
      lastName: string | null;
      fullName: string | null;
      jobTitle: string | null;
      triggerId: string | null;
      personaSource: string | null;
    }>
  >(`
    SELECT l.id, l."companyName", l."firstName", l."lastName", l."fullName",
           l."jobTitle", l."triggerId", l."personaSource"
    FROM "Lead" l
    JOIN "Trigger" t ON t.id = l."triggerId"
    WHERE l."deletedAt" IS NULL AND t."deletedAt" IS NULL
      AND t.type = 'HIRING_KEY'
      AND t."companyNaf" ~ '^(62\\.|58\\.29|63\\.)'
      AND l."jobTitle" ~* '(CEO|chief executive|directeur général|pdg|président|managing director|gérant)'
      AND l."personaSource" ILIKE '%pappers%'
    ORDER BY l."createdAt" DESC
  `);

  console.log(`[backfill] ${rows.length} Leads suspects identifiés${APPLY ? "" : " (DRY-RUN)"}.\n`);

  let cleared = 0;
  for (const r of rows) {
    console.log(
      `  - ${r.companyName} (${r.id}): ${r.firstName ?? "?"} ${r.lastName ?? "?"} — "${r.jobTitle ?? "?"}" [${r.personaSource}]`,
    );
    if (APPLY) {
      // 1. clearStaleBriefs : efface email/phone/briefs/briefV2Json en passant
      //    par le code de prod (gestion atomique + reset *AttemptedAt Kaspr/FE)
      const newName = "__RESET_BACKFILL__"; // force isPersonaChanged=true
      const res = await clearStaleBriefsOnPersonaChange(
        r.id,
        r.fullName ?? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() ?? null,
        newName,
        r.triggerId ?? null,
      );
      console.log(
        `      cleared fields: ${res.leadFieldsCleared.join(", ") || "(rien)"} | triggerV2=${res.triggerV2Cleared}`,
      );
      // 2. Reset firstName/lastName/fullName/jobTitle/linkedinUrl/personaSource
      //    + status=INCOMPLETE + reset attempts pour permettre re-search
      await db.lead.update({
        where: { id: r.id },
        data: {
          firstName: null,
          lastName: null,
          fullName: null,
          jobTitle: null,
          linkedinUrl: null,
          personaSource: null,
          status: "INCOMPLETE",
          harvestapiAttemptedAt: null,
          rodzAttemptedAt: null,
          linkedinFinderAttemptedAt: null,
        },
      });
      // 3. Reset Pappers dirigeants attempt + scoreReason du Trigger pour
      //    permettre re-qualify avec la nouvelle persona une fois trouvée
      if (r.triggerId) {
        await db.trigger.update({
          where: { id: r.triggerId },
          data: {
            pappersDirigeantsAttemptedAt: null,
            scoreReason: null, // force re-qualify V2 avec persona corrigée
          },
        });
      }
      cleared++;
    }
  }

  console.log(
    `\n[backfill] ${APPLY ? `${cleared} Leads reset → INCOMPLETE` : "DRY-RUN — relancer avec --apply"}`,
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
