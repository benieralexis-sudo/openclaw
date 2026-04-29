// Script — backfill pitch + linkedin-dm + call-brief Opus pour les pépites.
// Usage : npx tsx scripts/backfill-opus-pipelines.ts [--client=digitestlab] [--score-min=8] [--force] [--dry-run] [--only=pitch|dm|brief]
//
// Réplique la logique des endpoints /api/leads/[id]/{pitch,linkedin-dm,call-brief}
// sans passer par HTTP/auth. Cache TTL 7j respecté sauf --force.
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

const db = new PrismaClient();
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY missing");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey });
const MODEL = "claude-opus-4-7";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface LeadCtx {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  companyName: string;
}
interface TriggerCtx {
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
}
interface ClientCtx {
  name: string;
  industry: string | null;
  icp: Record<string, unknown> | null;
}

function buildPitchPrompt(t: TriggerCtx, l: LeadCtx, c: ClientCtx): string {
  return `Tu es l'assistant commercial d'iFIND. Tu produis un EMAIL DE COLD OUTREACH ultra-personnalisé pour transformer ce signal d'achat en RDV.

# CONTEXTE CLIENT iFIND (qui paie)
- Société : ${c.name}
- Secteur : ${c.industry ?? "—"}
- ICP cible : ${JSON.stringify(c.icp ?? {})}

# TRIGGER DÉTECTÉ (signal d'achat public)
- Entreprise cible : ${t.companyName}
- Type : ${t.type}
- Score : ${t.score}/10 ${t.isHot ? "🔥 HOT" : ""} ${t.isCombo ? "✨ COMBO" : ""}
- Titre : ${t.title}
- Détail : ${t.detail ?? "—"}
- Industrie : ${t.industry ?? "—"} · Région : ${t.region ?? "—"} · Taille : ${t.size ?? "—"}

# CONTACT IDENTIFIÉ
- Nom : ${l.fullName ?? "Décideur à identifier"}
- Poste : ${l.jobTitle ?? "—"}
- Entreprise : ${l.companyName}

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

function buildDmPrompt(t: TriggerCtx, l: LeadCtx, c: ClientCtx): string {
  return `Tu es l'assistant commercial d'iFIND. Tu produis des MESSAGES LINKEDIN ultra-personnalisés pour ce signal d'achat. Le commercial humain enverra à la main (LinkedIn = pas d'auto chez iFIND).

# CONTEXTE CLIENT iFIND
- Société : ${c.name}
- Secteur : ${c.industry ?? "—"}
- ICP cible : ${JSON.stringify(c.icp ?? {})}

# TRIGGER DÉTECTÉ
- Entreprise : ${t.companyName}
- Type : ${t.type}
- Score : ${t.score}/10 ${t.isHot ? "🔥 HOT" : ""} ${t.isCombo ? "✨ COMBO" : ""}
- Titre : ${t.title}
- Détail : ${t.detail ?? "—"}
- Industrie : ${t.industry ?? "—"} · Région : ${t.region ?? "—"} · Taille : ${t.size ?? "—"}

# CONTACT
- Nom : ${l.fullName ?? "Décideur à identifier"}
- Poste : ${l.jobTitle ?? "—"}
- Entreprise : ${l.companyName}

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

