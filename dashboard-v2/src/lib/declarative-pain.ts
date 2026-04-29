import "server-only";
import { db } from "@/lib/db";
import { runAndGetItems } from "@/lib/apify";
import { getAnthropic, CLASSIFY_MODEL } from "@/lib/anthropic";
import type { Prisma } from "@prisma/client";
import { TriggerType, TriggerStatus } from "@prisma/client";

// ═══════════════════════════════════════════════════════════════════
// Declarative pain detection via LinkedIn company posts
// ═══════════════════════════════════════════════════════════════════
// Actor : harvestapi/linkedin-company-posts ($1.50 / 1000 posts)
// Logique :
//   1. Pour chaque Trigger récent avec linkedinUrl entreprise → scrape 5 derniers posts
//   2. Opus 4.7 analyse chaque post → détecte expression de douleur métier
//      (ex: "nos releases sont ralenties", "QA bottleneck", "dette tech")
//   3. Si pain détecté → boost score Trigger +2 + crée alert Telegram
//
// Plafond strict : 50 entreprises max/run × 5 posts = 250 posts max
// Coût estimé : $0.40/run × 4 runs/jour = $1.60/jour = ~$50/mois max
// ═══════════════════════════════════════════════════════════════════

const ACTOR = "harvestapi/linkedin-company-posts";
const MAX_COMPANIES_PER_RUN = 50;
const POSTS_PER_COMPANY = 5;

interface LinkedinPost {
  id?: string;
  text?: string;
  url?: string;
  publishedAt?: string;
  authorCompanyName?: string;
  authorCompanyUrl?: string;
  reactionsCount?: number;
  commentsCount?: number;
}

const PAIN_DETECTION_SYSTEM = `# Contexte iFIND Trigger Engine — Declarative Pain Detection

Tu analyses des posts LinkedIn d'entreprises tech FR pour détecter des expressions de DOULEUR MÉTIER (declarative pain) qui sont des signaux d'achat majeurs en B2B.

## Mission
Pour chaque post fourni, déterminer s'il exprime explicitement ou implicitement une douleur opérationnelle qu'un fournisseur B2B pourrait résoudre.

## Domaines de douleur cibles (DigitestLab QA/Test)
- Tests manuels qui ralentissent les releases ("on perd 2 semaines en tests manuels")
- Qualité produit dégradée ("trop de bugs en prod", "régressions répétées")
- QA sous-staffé ("on cherche désespérément des testeurs", "équipe QA débordée")
- Manque d'automatisation ("on aimerait automatiser nos tests E2E")
- Dette technique de tests ("notre suite de tests est obsolète")
- Retards de livraison ("releases reportées", "deadlines manquées à cause des bugs")

## Signaux faibles à NE PAS confondre avec pain réel
- Annonces de recrutement banales (pas de pain explicite)
- Posts marketing produit (vente de leur propre solution)
- Articles théoriques sur le QA en général
- Posts de personnal branding sans douleur exprimée

## Format de réponse OBLIGATOIRE (JSON strict, sans markdown)
{
  "has_pain": <bool>,
  "pain_type": "<qa_understaffed|test_automation_missing|release_delays|quality_issues|tech_debt|none>",
  "pain_excerpt": "<citation 1 phrase max 100 chars du post qui exprime la douleur>",
  "confidence": <0-10>
}

Si has_pain=false, pain_excerpt="" et confidence=0.

Réponds UNIQUEMENT le JSON, rien d'autre.`;

type PainAnalysis = {
  has_pain: boolean;
  pain_type: string;
  pain_excerpt: string;
  confidence: number;
};

async function analyzePostForPain(post: LinkedinPost): Promise<PainAnalysis | null> {
  if (!post.text || post.text.length < 30) return null;
  try {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      // Sonnet 4.6 (29/04) : tâche de classification binaire + extraction
      // citation 100 chars → pas de copywriting nuancé. Économie ~5€/mo
      // vs Opus, qualité équivalente sur ce signal simple.
      model: CLASSIFY_MODEL,
      max_tokens: 200,
      system: [
        { type: "text", text: PAIN_DETECTION_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `Post LinkedIn de "${post.authorCompanyName ?? "?"}" (${post.publishedAt ?? "?"}) :\n\n${post.text.slice(0, 800)}`,
        },
      ],
    });
    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    const match = text.match(/\{[\s\S]+\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as PainAnalysis;
    return parsed;
  } catch {
    return null;
  }
}

