import "server-only";

/**
 * Poller LinkedIn Jobs filtré "signature topic" (Bombora FR — Jour 9, 19/05/2026).
 *
 * Modèle Bombora FR : on cherche des jobs LinkedIn par mots-clés PRODUIT
 * (ex "signature électronique", "Yousign") et on garde uniquement ceux dont
 * la DESCRIPTION mentionne au moins un mot-clé du topic. Un job ne ciblant pas
 * directement le produit mais qui mentionne son usage interne (ex un poste
 * "Comptable" dont la description dit "rédige contrats sur DocuSign") =
 * signal P3 fort : la boîte UTILISE ou CHERCHE à utiliser le produit.
 *
 * Différences clés vs apify-poller.ts (P1 hiring) :
 *   - Query LARGE par mot-clé produit (vs job title client)
 *   - Filtre côté code sur DESCRIPTION (vs TITLE)
 *   - Pas de filtre taille `f_F=B,C` (toutes tailles d'entreprise)
 *   - sourceCode "apify.linkedin-jobs-signature" → P3 (vs P1)
 *   - TriggerType.OTHER (vs HIRING_KEY) — c'est un signal d'achat pas d'embauche
 *   - Gate `isSignalEnabled(P3)` (signal secondaire Bombora, pas pilier strict)
 *
 * Mots-clés : ClientSignalConfig.parameters.signatureKeywords (futur, prioritaire)
 * puis fallback ClientSignalConfig.parameters.boampKeywords (réutilise les
 * mots-clés signature déjà configurés Jour 6 sur Digidemat).
 *
 * Économie : 1 run/jour à 8h UTC, rotation 6 mots-clés/run = 30 mots-clés
 * couverts en 5 jours. ~$45/mois par client P3 actif.
 *
 * Cohérence pipeline aval :
 *   - signal-mapping.ts ajoute `apify.linkedin-jobs-signature` → P3
 *   - priority-scoring.ts idem
 *   - qualify-trigger.ts : `startsWith("apify.linkedin-jobs")` matche déjà,
 *     donc le gate SIREN_REQUIRED + anti-persona reste cohérent
 *   - enrichRecentTriggersWithSirene résout SIRET automatiquement (générique)
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { runAndGetItems } from "@/lib/apify";
import { checkQuota, recordSpend } from "@/lib/quota-checker";
import { getRotatedKeywords } from "@/lib/keyword-rotation";
import { isSignalEnabled, getSignalConfig } from "@/lib/signal-config";
import {
  APIFY_ACTORS,
  adaptLinkedinJobItem,
  isFrenchCompany,
  type LinkedinJobItem,
} from "@/lib/apify-poller";

const SOURCE_CODE = "apify.linkedin-jobs-signature";
const APIFY_USD_PER_CU = 0.4;
const APIFY_ESTIMATE_PER_RUN_USD = 1.5;

// Fallback si le client n'a pas (encore) configuré ses mots-clés signature.
// Volontairement vide : sans mots-clés client, le poller skip — on ne veut pas
// produire du bruit sur des keywords génériques pour un client sans topic défini.
const DEFAULT_KEYWORDS: string[] = [];

interface ClientIcpExtended {
  antiPersonas?: string[];
}

export interface LinkedinSignaturePollerResult {
  clientId: string;
  keywordsTotal: number;
  keywordsRun: number;
  itemsFetched: number;
  candidatesProcessed: number;
  triggersCreated: number;
  triggersSkippedNoMatch: number;
  triggersSkippedDup: number;
  triggersSkippedNonFrench: number;
  triggersSkippedAntiPersona: number;
  triggersSkippedVendor: number;
  triggersSkippedAdapt: number;
  errors: string[];
}

/**
 * Heuristique anti-vendeur : si le nom de boîte CORRESPOND à un mot-clé
 * signature (ex companyName "DOCAPOSTE" et keyword "Docaposte"), c'est un
 * concurrent direct qui poste un job mentionnant son propre nom. Faux positif.
 *
 * Match : containment bidirectionnel sur les tokens significatifs (>=4 chars)
 * du keyword. Ex : "DOCAPOSTE" contient "docaposte" → skip. "SOFTEAM" ne
 * contient aucun keyword (just mentionne Docaposte dans description) → keep.
 */
export function isVendorCompany(
  companyName: string,
  keywords: string[],
): boolean {
  const name = companyName.toLowerCase();
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length < 4) continue;
    // 1) keyword est un nom propre simple (1 mot) : containment direct
    if (!/\s/.test(k)) {
      if (name.includes(k)) return true;
      continue;
    }
    // 2) keyword multi-mots (ex "signature électronique") : on regarde si le
    //    nom de boîte contient l'expression entière. Sinon on ne skip pas (le
    //    nom peut légitimement contenir "signature" sans être un vendeur).
    if (name.includes(k)) return true;
  }
  return false;
}

