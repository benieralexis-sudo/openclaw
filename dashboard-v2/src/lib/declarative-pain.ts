// @ts-nocheck — Module DÉSACTIVÉ (audit 16/05/2026). Le throw new Error() en tête
// de detectDeclarativePainForClient rend le code suivant unreachable, mais TS continue
// à type-checker ces branches. @ts-nocheck est OK ici puisque le code n'est plus exécuté.
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
// Patches sécurité 30/04 (audit billing Apify : $18.83/$29 brûlés en 4j sur 9416 posts) :
//  - MAX_COMPANIES_PER_RUN : 50 → 20 (×0.4)
//  - POSTS_PER_COMPANY : 5 → 3 (×0.6)
//  - Dedup TTL 14j via Trigger.declarativePainScannedAt
//  - Gate score >= 7 (Pépites only, plus de Qualifiés 6)
//  Conso prédite : ~20 boîtes × 3 posts × 1 run/h × 24h = 1440 max théoriques,
//  mais dedup 14j → ~6 posts/jour réels = $0.36/mois (vs $18 avant).
const MAX_COMPANIES_PER_RUN = 20;
const POSTS_PER_COMPANY = 3;
const SCORE_GATE = 7;
const TTL_DAYS = 14;

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
  throw new Error(
    "declarative-pain DISABLED (audit 16/05). Bug structurel : Lead.linkedinUrl = profil " +
      "persona pas company page → 0 pain détecté sur 51 scans. Fix companyLinkedinUrl avant réactivation.",
  );
  const limit = Math.min(options.limit ?? MAX_COMPANIES_PER_RUN, MAX_COMPANIES_PER_RUN);
  const result: DeclarativePainResult = {
    scanned: 0,
    postsAnalyzed: 0,
    painDetected: 0,
    triggersBoostedScore: 0,
    errors: 0,
  };

  // Sélection (patches 30/04) : Triggers Pépites (score >= 7) avec linkedinUrl
  // entreprise + dedup TTL 14j via declarativePainScannedAt.
  const ttlAgo = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      score: { gte: SCORE_GATE },
      OR: [
        { declarativePainScannedAt: null },
        { declarativePainScannedAt: { lt: ttlAgo } },
      ],
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

  // Helper local : normalise un nom/slug pour matching robuste.
  // "WeWard" → "weward", "Mister Temp Group" → "mistertempgroup",
  // "https://linkedin.com/company/Mister-Temp-Group/" → "mistertempgroup"
  const normalizeForMatch = (s: string | null | undefined): string =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");

  // Extrait le slug LinkedIn depuis une URL company.
  // "https://www.linkedin.com/company/foo-bar/" → "foo-bar"
  // "https://www.linkedin.com/company/foo-bar" → "foo-bar"
  const extractLinkedinSlug = (url: string | null | undefined): string => {
    if (!url) return "";
    const m = url.match(/linkedin\.com\/company\/([^/?#]+)/i);
    return m ? normalizeForMatch(m[1]!) : "";
  };

  // Filtre : seulement ceux avec un LinkedIn company URL exploitable.
  // On pré-calcule le slug LinkedIn et le name normalisé pour matching robuste.
  const withUrls = candidates
    .filter((c) => c.lead?.linkedinUrl)
    .map((c) => ({
      triggerId: c.id,
      companyName: c.companyName,
      companyNameNorm: normalizeForMatch(c.companyName),
      score: c.score,
      url: c.lead!.linkedinUrl!,
      slugNorm: extractLinkedinSlug(c.lead!.linkedinUrl),
    }));

  result.scanned = withUrls.length;
  if (withUrls.length === 0) return result;
  if (options.dryRun) return result;

  // Batch unique : on passe toutes les URLs en un seul run de l'actor
  // (l'actor accepte targetUrls: array)
  let posts: LinkedinPost[] = [];
  try {
    // BUGFIX 01/05 : le paramètre actor est `maxPosts` (PAS `maxPostsPerCompany`).
    // Mauvais nom détecté via Apify schema doc — l'actor ignorait notre limite
    // et scrapait toute la pagination = $20.91 facturé en avril vs $0.50 attendu.
    const { items } = await runAndGetItems<LinkedinPost>(
      ACTOR,
      {
        targetUrls: withUrls.map((c) => c.url),
        maxPosts: POSTS_PER_COMPANY,
        scrapeReactions: false,
        scrapeComments: false,
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

    // Fix C2 (04/05) — Match company → trigger ROBUSTE.
    //
    // Bug d'origine : `c.url.includes(post.authorCompanyUrl.split("/").pop())`.
    // Si authorCompanyUrl finit par "/" (cas LinkedIn canonique très courant),
    // .pop() retourne "" → `includes("")` = TRUE pour TOUTE URL → matche le
    // PREMIER candidate de la liste, pain attribué à la mauvaise boîte.
    //
    // Fix : on matche d'abord par slug LinkedIn extrait (foo-bar vs Foo-Bar),
    // sinon par companyName normalisé (post.authorCompanyName vs candidate name).
    // Pas de match → on skip (pas de fallback fuzzy qui peut introduire des bugs).
    const postSlugNorm = extractLinkedinSlug(post.authorCompanyUrl);
    const postNameNorm = normalizeForMatch(post.authorCompanyName);
    let candidate: typeof withUrls[number] | undefined;
    if (postSlugNorm) {
      candidate = withUrls.find((c) => c.slugNorm && c.slugNorm === postSlugNorm);
    }
    if (!candidate && postNameNorm) {
      // Fallback : match par companyName (les 2 normalisés doivent être égaux
      // OU l'un contient l'autre, pour gérer "WeWard" vs "WeWard SAS")
      candidate = withUrls.find(
        (c) =>
          c.companyNameNorm &&
          (c.companyNameNorm === postNameNorm ||
            (c.companyNameNorm.length >= 4 && postNameNorm.includes(c.companyNameNorm)) ||
            (postNameNorm.length >= 4 && c.companyNameNorm.includes(postNameNorm))),
      );
    }
    if (!candidate) {
      console.log(
        `[declarative-pain.C2] no match for post company="${post.authorCompanyName}" url=${post.authorCompanyUrl}`,
      );
      continue;
    }

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

  // Marque tous les triggers candidats comme "scannés" (TTL 14j) — y compris
  // ceux où aucun pain n'a été détecté, pour éviter de les re-scraper avant
  // 14j (économie Apify confirmée).
  const scannedAt = new Date();
  for (const c of withUrls) {
    try {
      await db.trigger.update({
        where: { id: c.triggerId },
        data: { declarativePainScannedAt: scannedAt },
      });
    } catch {
      // best effort
    }
  }

  return result;
}
