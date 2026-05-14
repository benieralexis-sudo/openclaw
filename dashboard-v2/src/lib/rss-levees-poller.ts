import "server-only";

/**
 * Sprint 1 (10/05/2026) — Poller RSS-levées pour dashboard-v2.
 *
 * Migration du bot trigger-engine (skills/trigger-engine/sources/rss-levees.js)
 * vers l'architecture dashboard-v2 (Prisma Trigger, multi-tenant clean).
 *
 * Stratégie :
 *   1. Fetch les 2 feeds RSS (Maddyness + Frenchweb)
 *   2. Filtre <14j + pattern funding match
 *   3. Pour chaque candidat : extract companyName + resolve SIRENE Pappers
 *   4. ICP filter (NAF whitelist client + antiPersonas)
 *   5. Create Trigger Prisma sourceCode='rss-levees'
 *
 * Idempotence : index unique (clientId, sourceCode, sourceUrl) → skip si déjà capté.
 *
 * À lancer en cron toutes les 1-2h (RSS publié H+0 à H+2 max après annonce).
 */

import { XMLParser } from "fast-xml-parser";
import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { attributeSirene, getEntreprise } from "@/lib/pappers";
import { markLeadEnrichedFromPappers } from "@/lib/lead-enrichment-tagging";
import {
  RSS_FEEDS,
  looksLikeFunding,
  extractCompanyName,
  isPlausibleCompanyName,
  extractAmount,
  detectFundingType,
} from "@/lib/rss-levees-helpers";

interface ClientIcp {
  naf_codes?: string[];
  country_codes?: string[];
  company_size_min?: number;
  company_size_max?: number;
  regions?: string[];
  antiPersonas?: string[];
}

