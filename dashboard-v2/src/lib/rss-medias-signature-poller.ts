import "server-only";

/**
 * Poller RSS médias FR filtré "signature topic" (Bombora FR — Jour 10, 19/05/2026).
 *
 * Modèle Bombora FR : on fetch des feeds RSS éditoriaux FR (Maddyness, JDN,
 * Frenchweb, l'Usine Digitale) et on garde uniquement les articles qui
 * (a) mentionnent au moins un mot-clé signature du topic dans titre+description,
 * ET (b) ont un sujet clairement client (verbe d'adoption détecté dans le titre).
 *
 * Différences clés vs rss-levees-poller :
 *   - Cherche ADOPTION / MIGRATION (pas LEVÉE de fonds)
 *   - extractClientCompanyFromTitle (vs extractCompanyName-funding)
 *   - sourceCode "rss-medias.signature" → P3 (vs rss-levees → B1)
 *   - TriggerType.OTHER (signal intent d'achat, pas funding)
 *   - Gate `isSignalEnabled(P3)` (signal Bombora secondaire)
 *
 * Mots-clés : ClientSignalConfig.parameters.signatureKeywords (futur, prioritaire)
 * puis fallback ClientSignalConfig.parameters.boampKeywords (rétro-compat
 * Digidemat Jour 6).
 *
 * Économie : 100% gratuit (RSS publics). Aucun coût compute notable.
 * Fréquence cron 1×/jour à 8h UTC (articles éditoriaux frais H+0 à H+12).
 *
 * Cohérence pipeline aval :
 *   - signal-mapping.ts ajoute `rss-medias.signature` → P3
 *   - priority-scoring.ts idem
 *   - qualify-trigger.ts : SIREN_REQUIRED gate, anti-persona — réutilise le
 *     chemin standard ; SIRET résolu inline via Pappers (pas besoin du gate
 *     d'enrichissement async).
 */

import { XMLParser } from "fast-xml-parser";
import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { attributeSirene, getEntreprise } from "@/lib/pappers";
import { isSignalEnabled, getSignalConfig } from "@/lib/signal-config";
import { hasGenericSignatureSignal } from "@/lib/signature-vendor-names";
import {
  MEDIAS_FEEDS,
  countSignatureMatchesInText,
  extractClientCompanyFromTitle,
  isVendorCompany,
} from "@/lib/rss-medias-signature-helpers";

const SOURCE_CODE = "rss-medias.signature";

// Fallback si client n'a pas configuré ses mots-clés signature. Volontairement
// vide : sans mots-clés, le poller skip (cohérent avec linkedin-signature).
const DEFAULT_KEYWORDS: string[] = [];

interface ClientIcp {
  naf_codes?: string[];
  country_codes?: string[];
  company_size_min?: number;
  company_size_max?: number;
  regions?: string[];
  antiPersonas?: string[];
}

export interface RssMediasSignaturePollerResult {
  clientId: string;
  feedStats: Array<{ feed: string; itemsFound: number; matched: number }>;
  candidatesProcessed: number;
  sireneResolved: number;
  triggersCreated: number;
  triggersSkippedNoMatch: number;
  triggersSkippedVendorOnlyMatch: number;
  triggersSkippedNoClient: number;
  triggersSkippedVendor: number;
  triggersSkippedDup: number;
  triggersSkippedIcp: number;
  triggersSkippedNoSiren: number;
  triggersSkippedAntiPersona: number;
  errors: string[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
});

function cleanText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const obj = v as { __cdata?: string; "#text"?: string };
    if (obj.__cdata) return obj.__cdata;
    if (obj["#text"]) return obj["#text"];
  }
  return String(v);
}

interface RssItem {
  title: string;
  description: string;
  link: string;
  date: string | null;
  feedName: string;
}

