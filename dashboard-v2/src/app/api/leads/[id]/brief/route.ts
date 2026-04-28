import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";

export const maxDuration = 60; // Opus peut prendre 15-30s

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface BriefPayload {
  summary: {
    whyNow: string;
    icpMatch: string;
    angle: string;
    objections: Array<{ obj: string; reply: string }>;
    closeLine: string;
  };
  email: {
    subject: string;
    body: string;
  };
  linkedin: {
    connection: string;
    followup: string;
  };
  callScript: {
    intro: string;
    hook: string;
    questions: string[];
    objectionHandling: Array<{ obj: string; response: string }>;
    close: string;
  };
}

const CACHE_TTL_DAYS = 7;

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

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
  return `Tu es l'assistant commercial d'iFIND. Tu produis un BRIEF COMMERCIAL ULTRA-OPÉRATIONNEL pour aider un commercial humain à transformer ce signal d'achat en RDV.

# CONTEXTE CLIENT iFIND (qui paie)
- Société : ${client.name}
- Secteur : ${client.industry ?? "—"}
- ICP cible : ${JSON.stringify(icp)}

# TRIGGER DÉTECTÉ (signal d'achat public)
- Entreprise cible : ${trigger.companyName}
- Type de signal : ${trigger.type}
- Score : ${trigger.score}/10 ${trigger.isHot ? "🔥 HOT" : ""} ${trigger.isCombo ? "✨ COMBO" : ""}
- Titre : ${trigger.title}
- Détail : ${trigger.detail ?? "—"}
- Industrie : ${trigger.industry ?? "—"} · Région : ${trigger.region ?? "—"} · Taille : ${trigger.size ?? "—"}

# CONTACT IDENTIFIÉ
- Nom : ${lead.fullName ?? "Décideur à identifier"}
- Poste : ${lead.jobTitle ?? "—"}
- Entreprise : ${lead.companyName}

# TA TÂCHE
Produis un brief en français, ton professionnel direct, sans jargon marketing creux. Chaque phrase doit être actionnable. Le commercial doit pouvoir copier-coller en 3 minutes max.

# RÈGLES STRICTES
- Email : sujet ≤ 60 caractères, corps ≤ 800 caractères, mention explicite du trigger comme hook, finir par une question fermée (créneau A ou B)
- LinkedIn connection : ≤ 280 caractères, pas de "salut/bonjour", entrée directe sur le trigger
- LinkedIn follow-up : à envoyer J+3 si pas de réponse, ≤ 400 caractères
- Script call : intro 30s max, 3 questions ouvertes seulement, traitement de 3 objections types, close avec proposition créneau Cal.com
- 3 objections probables MAX dans le summary, chacune avec une réponse en 1 phrase
- Phrase de close : 1 question, créneau précis (ex. "Mardi 14h ou jeudi 10h ?")

# FORMAT DE RÉPONSE
Réponds UNIQUEMENT avec un JSON valide qui matche exactement cette structure (pas de markdown, pas de texte avant/après) :

{
  "summary": {
    "whyNow": "string — pourquoi ce trigger justifie un contact MAINTENANT",
    "icpMatch": "string — pourquoi ce compte match l'ICP du client iFIND",
    "angle": "string — angle d'attaque recommandé en 1 phrase",
    "objections": [
      { "obj": "string — objection probable", "reply": "string — réponse en 1 phrase" }
    ],
    "closeLine": "string — phrase de close finale avec créneau"
  },
  "email": {
    "subject": "string — sujet email ≤ 60 chars",
    "body": "string — corps email avec retours à la ligne \\n"
  },
  "linkedin": {
    "connection": "string — message connexion ≤ 280 chars",
    "followup": "string — message J+3 si pas de réponse"
  },
  "callScript": {
    "intro": "string — intro téléphonique 30s",
    "hook": "string — phrase d'accroche basée sur le trigger",
    "questions": ["q1", "q2", "q3"],
    "objectionHandling": [
      { "obj": "string", "response": "string" }
    ],
    "close": "string — proposition créneau Cal.com"
  }
}`;
}

function extractJson(text: string): BriefPayload {
  // L'API peut entourer la réponse de markdown ```json ... ``` malgré la consigne
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  // Trouve le premier { et le dernier } pour être robuste
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned) as BriefPayload;
}

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