export interface RssLeveesPollerResult {
  clientId: string;
  feedStats: Array<{ feed: string; itemsFound: number; fundingDetected: number }>;
  candidatesProcessed: number;
  sireneResolved: number;
  triggersCreated: number;
  triggersSkippedDup: number;
  triggersSkippedIcp: number;
  triggersSkippedNoCompany: number;
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

async function fetchFeed(
  feed: { name: string; url: string },
): Promise<RssItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (iFIND TriggerEngine)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[rss-levees] ${feed.name}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const rss = parsed.rss as { channel?: { item?: unknown } } | undefined;
    const atomFeed = parsed.feed as { entry?: unknown } | undefined;
    const itemsRaw = rss?.channel?.item ?? atomFeed?.entry ?? [];
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
      `[rss-levees] ${feed.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Vérifie qu'une entreprise (SIREN + Pappers data) match l'ICP du client.
 * Retourne { ok, reason } pour traçabilité.
 */
function matchesClientIcp(
  pappersData: {
    code_naf?: string;
    tranche_effectif?: string;
    siege?: { region?: string; code_postal?: string };
  } | null,
  companyName: string,
  icp: ClientIcp,
): { ok: boolean; reason: string } {
  // anti-personas (sur companyName)
  if (icp.antiPersonas && icp.antiPersonas.length > 0) {
    const nameLower = companyName.toLowerCase();
    for (const anti of icp.antiPersonas) {
      if (nameLower.includes(anti.toLowerCase())) {
        return { ok: false, reason: `antiPersona-match:${anti}` };
      }
    }
  }

  // Si pas de data Pappers, on accepte (sera filtré par le brain plus tard)
  if (!pappersData) return { ok: true, reason: "no-pappers-data" };

  // NAF check : icp.naf_codes au format "5829A" (sans point), Pappers "58.29A"
  if (icp.naf_codes && icp.naf_codes.length > 0 && pappersData.code_naf) {
    const nafNormalized = pappersData.code_naf.replace(/\./g, "");
    const allowSet = new Set(icp.naf_codes.map((n) => n.replace(/\./g, "")));
    // Match exact OR préfixe (5829 matche 5829A, 5829B, 5829C)
    let matches = false;
    for (const allowed of allowSet) {
      if (nafNormalized === allowed || nafNormalized.startsWith(allowed)) {
        matches = true;
        break;
      }
    }
    if (!matches) return { ok: false, reason: `naf-not-allowed:${pappersData.code_naf}` };
  }

  // Effectif : icp.company_size_min/max + tranche_effectif Pappers
  // Format Pappers tranche_effectif : "00" (0), "01" (1-2), "02" (3-5), "03" (6-9),
  // "11" (10-19), "12" (20-49), "21" (50-99), "22" (100-199), "31" (200-249),
  // "32" (250-499), "41" (500-999), "42" (1000-1999), "51" (2000-4999), "52" (5000-9999), "53" (10000+)
  if (icp.company_size_max && pappersData.tranche_effectif) {
    const trancheToMin: Record<string, number> = {
      "00": 0, "01": 1, "02": 3, "03": 6, "11": 10, "12": 20, "21": 50,
      "22": 100, "31": 200, "32": 250, "41": 500, "42": 1000, "51": 2000,
      "52": 5000, "53": 10000,
    };
    const minEff = trancheToMin[pappersData.tranche_effectif];
    if (minEff !== undefined && minEff > icp.company_size_max * 5) {
      // Tolérance ×5 (un effectif >5×max = vraiment hors ICP, sinon downgrade only)
      return { ok: false, reason: `effectif-too-large:${pappersData.tranche_effectif}` };
    }
  }

  return { ok: true, reason: "match" };
}

export async function pollRssLeveesForClient(
  clientId: string,
): Promise<RssLeveesPollerResult> {
  const result: RssLeveesPollerResult = {
    clientId,
    feedStats: [],
    candidatesProcessed: 0,
    sireneResolved: 0,
    triggersCreated: 0,
    triggersSkippedDup: 0,
    triggersSkippedIcp: 0,
    triggersSkippedNoCompany: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, icp: true, status: true, deletedAt: true },
  });
  if (!client || client.deletedAt || client.status !== "ACTIVE") {
    result.errors.push(`Client ${clientId} not active or deleted`);
    return result;
  }
  const icp = (client.icp as ClientIcp | null) ?? {};

  // Limite FR : si client.icp.country_codes existe et ne contient pas "FR", skip
  if (icp.country_codes && icp.country_codes.length > 0 && !icp.country_codes.includes("FR")) {
    result.errors.push(`Client ${clientId} country_codes=${JSON.stringify(icp.country_codes)} excludes FR`);
    return result;
  }

  for (const feed of RSS_FEEDS) {
    console.log(`[rss-levees-poller] ${clientId}: fetching ${feed.name}`);
    const items = await fetchFeed(feed);
    let fundingDetected = 0;

    for (const item of items) {
      if (!item.title) continue;

      // Filter freshness ICP-aware (12/05/2026) — Aligné sur ICP DTL
      // freshnessByTrigger.levee : minDays=15, maxDays=120. Fred ne veut PAS
      // approcher J0-J14 (trop tôt = sollicitations en masse) et J+120+ (signal
      // périmé). Avant : `ageDays > 14 continue` capturait J0-J14 et jetait
      // ensuite J+15+ — exactement l'inverse de l'ICP. Maintenant : on capte
      // J+0 à J+120 (le brain V2 gate min freshness applique l'ICP par client).
      if (item.date) {
        const ageDays = (Date.now() - new Date(item.date).getTime()) / 86_400_000;
        if (ageDays > 120) continue;
      }

      if (!looksLikeFunding(item.title, item.description)) continue;

      const companyName = extractCompanyName(item.title);
      if (!companyName) {
        result.triggersSkippedNoCompany += 1;
        continue;
      }

      fundingDetected += 1;
      result.candidatesProcessed += 1;

      // Resolve SIRENE via Pappers (cache 1h, forfait illimité)
      let sireneSiren: string | null = null;
      let pappersData: Awaited<ReturnType<typeof getEntreprise>> | null = null;
      try {
        const sireneHit = await attributeSirene(companyName);
        if (sireneHit?.siren) {
          sireneSiren = sireneHit.siren;
          result.sireneResolved += 1;
          // Pour ICP filter : on a besoin de NAF + tranche_effectif
          try {
            pappersData = await getEntreprise(sireneSiren);
          } catch {
            // ignore pappers detail failure, on continue avec siren only
          }
        }
      } catch (e) {
        // ignore sirene failure, on continue avec extraction title only
      }

      // Validation companyName si SIRENE pas résolu (anti "Les", "Chine", etc.)
      if (!sireneSiren && !isPlausibleCompanyName(companyName, false)) {
        result.triggersSkippedNoCompany += 1;
        continue;
      }

      // Bug B15 fix (Session 3, 10/05/2026) — Skip création Trigger si
      // SIRENE non résolu. Avant : on créait le Trigger quand même avec
      // companySiret=null → Lead minimal sans SIRET → enrichissement
      // (Pappers, Kaspr, HarvestAPI search-by-company) tous bloqués →
      // leads vides depuis 7j (SEREACT, CLEO LABS, MOONLIGHT AI).
      // Maintenant : on skip et on log pour audit. La levée pourra être
      // re-captée par BODACC capital-increase, ou rss-levees au prochain
      // run si SIRENE indexe entre temps (PME jeunes).
      if (!sireneSiren) {
        result.triggersSkippedNoCompany += 1;
        console.log(
          `[rss-levees-poller] ${clientId}: SKIP "${companyName}" — SIRENE non résolu (boîte trop récente Insee ou nom ambigu). Re-tenté au prochain run.`,
        );
        continue;
      }

      // ICP filter
      const icpCheck = matchesClientIcp(pappersData, companyName, icp);
      if (!icpCheck.ok) {
        result.triggersSkippedIcp += 1;
        console.log(
          `[rss-levees-poller.icp-reject] ${clientId}: "${companyName}" (naf=${pappersData?.code_naf ?? "?"} eff=${pappersData?.tranche_effectif ?? "?"}) — ${icpCheck.reason}`,
        );
        continue;
      }

      // Compute base score : levée fraîche <14j = signal fort
      // Bot original : pattern funding-recent score=7
      // On suit la même base, le judge V1/V2 ajustera ensuite
      const fullText = `${item.title} ${item.description}`;
      const fundingType = detectFundingType(fullText);
      const amount = extractAmount(fullText);

      const sourceUrl = item.link || `rss-levees:${item.feedName}:${item.title.slice(0, 60)}`;

      // Idempotence : skip si déjà créé
      const existing = await db.trigger.findFirst({
        where: { clientId, sourceCode: "rss-levees", sourceUrl },
        select: { id: true },
      });
      if (existing) {
        result.triggersSkippedDup += 1;
        continue;
      }

      try {
        const created = await db.trigger.create({
          data: {
            clientId,
            sourceCode: "rss-levees",
            sourceUrl,
            capturedAt: new Date(),
            publishedAt: item.date ? new Date(item.date) : new Date(),
            companyName,
            companySiret: sireneSiren ?? null,
            companyNaf: pappersData?.code_naf ?? null,
            type: TriggerType.FUNDRAISING,
            title: `Levée de fonds détectée — ${companyName}`,
            detail: item.title + (item.description ? `\n\n${item.description.slice(0, 800)}` : ""),
            rawPayload: {
              feed: item.feedName,
              title: item.title,
              description: item.description?.slice(0, 1000),
              link: item.link,
              pubDate: item.date,
              fundingType,
              amount_eur: amount,
            } as Prisma.InputJsonValue,
            score: 7, // base levée, judge ajustera
            scoreReason: `RSS-levées ${item.feedName} <14j (${fundingType}${amount ? `, ${(amount / 1_000_000).toFixed(1)}M€` : ""})`,
            status: TriggerStatus.NEW,
          },
        });
        result.triggersCreated += 1;
        console.log(
          `[rss-levees-poller] created trigger ${created.id} ${companyName} (siren=${sireneSiren ?? "?"})`,
        );

        // Si on a Pappers data, marquer le Lead comme enriched (helper P1)
        if (pappersData && sireneSiren) {
          // Le Lead n'existe pas encore (créé par ensure-lead-for-trigger plus tard),
          // donc on ne tag pas ici. Le tag se fera quand le Lead sera créé.
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`${companyName}: ${msg.slice(0, 150)}`);
        console.warn(`[rss-levees-poller] failed create ${companyName}: ${msg}`);
      }
    }

    result.feedStats.push({
      feed: feed.name,
      itemsFound: items.length,
      fundingDetected,
    });
  }

  console.log(
    `[rss-levees-poller] ${clientId}: ${result.triggersCreated} created, ${result.triggersSkippedDup} dup, ${result.triggersSkippedIcp} icp-filter, ${result.triggersSkippedNoCompany} no-company, ${result.errors.length} errors`,
  );

  // Suppress unused warning — markLeadEnrichedFromPappers utilisé dans futur sprint
  void markLeadEnrichedFromPappers;

  return result;
}
