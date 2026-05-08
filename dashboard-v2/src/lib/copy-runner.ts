import "server-only";

/**
 * Orchestrateur DB pour le Copy Engine.
 * Charge le Lead + Trigger + Client, appelle Opus avec le prompt unifié,
 * persiste les 4 contextes en DB, retourne le payload.
 *
 * Cache : 7 jours via copyGeneratedAt. force=true bypass.
 *
 * Refus :
 *  - Lead bouncedAt → économie tokens
 *  - Lead doNotContact → RGPD
 *  - Lead sans Trigger → impossible de générer sans signal
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
import {
  buildCopyPrompt,
  parseCopyResponse,
  validateCopyPayload,
  type CopyPayload,
} from "@/lib/copy-generator";

const CACHE_TTL_DAYS = 7;

export interface CopyRunResult {
  ok: true;
  payload: CopyPayload;
  cached: boolean;
  generatedAt: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface CopyRunError {
  ok: false;
  error: string;
  code: "lead_not_found" | "scope_denied" | "no_trigger" | "lead_blocked" | "anthropic_error" | "validation_error";
  detail?: string;
}

function isCacheFresh(generatedAt: Date | null): boolean {
  if (!generatedAt) return false;
  const ageMs = Date.now() - generatedAt.getTime();
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export async function generateCopyForLead(args: {
  leadId: string;
  force?: boolean;
}): Promise<CopyRunResult | CopyRunError> {
  const { leadId, force = false } = args;

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      trigger: {
        select: {
          id: true,
          title: true,
          detail: true,
          score: true,
          isHot: true,
          type: true,
          industry: true,
          region: true,
          size: true,
          sourceCode: true,
          capturedAt: true,
        },
      },
      client: { select: { id: true, name: true, industry: true, icp: true } },
    },
  });

  if (!lead) {
    return { ok: false, error: "Lead introuvable", code: "lead_not_found" };
  }

  // Refus économie + RGPD
  if (lead.bouncedAt) {
    return { ok: false, error: "Lead bouncedAt — refus génération", code: "lead_blocked" };
  }
  if (lead.doNotContact) {
    return { ok: false, error: "Lead doNotContact — refus RGPD", code: "lead_blocked" };
  }

  if (!lead.trigger) {
    return { ok: false, error: "Pas de trigger associé", code: "no_trigger" };
  }

  // Cache check (sur copyGeneratedAt unifié)
  if (!force && isCacheFresh(lead.copyGeneratedAt) && lead.pitchJson && lead.warmMailJson && lead.linkedinDmJson && lead.callBriefJson) {
    return {
      ok: true,
      payload: {
        coldMail: lead.pitchJson as unknown as CopyPayload["coldMail"],
        warmMail: lead.warmMailJson as unknown as CopyPayload["warmMail"],
        linkedinDm: lead.linkedinDmJson as unknown as CopyPayload["linkedinDm"],
        callBrief: lead.callBriefJson as unknown as CopyPayload["callBrief"],
      },
      cached: true,
      generatedAt: lead.copyGeneratedAt!.toISOString(),
    };
  }

  // personaTier est Int? en DB (1/2/3) — on map vers la lettre A/B/C
  // attendue par la tone policy. null → fallback Tier B (intermediate safe).
  const tierLetter = lead.personaTier === 1 ? "A" : lead.personaTier === 2 ? "B" : lead.personaTier === 3 ? "C" : null;

  const prompt = buildCopyPrompt({
    trigger: lead.trigger,
    lead: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      jobTitle: lead.jobTitle,
      companyName: lead.companyName,
      personaTier: tierLetter,
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

  const start = Date.now();
  let payload: CopyPayload;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  try {
    const anthropic = getAnthropic();
    const completion = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 3500, // 4 contextes en 1 → tokens plus haut que les endpoints individuels
      system: buildCachedSystem(
        "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
      ),
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = completion.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "Réponse Anthropic vide", code: "anthropic_error" };
    }
    inputTokens = completion.usage.input_tokens;
    outputTokens = completion.usage.output_tokens;
    cacheReadTokens = completion.usage.cache_read_input_tokens ?? undefined;

    payload = parseCopyResponse(textBlock.text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "Erreur Anthropic", code: "anthropic_error", detail };
  }

  // Validation
  const v = validateCopyPayload(payload);
  if (!v.ok) {
    return {
      ok: false,
      error: "Payload invalide",
      code: "validation_error",
      detail: (v.errors ?? []).join(" | "),
    };
  }

  // Persist : 4 colonnes JSON + 4 timestamps + copyGeneratedAt unifié
  const now = new Date();
  await db.lead.update({
    where: { id: leadId },
    data: {
      pitchJson: payload.coldMail as unknown as Prisma.InputJsonValue,
      pitchGeneratedAt: now,
      warmMailJson: payload.warmMail as unknown as Prisma.InputJsonValue,
      warmMailGeneratedAt: now,
      linkedinDmJson: payload.linkedinDm as unknown as Prisma.InputJsonValue,
      linkedinDmGeneratedAt: now,
      callBriefJson: payload.callBrief as unknown as Prisma.InputJsonValue,
      callBriefGeneratedAt: now,
      copyGeneratedAt: now,
    },
  });

  return {
    ok: true,
    payload,
    cached: false,
    generatedAt: now.toISOString(),
    durationMs: Date.now() - start,
    inputTokens,
    outputTokens,
    cacheReadTokens,
  };
}
