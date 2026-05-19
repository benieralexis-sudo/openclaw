import "server-only";

/**
 * Poller GitHub Commits (Bombora FR pivot — 18/05/2026, Jour 8).
 *
 * GitHub Search Commits API : recherche les commits publics récents
 * mentionnant les mots-clés du topic client. Signal d'achat d'**adoption
 * technique** : quand une boîte commit du code "integrate-docusign" ou
 * "yousign-webhook", elle est littéralement en train d'intégrer la solution.
 *
 * Source : https://api.github.com/search/commits (publique, sans auth).
 * Rate limit anonyme : 30 req/min (suffit pour 5 batches de keywords).
 *
 * Mapping signal catalogue :
 *   - sourceCode = "github.commit" → signal P3 (Intent d'achat)
 *
 * Stratégie :
 *   - Lookback 30j (les commits anciens ne sont plus actionnables)
 *   - Filtre FR best-effort : message contenant accents français OU
 *     mots français OU repo.owner suggérant une boîte FR
 *   - Batches de 5-7 keywords par requête (limite GitHub 256 chars/query)
 *
 * Idempotence : sourceUrl = "github:<owner>/<repo>@<sha>" unique par commit.
 *
 * Sans PAT GitHub :
 *   - Rate limit 30 req/min, 60 req/h pour /search/* spécifiquement
 *   - Suffit pour 1 client × 5 batches keywords × 1 poll/heure
 *   - Si volume client augmente : configurer GITHUB_TOKEN dans env
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { attributeSirene } from "@/lib/pappers";
import { isSignalEnabled, getSignalConfig } from "@/lib/signal-config";

const GITHUB_SEARCH_COMMITS = "https://api.github.com/search/commits";

// Mots-clés par défaut si non configuré (focus tech/signature)
const DEFAULT_KEYWORDS = ["docusign", "yousign", "universign"];

// Indicateurs simples de provenance FR dans un commit message ou repo name.
// On accepte si UN seul match — c'est best effort, le filtre dur viendra
// plus tard de la résolution SIRENE.
//
// IMPORTANT : on évite les mots transversaux EN/FR (integration, configuration)
// qui généreraient trop de faux positifs sur des repos US. Les mots avec
// accent sont déjà matchés par la première regex.
//
// Audit Jour 14 Bombora FR (19/05/2026) : analyse de 100 commits réels →
// 88 skipped, dont 1 seul faux négatif ("RGPD compliance"). Le filtre a
// donc ~98% de précision. Petite extension : mots réglementaires
// uniquement-FR + email committer @*.fr. Pas d'extension agressive pour
// préserver la précision.
const FR_HINTS = [
  /[éèêëàâîïôöûüç]/i, // accents français (partagé avec PT/ES — filtre exclusion ensuite)
  /\b(ajout|correction|maj|mise\sa\sjour|francais|france)\b/i,
  /\bfr\b/i,
  // Réglementaire FR uniquement (zéro ambiguïté EN)
  /\b(RGPD|SIRET|SIREN|INPI|INSEE|URSSAF|CNIL|FINESS|RNIPP|TVA|URSSAF)\b/i,
];

// Exclusion : mots/tournures caractéristiques portugais ou espagnol qui
// partagent les accents avec le français. Si match → on rejette même si
// FR_HINTS a matché. Première itération du filtre, à affiner.
const NOT_FR_HINTS = [
  // Portugais (markers distinctifs : ã, õ, ção, mots typiques)
  /[ãõ]/i,
  /\b(não|são|ção|também|português|brasil|notário|amnésia|inteligência)\b/i,
  // Espagnol (mots typiques sans accents partagés)
  /\b(generador|usuario|según|contratos\s+con|este|este\s+es|fechas|según)\b/i,
  /\b(ñ)\b/i, // bien que rare, ñ est espagnol pur
  /[ñ]/, // ñ distinctif espagnol
];

export interface GithubPollerResult {
  clientId: string;
  itemsFetched: number;
  candidatesProcessed: number;
  candidatesSkippedNotFrench: number;
  triggersCreated: number;
  triggersSkippedDup: number;
  errors: string[];
}

interface GithubCommitItem {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; email?: string; date?: string };
  };
  repository: {
    name: string;
    full_name: string;
    html_url: string;
    owner: { login: string; html_url: string };
  };
}

interface GithubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GithubCommitItem[];
}

async function getKeywordsForClient(clientId: string): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P3");
  const params = cfg.parameters as {
    githubKeywords?: unknown;
    boampKeywords?: unknown;
  };
  // Priorité : githubKeywords > boampKeywords (réutilise les BOAMP keywords
  // si pas de config dédiée GitHub — économie d'effort de config)
  const fromGithub = Array.isArray(params.githubKeywords)
    ? (params.githubKeywords as unknown[]).filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  if (fromGithub.length > 0) return fromGithub;
  const fromBoamp = Array.isArray(params.boampKeywords)
    ? (params.boampKeywords as unknown[]).filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  if (fromBoamp.length > 0) {
    // GitHub : on garde seulement les mots-clés qui font sens en code
    // (noms de produits/SDK, pas concepts juridiques). Heuristique :
    // les mots-clés sans espace ET sans accent sont OK pour GitHub.
    return fromBoamp.filter((k) => !/\s/.test(k) && !/[éèêàâîôûç]/i.test(k));
  }
  return DEFAULT_KEYWORDS;
}

/**
 * Détecte si un commit message ou un repo name a des indices FR.
 * Double filtre :
 *   1. Au moins un FR_HINTS match OU email committer @*.fr / @*.gouv.fr
 *   2. Aucun NOT_FR_HINTS match (évite faux positifs portugais/espagnol)
 */
