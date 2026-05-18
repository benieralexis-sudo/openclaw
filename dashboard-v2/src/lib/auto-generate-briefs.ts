import "server-only";

/**
 * Auto-génération des briefs Opus pour les Leads exploitables.
 *
 * Bombora FR pivot (18/05/2026) — Réactivé + élargi.
 * Précédent design (04/05) ciblait uniquement les "hot" (score≥8+isHot OU fitScore≥75).
 * Précédent verrou (16/05, throw Error) : Fred ne consultait pas le dashboard.
 *
 * Nouveau ciblage : tout Lead status=NEW avec :
 *   - trigger associé
 *   - décideur identifié (firstName + lastName)
 *   - email présent (kasprWorkEmail/personalEmail OU email OU emailRodz OU emailDropcontact)
 *   - briefJson manquant ou whyNow vide
 *
 * Pour Bombora FR le brief est la valeur ajoutée core (justifie 1490€ vs Pharow 139€).
 * Sans brief le produit ne sert à rien.
 *
 * Tourne après ensureLeadsForAllTriggers dans le cron run-pollers (source=all, 6h).
 *
 * Limites de coût :
 * - Max maxPerRun briefs par run (default 15) → ~15 × 0,02€ = 0,30€/run = ~0,60€/jour
 * - Tourne uniquement sur source=all (cron 8h05/18h05, pas le 1h)
 * - TTL réutilisé : skip implicite si briefJson déjà présent et valide
 *
 * Réutilise buildPrompt + extractJson depuis brief-builder.ts.
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
  const maxPerRun = options.maxPerRun ?? 15;
  const result: AutoBriefsResult = {
    clientId,
    candidates: 0,
    generated: 0,
    errors: 0,
    skipped: 0,
  };

  // Bombora FR pivot 18/05 — Ciblage élargi :
  // Tout Lead status=NEW avec décideur + email + sans brief valide.
  // Priorité (orderBy) : fitScore desc, puis createdAt desc → couvre d'abord
  // les Pépites, puis remplit avec les warm/cold.
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: "NEW",
      firstName: { not: null },
      lastName: { not: null },
      OR: [
        { email: { not: null } },
        { kasprWorkEmail: { not: null } },
        { kasprPersonalEmail: { not: null } },
        { emailRodz: { not: null } },
        { emailDropcontact: { not: null } },
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
    // Priorité : Pépites d'abord (fitScore desc), puis nouveaux (createdAt desc)
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
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