/**
 * Lit la liste de mots-clés signature configurée pour le client.
 * Priorité : signatureKeywords (futur, plus explicite) > boampKeywords
 * (rétro-compat Digidemat Jour 6) > DEFAULT (vide).
 */
export async function getSignatureKeywords(clientId: string): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P3");
  const params = cfg.parameters as {
    signatureKeywords?: unknown;
    boampKeywords?: unknown;
  };
  for (const key of ["signatureKeywords", "boampKeywords"] as const) {
    const raw = params[key];
    if (Array.isArray(raw)) {
      const list = raw.filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      );
      if (list.length > 0) return list;
    }
  }
  return DEFAULT_KEYWORDS;
}

/**
 * Construit l'URL de recherche LinkedIn Jobs pour un mot-clé.
 * Pas de filtre taille (Bombora FR : toutes tailles).
 * f_TPR=r604800 : jobs frais 7 derniers jours (cohérent avec P1).
 */
function buildLinkedinSearchUrl(keyword: string): string {
  return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
    keyword,
  )}&location=France&f_TPR=r604800`;
}

/**
 * Compte les mots-clés signature présents dans la description du job.
 * Match insensible à la casse, substring simple (pas de boundary regex car
 * les mots-clés sont souvent des noms de produits comme "DocuSign" ou des
 * expressions composées comme "signature électronique").
 */
export function countSignatureMatchesInDescription(
  description: string | undefined,
  keywords: string[],
): { count: number; labels: string[] } {
  if (!description) return { count: 0, labels: [] };
  const desc = description.toLowerCase();
  const labels: string[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length === 0) continue;
    if (desc.includes(k)) labels.push(kw);
  }
  return { count: labels.length, labels };
}

export async function pollLinkedinSignatureForClient(
  clientId: string,
  opts: { dryRun?: boolean; batchSize?: number; nowMs?: number } = {},
): Promise<LinkedinSignaturePollerResult> {
  const result: LinkedinSignaturePollerResult = {
    clientId,
    keywordsTotal: 0,
    keywordsRun: 0,
    itemsFetched: 0,
    candidatesProcessed: 0,
    triggersCreated: 0,
    triggersSkippedNoMatch: 0,
    triggersSkippedDup: 0,
    triggersSkippedNonFrench: 0,
    triggersSkippedAntiPersona: 0,
    triggersSkippedVendor: 0,
    triggersSkippedAdapt: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true, deletedAt: true, icp: true },
  });
  if (!client || client.deletedAt || (client.status !== "ACTIVE" && client.status !== "PROSPECT")) {
    result.errors.push(`Client ${clientId} not active or deleted`);
    return result;
  }

  // Bombora FR — Gate sur P3 enabled (signal secondaire). Cohérent BOAMP.
  if (!(await isSignalEnabled(clientId, "P3"))) {
    console.log(
      `[linkedin-signature-poller] P3 not enabled for client=${clientId}, skip`,
    );
    return result;
  }

  const keywords = await getSignatureKeywords(clientId);
  result.keywordsTotal = keywords.length;
  if (keywords.length === 0) {
    console.log(
      `[linkedin-signature-poller] no signature keywords for client=${clientId}, skip`,
    );
    return result;
  }

  // Rotation 6 mots-clés/run (vs 8 P1). 30 mots-clés → 5 cycles → couverture en
  // 5 jours à 1 run/jour. Coût ~$1.50/run × 30 = $45/mois.
  const batchSize = opts.batchSize ?? 6;
  const rotatedKeywords = getRotatedKeywords(keywords, {
    batchSize,
    nowMs: opts.nowMs,
  });
  result.keywordsRun = rotatedKeywords.length;
  const urls = rotatedKeywords.map(buildLinkedinSearchUrl);

  console.log(
    `[linkedin-signature-poller] ${clientId}: ${rotatedKeywords.length}/${keywords.length} keywords this run`,
  );

  // Quota Apify avant le run
  const quota = await checkQuota(clientId, "apify", APIFY_ESTIMATE_PER_RUN_USD);
  if (!quota.ok) {
    result.errors.push(`quota-blocked: ${quota.reason} (pct=${quota.pctUsed}%)`);
    console.warn(
      `[linkedin-signature-poller.quota-blocked] client=${clientId} reason=${quota.reason}`,
    );
    return result;
  }

  let rawItems: Record<string, unknown>[] = [];
  let computeUnits: number | undefined;
  try {
    const r = await runAndGetItems<Record<string, unknown>>(
      APIFY_ACTORS.linkedinJobs,
      { urls, count: 30, scrapeCompany: false },
      { itemsLimit: 200, timeout: 180 },
    );
    rawItems = r.items;
    computeUnits = r.run?.stats?.computeUnits;
  } catch (e) {
    result.errors.push(
      `Apify run failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }

  result.itemsFetched = rawItems.length;

  // Record cost réel (computeUnits) si dispo, sinon estimate
  const usdToRecord =
    computeUnits !== undefined && computeUnits > 0
      ? computeUnits * APIFY_USD_PER_CU
      : APIFY_ESTIMATE_PER_RUN_USD;
  if (usdToRecord > 0) {
    await recordSpend(clientId, "apify", usdToRecord).catch((e) =>
      console.error(
        `[linkedin-signature-poller.recordSpend] client=${clientId} failed: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  const icp = (client.icp ?? {}) as ClientIcpExtended;
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());

  for (const raw of rawItems) {
    result.candidatesProcessed += 1;
    const job = adaptLinkedinJobItem(raw as LinkedinJobItem);
    if (!job) {
      result.triggersSkippedAdapt += 1;
      continue;
    }
    if (!isFrenchCompany(job.companyName)) {
      result.triggersSkippedNonFrench += 1;
      continue;
    }
    if (
      antiCompanies.length > 0 &&
      antiCompanies.some((a) => job.companyName.toLowerCase().includes(a))
    ) {
      result.triggersSkippedAntiPersona += 1;
      continue;
    }

    // Anti-vendeur automatique : skip si la boîte qui poste est elle-même un
    // produit cité dans les keywords (DocuSign poste un job, Docaposte poste
    // un job…). Évite la majorité des faux positifs concurrents sans demander
    // au client de maintenir une liste antiPersonas manuelle.
    if (isVendorCompany(job.companyName, keywords)) {
      result.triggersSkippedVendor += 1;
      continue;
    }

    // FILTRE CENTRAL Jour 9 : description doit contenir au moins 1 mot-clé
    // signature (la spec dit explicitement "dans description, PAS titre").
    const description = job.fullDescription ?? job.description ?? "";
    const matches = countSignatureMatchesInDescription(description, keywords);
    if (matches.count === 0) {
      result.triggersSkippedNoMatch += 1;
      continue;
    }

    // Dedup 90j par companyName + sourceCode (une boîte peut poster plusieurs
    // jobs avec mots-clés → 1 trigger suffit comme signal).
    const since = new Date(Date.now() - 90 * 86_400_000);
    const existing = await db.trigger.findFirst({
      where: {
        clientId,
        sourceCode: SOURCE_CODE,
        companyName: { equals: job.companyName, mode: "insensitive" },
        capturedAt: { gte: since },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      result.triggersSkippedDup += 1;
      continue;
    }

    if (opts.dryRun) {
      result.triggersCreated += 1;
      continue;
    }

    // Score : 7 base, +1 si ≥2 mots-clés différents, +1 si ≥4 (cap 9)
    // Bornage en bas du Hot Lead pour laisser Opus juger (verdict P3 final).
    let score = 7;
    if (matches.count >= 2) score += 1;
    if (matches.count >= 4) score += 1;

    const labelsStr = matches.labels.slice(0, 5).join(", ");
    try {
      await db.trigger.create({
        data: {
          clientId,
          sourceCode: SOURCE_CODE,
          signalCode: "P3",
          sourceUrl: job.sourceUrl ?? job.url ?? null,
          capturedAt: new Date(),
          publishedAt: job.postedAt ? new Date(job.postedAt) : null,
          companyName: job.companyName,
          region: job.location ?? null,
          type: TriggerType.OTHER,
          title: `Job LinkedIn chez ${job.companyName} mentionne "${labelsStr}"`,
          detail:
            `Offre "${job.jobTitle}" mentionne ${matches.count} mot-clé(s) signature dans sa description : ${matches.labels.join(", ")}. ` +
            `Signal P3 (Intent d'achat / adoption interne). Source : LinkedIn Jobs.`,
          rawPayload: { job: raw, matches } as unknown as Prisma.InputJsonValue,
          score,
          scoreReason: `LinkedIn job description match ${matches.count} signature keyword(s): ${labelsStr}`,
          isHot: score >= 9,
          status: TriggerStatus.NEW,
        },
      });
      result.triggersCreated += 1;
    } catch (e) {
      result.errors.push(
        `Trigger create failed for ${job.companyName}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(
    `[linkedin-signature-poller] ${clientId}: items=${result.itemsFetched} created=${result.triggersCreated} no-match=${result.triggersSkippedNoMatch} dup=${result.triggersSkippedDup} non-fr=${result.triggersSkippedNonFrench} anti-persona=${result.triggersSkippedAntiPersona} vendor=${result.triggersSkippedVendor}`,
  );

  return result;
}
