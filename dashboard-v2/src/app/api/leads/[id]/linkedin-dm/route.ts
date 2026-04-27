import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";

export const maxDuration = 60;

// ──────────────────────────────────────────────────────────────────────
// Endpoint on-demand LinkedIn DM (connection note + followup J+3)
// ──────────────────────────────────────────────────────────────────────
// Remplace la génération auto en cron (désactivée le 27/04/2026 — économie tokens).
// LinkedIn = action manuelle humaine (cf règle non-négociable Trigger Engine #1).
// TODO: ajouter une migration Prisma pour cacher en DB (linkedinDmJson + linkedinDmGeneratedAt)
// quand le user pourra valider la migration.
// ──────────────────────────────────────────────────────────────────────

interface LinkedinDmPayload {
  connection: string;
  followup: string;
  inmail: string;
  comment: string;
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
  return `Tu es l'assistant commercial d'iFIND. Tu produis des MESSAGES LINKEDIN ultra-personnalisés pour ce signal d'achat. Le commercial humain enverra à la main (LinkedIn = pas d'auto chez iFIND).

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
- Connection note : ≤ 280 caractères, ENTRÉE DIRECTE sur le trigger, pas de "salut/bonjour"
- Followup J+3 : ≤ 400 caractères, relance après acceptation, angle nouveau
- InMail (si pas connecté) : ≤ 1900 caractères, sujet + corps, finir par question fermée
- Comment idea : 1 idée de commentaire pertinent à laisser sur un post récent du contact (warm-up)
- Vouvoiement professionnel, ton conversationnel, pas de jargon

# FORMAT DE RÉPONSE — JSON STRICT
{
  "connection": "string ≤ 280 chars (note de connexion)",
  "followup": "string ≤ 400 chars (relance J+3 après acceptation)",
  "inmail": "string ≤ 1900 chars (InMail si pas connecté, format: Sujet: ...\\n\\nCorps...)",
  "comment": "string — idée commentaire à laisser sur un post du contact pour warm-up"
}`;
}

function extractJson(text: string): LinkedinDmPayload {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned) as LinkedinDmPayload;
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
      { error: "Pas de trigger associé — impossible de générer la DM LinkedIn" },
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

  let dm: LinkedinDmPayload;
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
    dm = extractJson(textBlock.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    console.error("[linkedin-dm] erreur Opus:", msg);
    return NextResponse.json(
      { error: "Génération impossible", detail: msg },
      { status: 502 },
    );
  }

  return NextResponse.json({
    linkedinDm: dm,
    generatedAt: new Date().toISOString(),
    fresh: true,
    cached: false,
  });
}
