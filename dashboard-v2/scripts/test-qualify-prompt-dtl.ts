// @ts-nocheck — script CLI test
/**
 * Test Sprint B.3+B.4 — Vérifie que le prompt généré pour qualify DTL inclut
 * bien les nouveaux champs Fred (signalPrimary, redFlagsHard, fewShotPositives,
 * pitchVerbatim, etc.) sans casser l'existant.
 *
 * Ne modifie rien : prend un Trigger DTL réel, reconstruit le userPrompt
 * exactement comme qualify-trigger.ts le ferait, l'imprime + compte les tokens.
 */
import Module from "node:module";
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");

  // Find DTL client + 1 récent Trigger qualified DTL
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error("DTL client introuvable");

  const trigger = await db.trigger.findFirst({
    where: { clientId: client.id, deletedAt: null },
    orderBy: { capturedAt: "desc" },
    include: {
      lead: {
        select: {
          fitScore: true,
          personaTier: true,
          fullName: true,
          jobTitle: true,
          linkedinUrl: true,
          linkedinProfileJson: true,
          companyHasInsolvency: true,
          companyRecentDepots: true,
          companyEtabsCount: true,
          companyRevenue: true,
          companyResultNet: true,
        },
      },
    },
  });
  if (!trigger) throw new Error("Aucun trigger DTL trouvé");

  console.log(`\n📋 Trigger test : ${trigger.id}`);
  console.log(`   companyName : ${trigger.companyName}`);
  console.log(`   sourceCode : ${trigger.sourceCode}`);
  console.log(`   currentScore : ${trigger.score} (${trigger.scoreReason?.slice(0, 80) ?? "no reason"})`);

  const icp = client.icp as Record<string, unknown>;

  // Simule la même logique que qualify-trigger.ts (post-Sprint B.3)
  const dreamArchetype = typeof icp.dreamArchetype === "string" ? icp.dreamArchetype : null;
  const signalPrimary = typeof icp.signalPrimary === "string" ? icp.signalPrimary : null;
  const signalSecondary = typeof icp.signalSecondary === "string" ? icp.signalSecondary : null;
  const redFlagsHard = Array.isArray(icp.redFlagsHard) ? (icp.redFlagsHard as string[]) : null;
  const redFlagsSoft = Array.isArray(icp.redFlagsSoft) ? (icp.redFlagsSoft as string[]) : null;
  const nonRedFlags = Array.isArray(icp.nonRedFlags) ? (icp.nonRedFlags as string[]) : null;
  const fewShotPositives = (icp.fewShotPositives && typeof icp.fewShotPositives === "object")
    ? icp.fewShotPositives as Record<string, unknown>
    : null;
  const pitchVerbatim = typeof icp.pitchVerbatim === "string" ? icp.pitchVerbatim : null;
  const freshnessByTrigger = (icp.freshnessByTrigger && typeof icp.freshnessByTrigger === "object")
    ? icp.freshnessByTrigger as Record<string, unknown>
    : null;

  console.log("\n=== Champs Fred présents dans Client.icp ? ===");
  console.log(`  dreamArchetype : ${dreamArchetype ? "✅" : "❌"} ${dreamArchetype?.slice(0, 60) ?? ""}`);
  console.log(`  signalPrimary : ${signalPrimary ? "✅" : "❌"} ${signalPrimary?.slice(0, 60) ?? ""}`);
  console.log(`  signalSecondary : ${signalSecondary ? "✅" : "❌"}`);
  console.log(`  redFlagsHard : ${redFlagsHard ? `✅ (${redFlagsHard.length})` : "❌"}`);
  console.log(`  redFlagsSoft : ${redFlagsSoft ? `✅ (${redFlagsSoft.length})` : "❌"}`);
  console.log(`  nonRedFlags : ${nonRedFlags ? `✅ (${nonRedFlags.length})` : "❌"}`);
  console.log(`  fewShotPositives : ${fewShotPositives ? "✅" : "❌"}`);
  console.log(`  pitchVerbatim : ${pitchVerbatim ? `✅ (${pitchVerbatim.length} chars)` : "❌"}`);
  console.log(`  freshnessByTrigger : ${freshnessByTrigger ? "✅" : "❌"}`);

  // Reconstruction du bloc fredEnrichedBlock
  const fredEnrichedSection: string[] = [];
  if (dreamArchetype) fredEnrichedSection.push(`dreamArchetype : "${dreamArchetype}"`);
  if (signalPrimary) fredEnrichedSection.push(`signalPrimary (signal #1 du client, à évaluer en priorité) : ${signalPrimary}`);
  if (signalSecondary) fredEnrichedSection.push(`signalSecondary (signal mou, pondère plus faiblement) : ${signalSecondary}`);
  if (redFlagsHard?.length) fredEnrichedSection.push(`redFlagsHard (match → score ≤ 2 systématique) :\n  - ${redFlagsHard.join("\n  - ")}`);
  if (redFlagsSoft?.length) fredEnrichedSection.push(`redFlagsSoft (match → -2 points plancher 4, pas exclusion) :\n  - ${redFlagsSoft.join("\n  - ")}`);
  if (nonRedFlags?.length) fredEnrichedSection.push(`nonRedFlags (NE PAS pénaliser ces critères, le client a tranché) :\n  - ${nonRedFlags.join("\n  - ")}`);
  if (fewShotPositives) {
    const lines: string[] = [];
    if (Array.isArray(fewShotPositives.confirmedClients)) {
      const names = (fewShotPositives.confirmedClients as Array<Record<string, unknown>>)
        .map((c) => String(c.name ?? "?")).filter(Boolean);
      if (names.length) lines.push(`confirmedClients (déjà signés — match → score ≥ 8) : ${names.join(", ")}`);
    }
    if (Array.isArray(fewShotPositives.dreamProspects)) {
      const names = (fewShotPositives.dreamProspects as Array<Record<string, unknown>>)
        .map((c) => String(c.name ?? "?")).filter(Boolean);
      if (names.length) lines.push(`dreamProspects (cibles validées par jugement — match → score ≥ 7) : ${names.join(", ")}`);
    }
    if (lines.length) fredEnrichedSection.push(`fewShotPositives :\n  - ${lines.join("\n  - ")}`);
  }
  if (freshnessByTrigger) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(freshnessByTrigger)) {
      if (v && typeof v === "object" && "minDays" in (v as object)) {
        const w = v as { minDays?: number; maxDays?: number; staleAfterDays?: number };
        parts.push(`${k}: J+${w.minDays ?? "?"} → J+${w.maxDays ?? "?"}${w.staleAfterDays ? ` (stale après J+${w.staleAfterDays})` : ""}`);
      }
    }
    if (parts.length) fredEnrichedSection.push(`freshnessByTrigger : ${parts.join(", ")}`);
  }
  if (pitchVerbatim) fredEnrichedSection.push(`pitchVerbatim (style/ton du client pour cohérence brief) : "${pitchVerbatim.slice(0, 600)}"`);

  const fredEnrichedBlock = fredEnrichedSection.length > 0
    ? `\n\nCLIENT ENRICHED (réponses fondateur, autorité maximale) :\n${fredEnrichedSection.map((s) => `- ${s}`).join("\n")}`
    : "";

  console.log("\n=== Bloc CLIENT ENRICHED généré ===");
  console.log(fredEnrichedBlock);
  console.log(`\n=== Métriques ===`);
  console.log(`  Bloc CLIENT ENRICHED : ${fredEnrichedBlock.length} chars (~${Math.round(fredEnrichedBlock.length / 4)} tokens)`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