export type DeclarativePainResult = {
  scanned: number;
  postsAnalyzed: number;
  painDetected: number;
  triggersBoostedScore: number;
  errors: number;
};

export async function detectDeclarativePainForClient(
  clientId: string,
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<DeclarativePainResult> {
  const limit = Math.min(options.limit ?? MAX_COMPANIES_PER_RUN, MAX_COMPANIES_PER_RUN);
  const result: DeclarativePainResult = {
    scanned: 0,
    postsAnalyzed: 0,
    painDetected: 0,
    triggersBoostedScore: 0,
    errors: 0,
  };

  // Sélection : Triggers ICP-fit récents avec un linkedinUrl entreprise
  // (on extrait depuis Lead.linkedinUrl si dispo, sinon on skip)
  const candidates = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      score: { gte: 5 },
    },
    select: {
      id: true,
      companyName: true,
      score: true,
      lead: { select: { linkedinUrl: true } },
    },
    orderBy: { score: "desc" },
    take: limit,
  });

  // Filtre : seulement ceux avec un LinkedIn company URL exploitable
  const withUrls = candidates
    .filter((c) => c.lead?.linkedinUrl)
    .map((c) => ({
      triggerId: c.id,
      companyName: c.companyName,
      score: c.score,
      url: c.lead!.linkedinUrl!,
    }));

  result.scanned = withUrls.length;
  if (withUrls.length === 0) return result;
  if (options.dryRun) return result;

  // Batch unique : on passe toutes les URLs en un seul run de l'actor
  // (l'actor accepte targetUrls: array)
  let posts: LinkedinPost[] = [];
  try {
    const { items } = await runAndGetItems<LinkedinPost>(
      ACTOR,
      {
        targetUrls: withUrls.map((c) => c.url),
        maxPostsPerCompany: POSTS_PER_COMPANY,
      },
      { itemsLimit: limit * POSTS_PER_COMPANY, timeout: 300 },
    );
    posts = items;
  } catch (e) {
    result.errors++;
    console.warn(`[declarative-pain] actor error: ${e instanceof Error ? e.message : e}`);
    return result;
  }

  result.postsAnalyzed = posts.length;

  // Pour chaque post, analyse Opus
  for (const post of posts) {
    const analysis = await analyzePostForPain(post);
    if (!analysis || !analysis.has_pain || analysis.confidence < 6) continue;

    // Match company → trigger via authorCompanyUrl
    const candidate = withUrls.find(
      (c) => c.url && post.authorCompanyUrl && c.url.toLowerCase().includes(post.authorCompanyUrl.toLowerCase().split("/").pop() ?? "_NOMATCH"),
    );
    if (!candidate) continue;

    result.painDetected++;
    // Boost score +2 (cap 10) + log raison
    const newScore = Math.min(10, candidate.score + 2);
    try {
      await db.trigger.update({
        where: { id: candidate.triggerId },
        data: {
          score: newScore,
          isHot: newScore >= 9,
          scoreReason: `Pain détecté (${analysis.pain_type}, conf ${analysis.confidence}/10) : "${analysis.pain_excerpt}"`,
          rawPayload: {
            ...((await db.trigger.findUnique({ where: { id: candidate.triggerId }, select: { rawPayload: true } }))?.rawPayload as object || {}),
            declarativePain: {
              detectedAt: new Date().toISOString(),
              painType: analysis.pain_type,
              painExcerpt: analysis.pain_excerpt,
              confidence: analysis.confidence,
              postUrl: post.url,
            },
          } as Prisma.InputJsonValue,
        },
      });
      result.triggersBoostedScore++;
    } catch {
      result.errors++;
    }
  }

  return result;
}