function looksFrench(
  commitMessage: string,
  repoFullName: string,
  authorEmail?: string,
): boolean {
  const sample = `${commitMessage} ${repoFullName}`;
  if (NOT_FR_HINTS.some((re) => re.test(sample))) return false;
  if (FR_HINTS.some((re) => re.test(sample))) return true;
  // Fallback : email committer @*.fr (zéro ambiguïté — un .fr = entité FR).
  // Audit Jour 14 : 0/88 skipped avaient un email .fr aujourd'hui, mais
  // le coût est nul et le filet utile pour les rares cas futurs.
  if (authorEmail && /@[A-Za-z0-9.-]+\.fr$/i.test(authorEmail)) return true;
  return false;
}

/**
 * Découpe une liste de keywords en batches de N (GitHub limite ~256 chars/query).
 */
function chunkKeywords(keywords: string[], size = 5): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < keywords.length; i += size) {
    out.push(keywords.slice(i, i + size));
  }
  return out;
}

/**
 * Construit la query GitHub : "kw1 OR kw2 OR kw3 committer-date:>YYYY-MM-DD"
 */
function buildGithubQuery(keywords: string[], sinceDate: string): string {
  const orPart = keywords.map((k) => `"${k}"`).join(" OR ");
  return `${orPart} committer-date:>${sinceDate}`;
}

async function fetchCommitsBatch(
  keywords: string[],
  sinceDate: string,
  perPage: number,
): Promise<GithubCommitItem[]> {
  const q = buildGithubQuery(keywords, sinceDate);
  const url = new URL(GITHUB_SEARCH_COMMITS);
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("sort", "committer-date");
  url.searchParams.set("order", "desc");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "iFIND-TriggerEngine/1.0",
  };
  // Si GITHUB_TOKEN dispo, on l'utilise (5000 req/h au lieu de 60)
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 403) {
    throw new Error("GitHub rate limit exceeded (403)");
  }
  if (!response.ok) {
    throw new Error(`GitHub HTTP ${response.status}`);
  }
  const data = (await response.json()) as GithubSearchResponse;
  return data.items ?? [];
}