function buildBriefPrompt(t: TriggerCtx, l: LeadCtx, c: ClientCtx): string {
  return `Tu es l'assistant commercial d'iFIND. Tu produis un BRIEF DE CALL ultra-opérationnel pour aider un commercial humain à mener un appel découverte sur ce signal d'achat.

# CONTEXTE CLIENT iFIND
- Société : ${c.name}
- Secteur : ${c.industry ?? "—"}
- ICP cible : ${JSON.stringify(c.icp ?? {})}

# TRIGGER DÉTECTÉ
- Entreprise : ${t.companyName}
- Type : ${t.type}
- Score : ${t.score}/10 ${t.isHot ? "🔥 HOT" : ""} ${t.isCombo ? "✨ COMBO" : ""}
- Titre : ${t.title}
- Détail : ${t.detail ?? "—"}
- Industrie : ${t.industry ?? "—"} · Région : ${t.region ?? "—"} · Taille : ${t.size ?? "—"}

# CONTACT
- Nom : ${l.fullName ?? "Décideur à identifier"}
- Poste : ${l.jobTitle ?? "—"}
- Entreprise : ${l.companyName}

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

function extractJson<T>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned) as T;
}

async function callOpus(prompt: string): Promise<unknown> {
  const completion = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system:
      "Tu es un assistant commercial expert en B2B FR. Tu réponds STRICTEMENT en JSON valide selon le schéma demandé, sans aucun texte autour.",
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = completion.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Réponse Anthropic vide");
  return extractJson(textBlock.text);
}

function isCacheFresh(generatedAt: Date | null): boolean {
  if (!generatedAt) return false;
  return Date.now() - generatedAt.getTime() < CACHE_TTL_MS;
}

async function main() {
  const args = process.argv.slice(2);
  const clientSlug = args.find((a) => a.startsWith("--client="))?.split("=")[1];
  const scoreMin = Number(args.find((a) => a.startsWith("--score-min="))?.split("=")[1] ?? 8);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] as
    | "pitch"
    | "dm"
    | "brief"
    | undefined;

  const clientFilter = clientSlug
    ? await db.client.findUnique({ where: { slug: clientSlug }, select: { id: true, name: true } })
    : null;
  if (clientSlug && !clientFilter) {
    console.error(`Client slug "${clientSlug}" introuvable`);
    process.exit(1);
  }

  const leads = await db.lead.findMany({
    where: {
      ...(clientFilter && { clientId: clientFilter.id }),
      trigger: { score: { gte: scoreMin }, deletedAt: null },
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
        },
      },
      client: { select: { name: true, industry: true, icp: true } },
    },
    orderBy: [{ trigger: { score: "desc" } }, { createdAt: "desc" }],
  });

  console.log(
    `Found ${leads.length} pépite-leads (score >= ${scoreMin}${clientFilter ? `, client=${clientFilter.name}` : ""})`,
  );
  console.log(`Mode: ${only ?? "all (pitch + dm + brief)"} ${force ? "[FORCE]" : ""} ${dryRun ? "[DRY-RUN]" : ""}`);
  console.log("---");

  let pitchGen = 0;
  let dmGen = 0;
  let briefGen = 0;
  let pitchSkip = 0;
  let dmSkip = 0;
  let briefSkip = 0;
  let errors = 0;

  for (const lead of leads) {
    if (!lead.trigger) {
      console.log(`SKIP ${lead.id} (no trigger)`);
      continue;
    }
    const t: TriggerCtx = lead.trigger;
    const l: LeadCtx = {
      id: lead.id,
      fullName: lead.fullName,
      jobTitle: lead.jobTitle,
      companyName: lead.companyName,
    };
    const c: ClientCtx = {
      name: lead.client.name,
      industry: lead.client.industry,
      icp:
        lead.client.icp && typeof lead.client.icp === "object"
          ? (lead.client.icp as Record<string, unknown>)
          : null,
    };

    const tag = `[${t.score}${t.isHot ? "🔥" : ""}${t.isCombo ? "✨" : ""}] ${t.companyName}`;

    // Pitch
    if (!only || only === "pitch") {
      if (!force && isCacheFresh(lead.pitchGeneratedAt) && lead.pitchJson) {
        console.log(`  ⏭  ${tag} pitch (cache fresh)`);
        pitchSkip++;
      } else {
        try {
          if (!dryRun) {
            const pitch = await callOpus(buildPitchPrompt(t, l, c));
            await db.lead.update({
              where: { id: lead.id },
              data: { pitchJson: pitch as Prisma.InputJsonValue, pitchGeneratedAt: new Date() },
            });
          }
          console.log(`  ✅ ${tag} pitch generated`);
          pitchGen++;
        } catch (e) {
          console.log(`  ❌ ${tag} pitch error: ${(e as Error).message}`);
          errors++;
        }
      }
    }

    // LinkedIn DM
    if (!only || only === "dm") {
      if (!force && isCacheFresh(lead.linkedinDmGeneratedAt) && lead.linkedinDmJson) {
        console.log(`  ⏭  ${tag} dm (cache fresh)`);
        dmSkip++;
      } else {
        try {
          if (!dryRun) {
            const dm = await callOpus(buildDmPrompt(t, l, c));
            await db.lead.update({
              where: { id: lead.id },
              data: { linkedinDmJson: dm as Prisma.InputJsonValue, linkedinDmGeneratedAt: new Date() },
            });
          }
          console.log(`  ✅ ${tag} dm generated`);
          dmGen++;
        } catch (e) {
          console.log(`  ❌ ${tag} dm error: ${(e as Error).message}`);
          errors++;
        }
      }
    }

    // Call brief
    if (!only || only === "brief") {
      if (!force && isCacheFresh(lead.callBriefGeneratedAt) && lead.callBriefJson) {
        console.log(`  ⏭  ${tag} brief (cache fresh)`);
        briefSkip++;
      } else {
        try {
          if (!dryRun) {
            const brief = await callOpus(buildBriefPrompt(t, l, c));
            await db.lead.update({
              where: { id: lead.id },
              data: { callBriefJson: brief as Prisma.InputJsonValue, callBriefGeneratedAt: new Date() },
            });
          }
          console.log(`  ✅ ${tag} brief generated`);
          briefGen++;
        } catch (e) {
          console.log(`  ❌ ${tag} brief error: ${(e as Error).message}`);
          errors++;
        }
      }
    }
  }

  console.log("---");
  console.log(`Pitches: ${pitchGen} generated, ${pitchSkip} skipped (cache)`);
  console.log(`DMs:     ${dmGen} generated, ${dmSkip} skipped (cache)`);
  console.log(`Briefs:  ${briefGen} generated, ${briefSkip} skipped (cache)`);
  console.log(`Errors:  ${errors}`);
  if (dryRun) console.log("(DRY RUN — aucun update DB)");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
