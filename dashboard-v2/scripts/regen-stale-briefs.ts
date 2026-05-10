// One-shot : régénère les briefs Opus > 5 jours (V1 obsolètes pre-refactor).
// Coût estimé : ~$0.04 par lead × N candidats.
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const STALE_DAYS = Number(process.argv[2] ?? 5);

(async () => {
  const { db } = await import("../src/lib/db");
  const { getAnthropic, BRIEF_MODEL } = await import("../src/lib/anthropic");
  const { buildCachedSystem } = await import("../src/lib/anthropic-prompt");
  const { buildPrompt, extractJson } = await import("../src/lib/brief-builder");
  const { Prisma } = await import("@prisma/client");

  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  // Récup leads dashboard actifs avec brief STALE (> N jours) OU MANQUANT.
  // Le filtre Prisma JSON null est délicat, on filtre in-process.
  const allActiveLeads = await db.lead.findMany({
    where: {
      deletedAt: null,
      status: { in: ["NEW", "ENRICHED"] },
      trigger: {
        deletedAt: null,
        status: { not: "IGNORED" },
      },
    },
    include: {
      trigger: {
        select: {
          id: true,
          title: true,
          detail: true,
          score: true,
          isHot: true,
          isCombo: true,
          type: true,
          industry: true,
          region: true,
          size: true,
          companyName: true,
          briefV2Json: true,
        },
      },
      client: {
        select: { id: true, name: true, industry: true, icp: true },
      },
    },
    orderBy: { briefGeneratedAt: "asc" },
  });

  // Filtre in-process : brief manquant OU stale > cutoff
  const leads = allActiveLeads.filter((l) => {
    if (l.briefJson == null) return true;
    if (!l.briefGeneratedAt) return true;
    return l.briefGeneratedAt < cutoff;
  });

  console.log(`\n=== REGEN BRIEFS (manquants OU > ${STALE_DAYS}j) ===`);
  console.log(`${leads.length} leads candidats (sur ${allActiveLeads.length} dashboard actifs)\n`);
  if (leads.length === 0) {
    console.log("Rien à faire.");
    process.exit(0);
  }

  let regen = 0;
  let errs = 0;
  for (const lead of leads) {
    if (!lead.trigger) {
      console.log(`  ⏭️  ${lead.companyName} — pas de trigger, skip`);
      continue;
    }
    const ageDays = Math.floor(
      (Date.now() - (lead.briefGeneratedAt?.getTime() ?? 0)) / 86400000,
    );
    process.stdout.write(`  Regen ${lead.companyName} (${lead.fullName ?? "?"}, brief ${ageDays}j) ... `);
    try {
      const prompt = buildPrompt({
        trigger: {
          ...lead.trigger,
          briefV2Json: lead.trigger.briefV2Json as
            | { verdict?: "OUI" | "ENRICH" | "NON"; confidence?: number }
            | null,
        },
        lead: {
          fullName: lead.fullName,
          jobTitle: lead.jobTitle,
          companyName: lead.companyName,
        },
        client: {
          name: lead.client.name,
          industry: lead.client.industry,
          icp:
            lead.client.icp && typeof lead.client.icp === "object"
              ? (lead.client.icp as Record<string, unknown>)
              : null,
        },
      });
      const anthropic = getAnthropic();
      const completion = await anthropic.messages.create({
        model: BRIEF_MODEL,
        max_tokens: 4096,
        system: buildCachedSystem(
          "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
        ),
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = completion.content.find((b: any) => b.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      if (!textBlock) throw new Error("Réponse Opus vide");
      const brief = extractJson(textBlock.text);
      await db.lead.update({
        where: { id: lead.id },
        data: {
          briefJson: brief as unknown as any,
          briefGeneratedAt: new Date(),
        },
      });
      console.log(`✅`);
      regen++;
    } catch (e: any) {
      console.log(`❌ ${e.message}`);
      errs++;
    }
    // Petite pause pour ne pas hammer Anthropic
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== TERMINÉ ===`);
  console.log(`✅ ${regen} briefs régénérés`);
  if (errs > 0) console.log(`❌ ${errs} erreurs`);
  console.log(`Coût estimé : ~$${(regen * 0.04).toFixed(2)}`);
  process.exit(0);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
