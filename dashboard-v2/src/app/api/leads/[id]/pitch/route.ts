import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";

export const maxDuration = 60; // Opus peut prendre 15-30s

// ──────────────────────────────────────────────────────────────────────
// Endpoint on-demand pitch (email cold-outreach personnalisé)
// ──────────────────────────────────────────────────────────────────────
// Remplace la génération auto en cron (désactivée le 27/04/2026 — économie tokens).
// TODO: ajouter une migration Prisma pour cacher en DB (pitchJson + pitchGeneratedAt)
// quand le user pourra valider la migration. Pour l'instant : génération à chaque
// clic, le front doit donc gérer son propre cache local si besoin.
// ──────────────────────────────────────────────────────────────────────

interface PitchPayload {
  subject: string;
  body: string;
  followup: string;
  variants: { subject: string; openLine: string }[];
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
  return `Tu es l'assistant commercial d'iFIND. Tu produis un EMAIL DE COLD OUTREACH ultra-personnalisé pour transformer ce signal d'achat en RDV.

# CONTEXTE CLIENT iFIND (qui paie)
- Société : ${client.name}
- Secteur : ${client.industry ?? "—"}
- ICP cible : ${JSON.stringify(icp)}

# TRIGGER DÉTECTÉ (signal d'achat public)
- Entreprise cible : ${trigger.companyName}
- Type : ${trigger.type}
- Score : ${trigger.score}/10 ${trigger.isHot ? "🔥 HOT" : ""} ${trigger.isCombo ? "✨ COMBO" : ""}
- Titre : ${trigger.title}
- Détail : ${trigger.detail ?? "—"}
- Industrie : ${trigger.industry ?? "—"} · Région : ${trigger.region ?? "—"} · Taille : ${trigger.size ?? "—"}

# CONTACT IDENTIFIÉ
- Nom : ${lead.fullName ?? "Décideur à identifier"}
- Poste : ${lead.jobTitle ?? "—"}
- Entreprise : ${lead.companyName}

# RÈGLES STRICTES
- Sujet : ≤ 60 caractères, accroche directe sur le trigger
- Body : ≤ 800 caractères, 4 paragraphes max, hook trigger + value prop + question fermée (créneau A ou B)
- Followup J+3 : ≤ 400 caractères, ton léger, relance avec angle complémentaire
- 2 variantes A/B sur le sujet et la première phrase
- Vouvoiement professionnel, pas de jargon marketing creux

# FORMAT DE RÉPONSE — JSON STRICT
{
  "subject": "string ≤ 60 chars",
  "body": "string ≤ 800 chars avec retours \\n",
  "followup": "string ≤ 400 chars (à envoyer J+3 si pas de réponse)",
  "variants": [
    { "subject": "variante A", "openLine": "première phrase variante A" },
    { "subject": "variante B", "openLine": "première phrase variante B" }
  ]
}`;
}

function extractJson(text: string): PitchPayload {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned) as PitchPayload;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

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

  if (!lead.trigger) {
    return NextResponse.json(
      { error: "Pas de trigger associé — impossible de générer le pitch" },
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

  let pitch: PitchPayload;
  try {
    const anthropic = getAnthropic();
    const completion = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 2048,
      system:
        "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = completion.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Réponse Anthropic vide");
    }
    pitch = extractJson(textBlock.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    console.error("[pitch] erreur Opus:", msg);
    return NextResponse.json(
      { error: "Génération impossible", detail: msg },
      { status: 502 },
    );
  }

  return NextResponse.json({
    pitch,
    generatedAt: new Date().toISOString(),
    fresh: true,
    cached: false,
  });
}
