import "server-only";

/**
 * Étape C (04/05) — Auto-génération des briefs Opus pour les leads chauds.
 *
 * Tourne après ensureLeadsForAllTriggers dans le cron run-pollers.
 * Pour chaque lead "chaud" (trigger score >= 8 + isHot, OU fitScore >= 75,
 * OU trigger QA-stuck) qui n'a pas encore de briefJson valide, déclenche
 * la génération Opus et persiste en DB.
 *
 * Limites de coût :
 * - Max N briefs par run (default 5) → ~5 × 0,02€ = 0,10€/run
 * - Tourne uniquement sur source=all (cron 6h, pas le 1h)
 * - TTL réutilisé : skip implicite si briefJson déjà présent et valide
 *
 * Réutilise buildPrompt + extractJson depuis brief-builder.ts (extraction
 * post Sprint 1 setup fix : Next.js Route Handlers interdisent les exports
 * custom).
 */

import { db } from "@/lib/db";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
import { buildPrompt, extractJson } from "@/lib/brief-builder";
import type { Prisma } from "@prisma/client";

export interface AutoBriefsResult {
  clientId: string;
  candidates: number;
  generated: number;
  errors: number;
  skipped: number;
}

export async function autoGenerateBriefsForHotLeads(
  clientId: string,
  options: { maxPerRun?: number } = {},
): Promise<AutoBriefsResult> {
  const maxPerRun = options.maxPerRun ?? 5;
  const result: AutoBriefsResult = {
    clientId,
    candidates: 0,
    generated: 0,
    errors: 0,
    skipped: 0,
  };

  // Sélection identique au script CLI generate-briefs-digitestlab.ts :
  // chauds = (trigger.score >= 8 ET isHot) OU fitScore >= 75 OU QA-stuck
  // ET briefJson manquant ou whyNow vide
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      OR: [
        { fitScore: { gte: 75 } },
        { trigger: { scoreReason: { contains: "QA-STUCK" } } },
        { trigger: { score: { gte: 8 }, isHot: true } },
      ],
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
    // Priorité : nouveaux d'abord (createdAt desc), bouclera sur le reste les runs suivants
    orderBy: { createdAt: "desc" },
  });

  // Filtre côté code : pas déjà un brief valide
  const toGenerate = candidates
    .filter((l) => {
      const wn = (l.briefJson as { summary?: { whyNow?: string } })?.summary?.whyNow;
      return !wn || wn.trim().length === 0;
    })
    .slice(0, maxPerRun);

  result.candidates = toGenerate.length;
  if (toGenerate.length === 0) return result;

  const anthropic = getAnthropic();

  for (const lead of toGenerate) {
    if (!lead.trigger) {
      result.skipped += 1;
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
          ? (lead.client.icp as Record<string, unknown>)
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
          briefJson: brief as unknown as Prisma.InputJsonValue,
          briefGeneratedAt: new Date(),
        },
      });
      result.generated += 1;

      // Throttle anti-saturation Anthropic
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.warn(
        `[auto-generate-briefs] erreur lead ${lead.id} (${lead.companyName}):`,
        e instanceof Error ? e.message : e,
      );
      result.errors += 1;
    }
  }

  return result;
}
