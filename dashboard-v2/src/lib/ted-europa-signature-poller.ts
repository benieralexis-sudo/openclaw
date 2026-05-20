import "server-only";

/**
 * Poller TED Europa (Bombora FR — Jour 13, 19/05/2026).
 *
 * TED Europa = Tenders Electronic Daily, le bulletin officiel des marchés
 * publics européens. Source : api.ted.europa.eu/v3/notices/search (POST).
 *
 * Pourquoi TED Europa en complément de BOAMP :
 *   - BOAMP couvre les marchés publics FR aux seuils nationaux
 *   - TED publie les marchés FR au seuil européen (> ~140k€ services /
 *     ~5M€ travaux) — donc les GROS marchés (EDF, ministères, grandes
 *     collectivités) qui passent souvent UNIQUEMENT par TED
 *   - Source 100% gratuite, sans clé, API officielle UE
 *   - Test live 19/05/2026 sur 60j : 3 notices titre signature (Numih
 *     France, EDF SA, Ucanss) — volume faible mais ultra-qualifié
 *
 * Mapping signal catalogue :
 *   - sourceCode = "ted-europa.tender" → signal P3 (Intent d'achat)
 *
 * Stratégie de récupération :
 *   - Lookup mots-clés depuis ClientSignalConfig.parameters.tedKeywords
 *     pour le signal P3. Fallback : tedKeywords par défaut signature FR.
 *   - Match TITRE (notice-title ~ "kw") pour signal fort. Le full-text
 *     (FT~) génère 100×+ de bruit (clauses CGV) — écarté.
 *   - Lookback 30j par défaut.
 *
 * Idempotence : sourceUrl = "ted-europa:<publication-number>".
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { attributeSirene } from "@/lib/pappers";
import { isSignalEnabled, getSignalConfig } from "@/lib/signal-config";
import { hasGenericSignatureSignal } from "@/lib/signature-vendor-names";
// Bombora FR Jour 14 — réutilise le helper introduit dans boamp-poller pour
// nettoyer les noms d'acheteurs publics FR (suffixes administratifs +
// parenthèses code département) avant attribution SIRENE.
import { cleanBuyerName, extractFirstSignificantWord } from "@/lib/boamp-poller";

const TED_API = "https://api.ted.europa.eu/v3/notices/search";

// Mots-clés par défaut — match en TITRE seulement, vérifiés live le
// 19/05/2026 sur 90j pour ne garder QUE des keywords qui matchent réellement
// le topic signature (zéro bruit). Écartés :
//   - "eIDAS" → bug API TED v3 : matche TOUT (558 résultats au lieu de 5)
//   - "scellement" → bruit travaux routiers, sacs plastique, micro-électronique
//   - "démat" → bruit massif (titres-restaurant dématérialisés, paiement
//     dématérialisé stationnement, bons-cadeaux dématérialisés)
//   - "certificat électronique"/"signature qualifiée"/"factur-x" → 0 match
// Volume attendu : ~5 notices/90j = ~1.7/mois mais ultra-qualifié.
const DEFAULT_KEYWORDS = ["signature électronique", "parapheur", "chorus pro"];

export interface TedEuropaPollerResult {
  clientId: string;
  noticesFetched: number;
  candidatesProcessed: number;
  triggersCreated: number;
  triggersSkippedDup: number;
  triggersSkippedVendorOnlyMatch: number;
  triggersSkippedNoSiren: number;
  errors: string[];
}

interface TedNotice {
  "publication-number"?: string;
  "publication-date"?: string;
  // TED v3 : champs "single value" exposent fra comme STRING, champs
  // "multi-value" exposent fra comme ARRAY. notice-title est single,
  // organisation-name-buyer est multi (peut avoir plusieurs noms).
  "notice-title"?: { fra?: string } | string;
  "organisation-name-buyer"?: { fra?: string[] } | string[];
  "organisation-city-buyer"?: { fra?: string[] } | string[];
  "organisation-country-buyer"?: string[];
  "contract-nature"?: string[];
  links?: {
    html?: Record<string, string>;
    pdf?: Record<string, string>;
  };
}

async function getKeywordsForClient(clientId: string): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P3");
  const params = cfg.parameters as { tedKeywords?: unknown };
  const fromConfig = Array.isArray(params.tedKeywords)
    ? (params.tedKeywords as unknown[]).filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  if (fromConfig.length > 0) return fromConfig;
  return DEFAULT_KEYWORDS;
}

function buildTedQuery(keywords: string[], lookbackDays: number): string {
  const titleClauses = keywords
    .map((k) => k.replace(/"/g, '\\"'))
    .map((k) => `notice-title ~ "${k}"`)
    .join(" OR ");
  return `publication-date >= today(-${lookbackDays}) AND organisation-country-buyer = FRA AND (${titleClauses})`;
}

async function fetchTedNotices(
  keywords: string[],
  lookbackDays: number,
  limit: number,
): Promise<TedNotice[]> {
  const query = buildTedQuery(keywords, lookbackDays);
  const body = {
    query,
    fields: [
      "publication-number",
      "publication-date",
      "notice-title",
      "organisation-name-buyer",
      "organisation-city-buyer",
      "organisation-country-buyer",
      "contract-nature",
      "links",
    ],
    limit,
  };

  const response = await fetch(TED_API, {
    method: "POST",
    headers: {
      "User-Agent": "iFIND TriggerEngine/1.0 (contact: hello@ifind.fr)",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`TED Europa HTTP ${response.status}`);
  }
  const data = (await response.json()) as { notices?: TedNotice[] };
  return data.notices ?? [];
}

export function extractFrenchString(
  v: { fra?: string | string[] } | string | string[] | undefined,
): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : "";
  const fra = v.fra;
  if (typeof fra === "string") return fra;
  if (Array.isArray(fra) && fra.length > 0 && typeof fra[0] === "string") return fra[0];
  return "";
}

export async function pollTedEuropaSignatureForClient(
  clientId: string,
  opts: { lookbackDays?: number; limit?: number; dryRun?: boolean } = {},
): Promise<TedEuropaPollerResult> {
  const result: TedEuropaPollerResult = {
    clientId,
    noticesFetched: 0,
    candidatesProcessed: 0,
    triggersCreated: 0,
    triggersSkippedDup: 0,
    triggersSkippedVendorOnlyMatch: 0,
    triggersSkippedNoSiren: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (
    !client ||
    client.deletedAt ||
    (client.status !== "ACTIVE" && client.status !== "PROSPECT")
  ) {
    result.errors.push(`Client ${clientId} not active/prospect or deleted`);
    return result;
  }

  if (!(await isSignalEnabled(clientId, "P3"))) {
    console.log(`[ted-europa-poller] P3 not enabled for client=${clientId}, skip`);
    return result;
  }

  const keywords = await getKeywordsForClient(clientId);
  const lookbackDays = opts.lookbackDays ?? 30;
  const limit = opts.limit ?? 50;

  console.log(
    `[ted-europa-poller] ${clientId}: ${keywords.length} keywords (lookback=${lookbackDays}j, limit=${limit})`,
  );

  let notices: TedNotice[];
  try {
    notices = await fetchTedNotices(keywords, lookbackDays, limit);
  } catch (e) {
    result.errors.push(
      `TED Europa fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }

  result.noticesFetched = notices.length;
  console.log(`[ted-europa-poller] ${clientId}: ${notices.length} notices fetched`);

  for (const notice of notices) {
    result.candidatesProcessed += 1;
    const pubNum = notice["publication-number"];
    const title = extractFrenchString(notice["notice-title"]);
    const buyerName = extractFrenchString(notice["organisation-name-buyer"]);
    if (!pubNum || !title || !buyerName) continue;

    const sourceUrl = `ted-europa:${pubNum}`;

    const existing = await db.trigger.findFirst({
      where: { clientId, sourceCode: "ted-europa.tender", sourceUrl },
      select: { id: true },
    });
    if (existing) {
      result.triggersSkippedDup += 1;
      continue;
    }

    // Jour 14 Sujet 10 — Filtre vendor-only sur le titre. Recalcule
    // côté Node quels keywords matchent le titre et skip si tous sont
    // des vendor names. Défensif : l'API TED matche déjà en titre, mais
    // dans le cas où la liste de keywords contient des vendors, on évite
    // de capter un AO européen mentionnant juste un vendor dans son titre.
    const titleLower = title.toLowerCase();
    const matchedLabels = keywords.filter((k) => titleLower.includes(k.toLowerCase()));
    if (matchedLabels.length > 0 && !hasGenericSignatureSignal(matchedLabels)) {
      console.log(
        `[ted-europa-poller.skip-vendor-only] ${title.slice(0, 60)}: matches=[${matchedLabels.join(",")}] tous vendors, skip`,
      );
      result.triggersSkippedVendorOnlyMatch += 1;
      continue;
    }

    const city = extractFrenchString(notice["organisation-city-buyer"]);

    let siren: string | null = null;
    let companyNaf: string | null = null;
    try {
      // Essai 1 : nom brut (préserve la précision si déjà clean)
      let sirene = await attributeSirene(buyerName, { ville: city || undefined });
      // Essai 2 : cleanBuyerName si essai 1 NULL — symétrie avec boamp-poller
      // (Jour 14 Bombora FR : nettoie suffixes administratifs + parenthèses
      // code département qui cassent la recherche gouv-api sur acheteurs publics).
      if (!sirene) {
        const cleaned = cleanBuyerName(buyerName);
        if (cleaned && cleaned !== buyerName) {
          sirene = await attributeSirene(cleaned, { ville: city || undefined });
        }
      }
      // Essai 3 : 1er mot/sigle significatif (Sujet 12 — 20/05/2026, symétrie boamp).
      if (!sirene) {
        const firstWord = extractFirstSignificantWord(buyerName);
        const cleanedAlready = cleanBuyerName(buyerName);
        if (firstWord && firstWord !== cleanedAlready && firstWord !== buyerName) {
          sirene = await attributeSirene(firstWord, { ville: city || undefined });
        }
      }
      if (sirene) {
        siren = sirene.siren;
        companyNaf = sirene.code_naf ?? null;
      }
    } catch {
      // SIRET non résolu — beaucoup d'acheteurs sont des entités publiques
      // (ministères, EPCI) qui n'ont pas de SIRET résolvable par gouv-api.
    }

    if (!siren) result.triggersSkippedNoSiren += 1;

    const eventDate =
      (notice["publication-date"] || "").slice(0, 10) ||
      new Date().toISOString().slice(0, 10);

    const noticeUrl = notice.links?.html?.FRA ?? `https://ted.europa.eu/fr/notice/-/detail/${pubNum}`;
    const contractNature = Array.isArray(notice["contract-nature"])
      ? notice["contract-nature"][0]
      : "";

    const detail = [
      title.slice(0, 800),
      contractNature ? `Nature : ${contractNature}` : null,
      city ? `Ville : ${city}` : null,
      `URL : ${noticeUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (opts.dryRun) {
      result.triggersCreated += 1;
      continue;
    }

    try {
      await db.trigger.create({
        data: {
          clientId,
          sourceCode: "ted-europa.tender",
          signalCode: "P3",
          sourceUrl,
          capturedAt: new Date(),
          publishedAt: new Date(eventDate),
          companyName: buyerName.slice(0, 255),
          companySiret: siren,
          companyNaf,
          type: TriggerType.OTHER,
          title: `TED : ${buyerName.slice(0, 80)} — ${title.slice(0, 80)}`,
          detail,
          rawPayload: notice as unknown as Prisma.InputJsonValue,
          // Score 8 : signal d'achat dur, marché passé seuil européen
          // (donc montant significatif), match titre = signal très propre.
          score: 8,
          scoreReason: `TED tender match keywords in title (${keywords.slice(0, 3).join("/")}...)`,
          status: TriggerStatus.NEW,
        },
      });
      result.triggersCreated += 1;
    } catch (e) {
      result.errors.push(
        `TED create failed for ${pubNum}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(
    `[ted-europa-poller] ${clientId}: created=${result.triggersCreated} dup=${result.triggersSkippedDup} noSiren=${result.triggersSkippedNoSiren} errors=${result.errors.length}`,
  );

  return result;
}
