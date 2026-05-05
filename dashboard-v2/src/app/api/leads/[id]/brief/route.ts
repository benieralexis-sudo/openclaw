import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
// Sprint 1 setup fix (05/05) — Helpers extraits dans src/lib/brief-builder.ts
// Next.js Route Handlers n'autorisent pas d'exports custom autres que GET/POST/etc.
// (build error : "buildPrompt is not a valid Route export field").
import {
  type BriefPayload,
  buildPrompt,
  extractJson,
  isCacheFresh,
} from "@/lib/brief-builder";

export const maxDuration = 60; // Opus peut prendre 15-30s

// ──────────────────────────────────────────────────────────────────────
// GET — retourne le cache uniquement
// ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true, briefJson: true, briefGeneratedAt: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  return NextResponse.json({
    brief: lead.briefJson,
    generatedAt: lead.briefGeneratedAt,
    fresh: isCacheFresh(lead.briefGeneratedAt),
  });
}

// ──────────────────────────────────────────────────────────────────────
// POST — génère (ou retourne le cache) ; ?force=true pour régénérer
// ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "true";

  const lead = await db.lead.findUnique({
    where: { id },
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
        },
      },
      client: {
        select: { id: true, name: true, industry: true, icp: true },
      },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  // Cache check
  if (!force && isCacheFresh(lead.briefGeneratedAt) && lead.briefJson) {
    return NextResponse.json({
      brief: lead.briefJson,
      generatedAt: lead.briefGeneratedAt,
      fresh: true,
      cached: true,
    });
  }

  if (!lead.trigger) {
    return NextResponse.json(
      { error: "Pas de trigger associé — impossible de générer le brief" },
      { status: 400 },
    );
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
      icp:
        lead.client.icp && typeof lead.client.icp === "object"
          ? (lead.client.icp as Record<string, unknown>)
          : null,
    },
  });

  let brief: BriefPayload;
  try {
    const anthropic = getAnthropic();
    const completion = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 4096,
      system: buildCachedSystem(
        "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
      ),
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = completion.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Réponse Anthropic vide");
    }
    brief = extractJson(textBlock.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    console.error("[brief] erreur Opus:", msg);
    return NextResponse.json(
      { error: "Génération impossible", detail: msg },
      { status: 502 },
    );
  }

  // Save cache
  const generatedAt = new Date();
  await db.lead.update({
    where: { id },
    data: {
      briefJson: brief as unknown as Prisma.InputJsonValue,
      briefGeneratedAt: generatedAt,
    },
  });

  return NextResponse.json({
    brief,
    generatedAt: generatedAt.toISOString(),
    fresh: true,
    cached: false,
  });
}