async function fetchFeed(feed: {
  name: string;
  url: string;
}): Promise<RssItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (iFIND TriggerEngine)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[rss-medias-signature] ${feed.name}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const rss = parsed.rss as { channel?: { item?: unknown } } | undefined;
    const atomFeed = parsed.feed as { entry?: unknown } | undefined;
    // RSS 1.0 / RDF (ex: Le Monde Informatique) : <rdf:RDF><item>…</item></rdf:RDF>
    const rdf = parsed["rdf:RDF"] as { item?: unknown } | undefined;
    const itemsRaw =
      rss?.channel?.item ?? atomFeed?.entry ?? rdf?.item ?? [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
    return items.map((rawItem) => {
      const item = rawItem as Record<string, unknown>;
      const title = cleanText(item.title);
      const description = cleanText(
        item.description ??
          item.summary ??
          item.content ??
          item["content:encoded"],
      );
      const linkRaw = item.link as
        | string
        | { "@_href"?: string }
        | undefined;
      const link =
        typeof linkRaw === "string"
          ? linkRaw
          : (linkRaw?.["@_href"] ?? cleanText(item.guid));
      const pubRaw =
        (item.pubDate as string) ??
        (item.published as string) ??
        (item.updated as string) ??
        (item["dc:date"] as string);
      let date: string | null = null;
      if (pubRaw) {
        const d = new Date(pubRaw);
        if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
      }
      return {
        title,
        description,
        link: link ?? "",
        date,
        feedName: feed.name,
      };
    });
  } catch (err) {
    console.warn(
      `[rss-medias-signature] ${feed.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Lit les mots-clés signature configurés pour le client. Logique identique à
 * apify-linkedin-signature-poller.getSignatureKeywords — duplication assumée
 * (chaque poller lit sa propre config sans coupler les modules).
 */
async function getSignatureKeywords(clientId: string): Promise<string[]> {
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

function matchesClientIcp(
  pappersData: {
    code_naf?: string;
    tranche_effectif?: string;
  } | null,
  companyName: string,
  icp: ClientIcp,
): { ok: boolean; reason: string } {
  if (icp.antiPersonas && icp.antiPersonas.length > 0) {
    const nameLower = companyName.toLowerCase();
    for (const anti of icp.antiPersonas) {
      if (nameLower.includes(anti.toLowerCase())) {
        return { ok: false, reason: `antiPersona-match:${anti}` };
      }
    }
  }
  if (!pappersData) return { ok: true, reason: "no-pappers-data" };

  if (icp.naf_codes && icp.naf_codes.length > 0 && pappersData.code_naf) {
    const nafNormalized = pappersData.code_naf.replace(/\./g, "");
    const allowSet = new Set(icp.naf_codes.map((n) => n.replace(/\./g, "")));
    let matches = false;
    for (const allowed of allowSet) {
      if (nafNormalized === allowed || nafNormalized.startsWith(allowed)) {
        matches = true;
        break;
      }
    }
    if (!matches)
      return { ok: false, reason: `naf-not-allowed:${pappersData.code_naf}` };
  }

  if (icp.company_size_max && pappersData.tranche_effectif) {
    const trancheToMin: Record<string, number> = {
      "00": 0,
      "01": 1,
      "02": 3,
      "03": 6,
      "11": 10,
      "12": 20,
      "21": 50,
      "22": 100,
      "31": 200,
      "32": 250,
      "41": 500,
      "42": 1000,
      "51": 2000,
      "52": 5000,
      "53": 10000,
    };
    const minEff = trancheToMin[pappersData.tranche_effectif];
    if (minEff !== undefined && minEff > icp.company_size_max * 5) {
      return {
        ok: false,
        reason: `effectif-too-large:${pappersData.tranche_effectif}`,
      };
    }
  }

  return { ok: true, reason: "match" };
}

export async function pollRssMediasSignatureForClient(
  clientId: string,
  opts: { dryRun?: boolean } = {},
): Promise<RssMediasSignaturePollerResult> {
  const result: RssMediasSignaturePollerResult = {
    clientId,
    feedStats: [],
    candidatesProcessed: 0,
    sireneResolved: 0,
    triggersCreated: 0,
    triggersSkippedNoMatch: 0,
    triggersSkippedVendorOnlyMatch: 0,
    triggersSkippedNoClient: 0,
    triggersSkippedVendor: 0,
    triggersSkippedDup: 0,
    triggersSkippedIcp: 0,
    triggersSkippedNoSiren: 0,
    triggersSkippedAntiPersona: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true, deletedAt: true, icp: true },
  });
  if (
    !client ||
    client.deletedAt ||
    (client.status !== "ACTIVE" && client.status !== "PROSPECT")
  ) {
    result.errors.push(`Client ${clientId} not active or deleted`);
    return result;
  }

  // Gate Bombora FR sur P3 (cohérent BOAMP + linkedin-signature).
  if (!(await isSignalEnabled(clientId, "P3"))) {
    console.log(
      `[rss-medias-signature-poller] P3 not enabled for client=${clientId}, skip`,
    );
    return result;
  }

  const keywords = await getSignatureKeywords(clientId);
  if (keywords.length === 0) {
    console.log(
      `[rss-medias-signature-poller] no signature keywords for client=${clientId}, skip`,
    );
    return result;
  }

  const icp = (client.icp as ClientIcp | null) ?? {};
  if (
    icp.country_codes &&
    icp.country_codes.length > 0 &&
    !icp.country_codes.includes("FR")
  ) {
    result.errors.push(
      `Client ${clientId} country_codes=${JSON.stringify(icp.country_codes)} excludes FR`,
    );
    return result;
  }

  for (const feed of MEDIAS_FEEDS) {
    console.log(
      `[rss-medias-signature-poller] ${clientId}: fetching ${feed.name}`,
    );
    const items = await fetchFeed(feed);
    let matched = 0;

    for (const item of items) {
      if (!item.title) continue;

      // Freshness 30j (les actus éditoriales perdent leur valeur signal après ~30j).
      if (item.date) {
        const ageDays =
          (Date.now() - new Date(item.date).getTime()) / 86_400_000;
        if (ageDays > 30) continue;
      }

      // (1) Filtre keywords présents dans titre OU description.
      const fullText = `${item.title} ${item.description}`;
      const matches = countSignatureMatchesInText(fullText, keywords);
      if (matches.count === 0) {
        result.triggersSkippedNoMatch += 1;
        continue;
      }
      // Jour 14 Sujet 10 — skip si tous les matches sont des vendor names.
      if (!hasGenericSignatureSignal(matches.labels)) {
        console.log(
          `[rss-medias-signature.skip-vendor-only] ${item.title.slice(0, 60)}: matches=[${matches.labels.join(",")}] tous vendors, skip`,
        );
        result.triggersSkippedVendorOnlyMatch += 1;
        continue;
      }

      // (2) Extraction boîte CLIENTE — pattern adoption obligatoire.
      const companyName = extractClientCompanyFromTitle(item.title, keywords);
      if (!companyName) {
        result.triggersSkippedNoClient += 1;
        continue;
      }

      // Anti-vendeur (déjà appliqué dans extract, mais ceinture+bretelles).
      if (isVendorCompany(companyName, keywords)) {
        result.triggersSkippedVendor += 1;
        continue;
      }

      matched += 1;
      result.candidatesProcessed += 1;

      // SIRENE attribution via Pappers (cache, illimité).
      let sireneSiren: string | null = null;
      let pappersData: Awaited<ReturnType<typeof getEntreprise>> | null = null;
      try {
        const sireneHit = await attributeSirene(companyName);
        if (sireneHit?.siren) {
          sireneSiren = sireneHit.siren;
          result.sireneResolved += 1;
          try {
            pappersData = await getEntreprise(sireneSiren);
          } catch {
            // ignore detail failure
          }
        }
      } catch {
        // ignore sirene failure
      }

      // Skip si SIRENE pas résolu (sans SIRET = lead minimal = enrichissement
      // bloqué, cf. bug B15 doc rss-levees-poller).
      if (!sireneSiren) {
        result.triggersSkippedNoSiren += 1;
        console.log(
          `[rss-medias-signature-poller] ${clientId}: SKIP "${companyName}" — SIRENE non résolu`,
        );
        continue;
      }

      // ICP filter
      const icpCheck = matchesClientIcp(pappersData, companyName, icp);
      if (!icpCheck.ok) {
        if (icpCheck.reason.startsWith("antiPersona")) {
          result.triggersSkippedAntiPersona += 1;
        } else {
          result.triggersSkippedIcp += 1;
        }
        console.log(
          `[rss-medias-signature-poller.icp-reject] ${clientId}: "${companyName}" — ${icpCheck.reason}`,
        );
        continue;
      }

      // Dedup : sourceUrl unique par article. Si l'article a été re-publié ou
      // re-syndiqué, le lien diffère donc on re-crée — c'est OK (signal renforcé).
      const sourceUrl =
        item.link ||
        `rss-medias.signature:${item.feedName}:${item.title.slice(0, 60)}`;
      const existing = await db.trigger.findFirst({
        where: { clientId, sourceCode: SOURCE_CODE, sourceUrl },
        select: { id: true },
      });
      if (existing) {
        result.triggersSkippedDup += 1;
        continue;
      }

      // Dedup secondaire 90j par companyName (1 boîte qui fait la une 5×
      // dans le mois sur le même produit = 1 signal suffit).
      const since = new Date(Date.now() - 90 * 86_400_000);
      const existingByName = await db.trigger.findFirst({
        where: {
          clientId,
          sourceCode: SOURCE_CODE,
          companyName: { equals: companyName, mode: "insensitive" },
          capturedAt: { gte: since },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingByName) {
        result.triggersSkippedDup += 1;
        continue;
      }

      if (opts.dryRun) {
        result.triggersCreated += 1;
        continue;
      }

      // Score : 7 base, +1 si ≥2 keywords, +1 si ≥3 (cap 9).
      let score = 7;
      if (matches.count >= 2) score += 1;
      if (matches.count >= 3) score += 1;
      const labelsStr = matches.labels.slice(0, 5).join(", ");

      try {
        const created = await db.trigger.create({
          data: {
            clientId,
            sourceCode: SOURCE_CODE,
            signalCode: "P3",
            sourceUrl,
            capturedAt: new Date(),
            publishedAt: item.date ? new Date(item.date) : new Date(),
            companyName,
            companySiret: sireneSiren,
            companyNaf: pappersData?.code_naf ?? null,
            type: TriggerType.OTHER,
            title: `Article ${item.feedName}: ${companyName} adopte/déploie "${labelsStr}"`,
            detail:
              item.title +
              (item.description ? `\n\n${item.description.slice(0, 800)}` : ""),
            rawPayload: {
              feed: item.feedName,
              title: item.title,
              description: item.description?.slice(0, 1000),
              link: item.link,
              pubDate: item.date,
              matches,
            } as Prisma.InputJsonValue,
            score,
            scoreReason: `RSS médias ${item.feedName} — adoption ${companyName} (${matches.count} keyword(s): ${labelsStr})`,
            isHot: score >= 9,
            status: TriggerStatus.NEW,
          },
        });
        result.triggersCreated += 1;
        console.log(
          `[rss-medias-signature-poller] created trigger ${created.id} ${companyName} (siren=${sireneSiren})`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`${companyName}: ${msg.slice(0, 150)}`);
        console.warn(
          `[rss-medias-signature-poller] failed create ${companyName}: ${msg}`,
        );
      }
    }

    result.feedStats.push({
      feed: feed.name,
      itemsFound: items.length,
      matched,
    });
  }

  console.log(
    `[rss-medias-signature-poller] ${clientId}: items=${result.feedStats.reduce(
      (n, f) => n + f.itemsFound,
      0,
    )} created=${result.triggersCreated} no-match=${result.triggersSkippedNoMatch} no-client=${result.triggersSkippedNoClient} vendor=${result.triggersSkippedVendor} dup=${result.triggersSkippedDup} no-siren=${result.triggersSkippedNoSiren} icp=${result.triggersSkippedIcp} anti=${result.triggersSkippedAntiPersona}`,
  );

  return result;
}
