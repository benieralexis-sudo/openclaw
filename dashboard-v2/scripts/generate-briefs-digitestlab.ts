// @ts-nocheck — script CLI
/**
 * Étape B (04/05) — Génération en batch des briefs Opus pour les leads
 * brûlants DTL qui n'en ont pas encore.
 *
 * Cible (élargie 04/05 après cas Forsk score 9 fitScore 50 manqué) :
 *  - Trigger score >= 8 ET isHot = true (= ce que les commerciaux vont
 *    vraiment appeler, indépendamment du persona-fit)
 *  - OU fitScore >= 75 (Brûlants persona)
 *  - OU triggers QA-stuck boostés Bougie 3 (scoreReason marker [QA-STUCK)
 *  - ET briefJson IS NULL ou whyNow vide (pas déjà couvert)
 *
 * Usage :
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/generate-briefs-digitestlab.ts [--dry-run] [--only=collective-id]
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
  const dryRun = process.argv.includes("--dry-run");
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlyId = onlyArg ? onlyArg.split("=")[1] : null;

  const { db } = await import("../src/lib/db");
  const { getAnthropic, BRIEF_MODEL } = await import("../src/lib/anthropic");
  const { buildCachedSystem } = await import("../src/lib/anthropic-prompt");
  const { buildPrompt, extractJson } = await import("../src/app/api/leads/[id]/brief/route");

  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true },
  });
  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }

  // Sélection : brûlants (fitScore >= 75) OU lead lié à un trigger QA-stuck
  // ET sans briefJson valide
  const candidates = await db.lead.findMany({
    where: {
      clientId: client.id,
      deletedAt: null,
      ...(onlyId ? { id: onlyId } : {
        OR: [
          { fitScore: { gte: 75 } },
          { trigger: { scoreReason: { contains: "QA-STUCK" } } },
          // Trigger fort + Hot = lead à attaquer même si fitScore moyen
          // (cas Forsk : CEO d'ESN 25M€, score 9, isHot, fitScore 50
          //  car "trop haut placé" — mais c'est quand même une vraie pépite)
          { trigger: { score: { gte: 8 }, isHot: true } },
        ],
      }),
    },
    include: {
      trigger: {
        select: {
          id: true, title: true, detail: true, score: true, isHot: true,
          isCombo: true, type: true, industry: true, region: true, size: true,
          companyName: true,
        },
      },
      client: {
        select: { id: true, name: true, industry: true, icp: true },
      },
    },
  });

  // Filtre côté code : pas déjà un brief valide (whyNow non vide)
  const toGenerate = candidates.filter((l) => {
    const wn = (l.briefJson as { summary?: { whyNow?: string } })?.summary?.whyNow;
    return !wn || wn.trim().length === 0;
  });

  console.log(`📦 ${client.name} — ${candidates.length} leads candidats, ${toGenerate.length} à générer (briefJson manquant ou vide)`);
  console.log(`🚦 Mode : ${dryRun ? "DRY RUN" : "REAL RUN"}\n`);

  if (toGenerate.length === 0) {
    console.log("✅ Rien à générer.");
    await db.$disconnect();
    return;
  }

  let success = 0, errors = 0, skippedNoTrigger = 0;
  const anthropic = getAnthropic();

  for (const lead of toGenerate) {
    const tag = `[${lead.companyName ?? lead.id.slice(0, 8)}]`;
    if (!lead.trigger) {
      console.log(`  ${tag} skip — pas de trigger lié`);
      skippedNoTrigger += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  ${tag} (dry) → générerait brief`);
      success += 1;
      continue;
    }

    const prompt = buildPrompt({
      trigger: lead.trigger,
      lead: {
        fullName: lead.fullName,
        jobTitle: lead.jobTitle,
        companyName: lead.companyName,
      },
      client: {
        name: lead.client.name,
        industry: lead.client.industry,
        icp: lead.client.icp && typeof lead.client.icp === "object"
          ? lead.client.icp
          : null,
      },
    });

    try {
      const completion = await anthropic.messages.create({
        model: BRIEF_MODEL,
        max_tokens: 4096,
        system: buildCachedSystem(
          "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
        ),
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = completion.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") throw new Error("Réponse Anthropic vide");
      const brief = extractJson(textBlock.text);

      await db.lead.update({
        where: { id: lead.id },
        data: {
          briefJson: brief,
          briefGeneratedAt: new Date(),
        },
      });
      const wnLen = brief.summary?.whyNow?.length ?? 0;
      const angLen = brief.summary?.angle?.length ?? 0;
      console.log(`  ${tag} ✓ généré (whyNow ${wnLen}c · angle ${angLen}c)`);
      success += 1;

      // Throttle pour pas saturer Anthropic / Opus
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${tag} ❌ ${msg}`);
      errors += 1;
    }
  }

  console.log(`\n=== Résumé ===`);
  console.log(`  Générés          : ${success}`);
  console.log(`  Erreurs          : ${errors}`);
  console.log(`  Skip (no trigger): ${skippedNoTrigger}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