export async function pollGithubForClient(
  clientId: string,
  opts: { lookbackDays?: number; perBatch?: number } = {},
): Promise<GithubPollerResult> {
  const result: GithubPollerResult = {
    clientId,
    itemsFetched: 0,
    candidatesProcessed: 0,
    candidatesSkippedNotFrench: 0,
    triggersCreated: 0,
    triggersSkippedDup: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true, deletedAt: true },
  });
  // Bombora FR 19/05/2026 (Jour 14) — accepter PROSPECT pour aligner sur
  // les autres pollers signature (RSS, FT, TED, Apify-signature).
  if (
    !client ||
    client.deletedAt ||
    (client.status !== "ACTIVE" && client.status !== "PROSPECT")
  ) {
    result.errors.push(`Client ${clientId} not active/prospect or deleted`);
    return result;
  }

  // Gate sur P3 enabled (signal secondaire, pas forcément pilier)
  if (!(await isSignalEnabled(clientId, "P3"))) {
    console.log(`[github-poller] P3 not enabled for client=${clientId}, skip`);
    return result;
  }

  const keywords = await getKeywordsForClient(clientId);
  if (keywords.length === 0) {
    console.log(`[github-poller] no keywords for client=${clientId}, skip`);
    return result;
  }

  const lookbackDays = opts.lookbackDays ?? 30;
  const perBatch = opts.perBatch ?? 10;
  const sinceDate = new Date(Date.now() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const batches = chunkKeywords(keywords, 5);
  console.log(
    `[github-poller] ${clientId}: ${keywords.length} keywords in ${batches.length} batches (lookback=${lookbackDays}j)`,
  );

  for (const batch of batches) {
    let items: GithubCommitItem[] = [];
    try {
      items = await fetchCommitsBatch(batch, sinceDate, perBatch);
    } catch (e) {
      result.errors.push(
        `GitHub fetch failed for batch [${batch.join(",")}]: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Si rate limit, on s'arrête ici (pas la peine de re-tenter les batchs
      // suivants qui auront aussi 403)
      if (e instanceof Error && /rate limit/i.test(e.message)) {
        break;
      }
      continue;
    }

    result.itemsFetched += items.length;

    for (const item of items) {
      result.candidatesProcessed += 1;
      const message = item.commit?.message ?? "";
      const repoFullName = item.repository?.full_name ?? "";

      const authorEmail = item.commit?.author?.email;
      if (!looksFrench(message, repoFullName, authorEmail)) {
        result.candidatesSkippedNotFrench += 1;
        continue;
      }

      const sha = item.sha;
      const owner = item.repository?.owner?.login;
      if (!owner || !sha) continue;
      const sourceUrl = `github:${repoFullName}@${sha}`;

      // Idempotence
      const existing = await db.trigger.findFirst({
        where: { clientId, sourceCode: "github.commit", sourceUrl },
        select: { id: true },
      });
      if (existing) {
        result.triggersSkippedDup += 1;
        continue;
      }

      // Résolution SIRET via attributeSirene en best effort.
      // GitHub owner peut être :
      //   - une organisation GitHub (probablement une boîte) → chance OK
      //   - un username perso (souvent pas de boîte derrière) → skip OK
      let siren: string | null = null;
      let companyNaf: string | null = null;
      let companyNameResolved = owner;
      try {
        const sirene = await attributeSirene(owner);
        if (sirene) {
          siren = sirene.siren;
          companyNaf = sirene.code_naf ?? null;
          companyNameResolved = sirene.nom;
        }
      } catch {
        // tant pis — pas de SIRET résolu, mais on crée le Trigger quand même
        // pour traçabilité (le repo + commit reste un signal utile)
      }

      // Date du commit
      const commitDate = item.commit?.author?.date
        ? new Date(item.commit.author.date)
        : new Date();

      // Score 7 base. Boost si SIREN résolu (=vraie boîte FR identifiée).
      let score = 7;
      if (siren) score += 1;

      try {
        await db.trigger.create({
          data: {
            clientId,
            sourceCode: "github.commit",
            signalCode: "P3",
            sourceUrl,
            capturedAt: new Date(),
            publishedAt: commitDate,
            companyName: companyNameResolved.slice(0, 255),
            companySiret: siren,
            companyNaf,
            type: TriggerType.OTHER,
            title: `GitHub : ${repoFullName} — commit "${message.slice(0, 60).replace(/\n/g, " ")}"`,
            detail: [
              message.slice(0, 800),
              `Repo : ${item.repository.html_url}`,
              `Commit : ${item.html_url}`,
              item.commit?.author?.name ? `Auteur : ${item.commit.author.name}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            rawPayload: item as unknown as Prisma.InputJsonValue,
            score,
            scoreReason: `GitHub commit match keywords (${batch.slice(0, 3).join("/")}...)${siren ? ` + SIREN résolu` : ""}`,
            status: TriggerStatus.NEW,
          },
        });
        result.triggersCreated += 1;
      } catch (e) {
        result.errors.push(
          `GitHub create failed for ${sha}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  console.log(
    `[github-poller] ${clientId}: created=${result.triggersCreated} dup=${result.triggersSkippedDup} notFR=${result.candidatesSkippedNotFrench} errors=${result.errors.length}`,
  );

  return result;
}
