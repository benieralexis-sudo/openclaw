import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";

export const maxDuration = 60;

// ──────────────────────────────────────────────────────────────────────
// Endpoint on-demand call-brief (script de call ultra-opérationnel)
// ──────────────────────────────────────────────────────────────────────
// Cache DB (Lead.callBriefJson + callBriefGeneratedAt). TTL 7j.
// ──────────────────────────────────────────────────────────────────────

interface CallBriefPayload {
  intro: string;
  hook: string;
  questions: string[];
  objections: { obj: string; reply: string }[];
  competitorAngle: string;
  close: string;
  postCallNotes: string;
}

const CACHE_TTL_DAYS = 7;

function isCacheFresh(generatedAt: Date | null): boolean {
  if (!generatedAt) return false;
  const ageMs = Date.now() - generatedAt.getTime();
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function buildPrompt(args: {
  trigger: {
    title: string;
    detail: string | null;
    score: number;
    isHot: boolean;
    isCombo: boolean;
    type: string;
    industry: string | null;
    region: string | null;
    size: string | null;
    companyName: string;
  };
  lead: {
    fullName: string | null;
    jobTitle: string | null;
    companyName: string;
  };
  client: {
    name: string;
    industry: string | null;
    icp: Record<string, unknown> | null;
  };
}): string {
  const { trigger, lead, client } = args;
  const icp = client.icp ?? {};
  return `Tu es l'assistant commercial d'iFIND. Tu produis un BRIEF DE CALL ultra-opérationnel pour aider un commercial humain à mener un appel découverte sur ce signal d'achat.

# CONTEXTE CLIENT iFIND
- Société : ${client.name}
- Secteur : ${client.industry ?? "—"}
- ICP cible : ${JSON.stringify(icp)}

# TRIGGER DÉTECTÉ
- Entreprise : ${trigger.companyName}
- Type : ${trigger.type}
- Score : ${trigger.score}/10 ${trigger.isHot ? "🔥 HOT" : ""} ${trigger.isCombo ? "✨ COMBO" : ""}
- Titre : ${trigger.title}
- Détail : ${trigger.detail ?? "—"}
- Industrie : ${trigger.industry ?? "—"} · Région : ${trigger.region ?? "—"} · Taille : ${trigger.size ?? "—"}

# CONTACT
- Nom : ${lead.fullName ?? "Décideur à identifier"}
- Poste : ${lead.jobTitle ?? "—"}
- Entreprise : ${lead.companyName}

# RÈGLES STRICTES
- Intro : 30 secondes max, vouvoiement, mention du trigger comme raison d'appel
- Hook : phrase d'accroche basée sur le signal détecté (créer le "wow")
- Questions découverte : 3 questions ouvertes MAX (BANT-like : Budget, Authority, Need, Timing)
- Objections : 3 objections probables avec réponse en 1 phrase chacune
- Angle concurrentiel : comment se différencier si le contact évoque un concurrent
- Close : proposition créneau Cal.com avec 2 options précises (mardi 14h ou jeudi 10h type)
- Notes post-call : 3-4 points à logger après l'appel pour qualifier la suite

# FORMAT DE RÉPONSE — JSON STRICT
{
  "intro": "string — intro téléphonique 30s max",
  "hook": "string — phrase d'accroche basée sur le trigger",
  "questions": ["q1", "q2", "q3"],
  "objections": [
    { "obj": "string — objection probable", "reply": "string — réponse en 1 phrase" }
  ],
  "competitorAngle": "string — angle de différenciation si le contact évoque un concurrent",
  "close": "string — proposition créneau précis (créneau A ou créneau B)",
  "postCallNotes": "string — 3-4 points à logger après l'appel"
}`;
}

function extractJson(text: string): CallBriefPayload {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned) as CallBriefPayload;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true, callBriefJson: true, callBriefGeneratedAt: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  return NextResponse.json({
    callBrief: lead.callBriefJson,
    generatedAt: lead.callBriefGeneratedAt,
    fresh: isCacheFresh(lead.callBriefGeneratedAt),
    cached: !!lead.callBriefJson,
  });
}

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
      client: { select: { id: true, name: true, industry: true, icp: true } },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  if (!force && isCacheFresh(lead.callBriefGeneratedAt) && lead.callBriefJson) {
    return NextResponse.json({
      callBrief: lead.callBriefJson,
      generatedAt: lead.callBriefGeneratedAt,
      fresh: true,
      cached: true,
    });
  }

  if (!lead.trigger) {
    return NextResponse.json(
      { error: "Pas de trigger associé — impossible de générer le brief de call" },
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

  let callBrief: CallBriefPayload;
  try {
    const anthropic = getAnthropic();
    const completion = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 3072,
      system:
        "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = completion.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Réponse Anthropic vide");
    }
    callBrief = extractJson(textBlock.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    console.error("[call-brief] erreur Opus:", msg);
    return NextResponse.json(
      { error: "Génération impossible", detail: msg },
      { status: 502 },
    );
  }

  const generatedAt = new Date();
  await db.lead.update({
    where: { id },
    data: {
      callBriefJson: callBrief as unknown as Prisma.InputJsonValue,
      callBriefGeneratedAt: generatedAt,
    },
  });

  return NextResponse.json({
    callBrief,
    generatedAt: generatedAt.toISOString(),
    fresh: true,
    cached: false,
  });
}
