import "server-only";

/**
 * Bougie 5 (04/05) — Poller France Travail (gratuit, 3000 req/jour).
 *
 * Capte les offres tech FR officielles (~30% que LinkedIn/Indeed
 * ratent). Filtre ICP-aware (taille via Pappers post-enrichment) +
 * dédup cross-source HIRING_KEY 30j (évite doublon avec Apify/TheirStack).
 *
 * Stratégie : 1 call par jour, codes ROME M180* (info) + M181* (admin
 * SI), filtre titre tech via isFTTechOffer, score plancher 6 (boost à
 * 8 si QA match via isFTQaOffer).
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  searchFranceTravailOffers,
  isFTBlacklisted,
  isFTTechOffer,
  isFTQaOffer,
  type FranceTravailOffer,
} from "@/lib/francetravail";
import { buildTitleFilterFromCatalog } from "@/lib/icp-title-filter";
import { isSignalEnabled, getP1Keywords, getP1Regions, getP1RomeCodes } from "@/lib/signal-config";

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  antiPersonas?: string[];
  keywordsHiring?: string[];
  // Multi-tenant 13/05/2026 — codes ROME francetravail paramétrables.
  // Default DTL : ["M1805","M1810","M1811"] (informatique).
  // iFIND : ["M1701","M1704","M1707","M1702"] (sales/commercial/marketing).
  francetravailRomeCodes?: string[];
  // Active le pré-filtre isFTTechOffer (sectoriel tech). Default true (DTL).
  // iFIND : false (pas de filtre sectoriel — keywordsHiring suffit).
  francetravailRequireTechFilter?: boolean;
  // Multi-tenant 13/05 — réutilisé par buildTitleFilterForClient pour le boost
  // de score (anciennement isFTQaOffer hardcodé).
  titleFilterInclude?: string | string[];
  titleFilterExclude?: string | string[];
}

export interface FranceTravailPollerResult {
  clientId: string;
  offersFetched: number;
  triggersCreated: number;
  triggersSkipped: number;
  errors: Array<{ kind: string; error: string }>;
}

/**
 * Mappe les régions ICP en codes département FR pour filtrer côté API.
 * Limite : grandes métropoles uniquement (suffisant pour DTL Paris/Lyon/Bordeaux/Marseille).
 */
function regionsToDepartements(regions: string[] | undefined): string | undefined {
  if (!regions || regions.length === 0) return undefined;
  const depts = new Set<string>();
  for (const r of regions) {
    const lower = r.toLowerCase();
    if (lower.includes("paris") || lower.includes("île-de-france") || lower.includes("ile-de-france")) {
      ["75", "77", "78", "91", "92", "93", "94", "95"].forEach((d) => depts.add(d));
    }
    if (lower.includes("lyon") || lower.includes("auvergne-rhône-alpes")) {
      ["69"].forEach((d) => depts.add(d));
    }
    if (lower.includes("bordeaux") || lower.includes("nouvelle-aquitaine")) {
      ["33"].forEach((d) => depts.add(d));
    }
    if (lower.includes("marseille") || lower.includes("provence")) {
      ["13"].forEach((d) => depts.add(d));
    }
    if (lower.includes("toulouse") || lower.includes("occitanie")) {
      ["31"].forEach((d) => depts.add(d));
    }
    if (lower.includes("nantes") || lower.includes("pays de la loire")) {
      ["44"].forEach((d) => depts.add(d));
    }
    if (lower.includes("lille") || lower.includes("hauts-de-france")) {
      ["59"].forEach((d) => depts.add(d));
    }
  }
  if (depts.size === 0) return undefined;
  // API France Travail : max 5 départements par requête. Au-delà → on
  // n'envoie pas le filtre (France entière), le filtre côté local
  // (lieuTravail.libelle dans le détail) fait le tri post-fetch.
  if (depts.size > 5) return undefined;
  return Array.from(depts).join(",");
}

function offerToTriggerData(
  offer: FranceTravailOffer,
  clientId: string,
  signalBoostHit: boolean = false,
): Prisma.TriggerCreateInput {
  // Multi-tenant 13/05 — boost générique si l'intitulé match le signal #1
  // du client (calculé en amont via buildTitleFilterForClient). Fallback
  // DTL legacy : isFTQaOffer pour rétro-compat si signalBoostHit non passé.
  const boostHit = signalBoostHit || isFTQaOffer(offer.intitule);
  let score = 6;
  if (boostHit) score = 8;
  // Senior boost
  if (/\b(senior|lead|head|expert)\b/i.test(offer.intitule)) score = Math.min(10, score + 1);

  return {
    client: { connect: { id: clientId } },
    sourceCode: "francetravail.tech",
    sourceUrl: offer.origineOffre?.urlOrigine ?? `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    capturedAt: new Date(),
    publishedAt: offer.dateCreation ? new Date(offer.dateCreation) : null,
    companyName: offer.entreprise?.nom ?? "Entreprise inconnue",
    companySiret: offer.entreprise?.siret ?? null,
    industry: null,
    region: offer.lieuTravail?.libelle ?? null,
    type: TriggerType.HIRING_KEY,
    title: `${offer.intitule}${boostHit ? " (signal match)" : ""}`,
    detail: [
      offer.lieuTravail?.libelle,
      offer.typeContrat,
      offer.romeLibelle,
      offer.description?.slice(0, 300),
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1000),
    rawPayload: offer as unknown as Prisma.InputJsonValue,
    score,
    isHot: score >= 9,
    isCombo: false,
    status: TriggerStatus.NEW,
  };
}

/**
 * Anti-doublons cross-source HIRING_KEY (même boîte déjà captée via
 * Apify/TheirStack/autre dans 30j → on ne crée pas de doublon).
 */
async function isHiringAlreadyCapturedCrossSource(
  clientId: string,
  companyName: string,
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const existing = await db.trigger.findFirst({
    where: {
      clientId,
      companyName,
      type: "HIRING_KEY",
      deletedAt: null,
      capturedAt: { gte: since },
    },
    select: { id: true },
  });
  return !!existing;
}

export async function pollFranceTravailForClient(
  clientId: string,
  options: { dryRun?: boolean; lookbackHours?: number } = {},
): Promise<FranceTravailPollerResult> {
  const result: FranceTravailPollerResult = {
    clientId,
    offersFetched: 0,
    triggersCreated: 0,
    triggersSkipped: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  // Sprint catalogue (16/05/2026) — Kill-switch P1 via ClientSignalConfig.
  // France Travail produit du signal P1 "Hire role X" (codes ROME tech/sales).
  // Si P1 désactivé pour ce client, on skip.
  if (!(await isSignalEnabled(clientId, "P1"))) {
    console.log(`[francetravail-poller] P1 disabled for client=${clientId}, skip`);
    return result;
  }

  const icp = client.icp as ClientIcpExtended;
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());
  // Sprint catalogue P1.3 (17/05) — regions depuis ClientSignalConfig.P1
  // avec fallback icp.regions (transition).
  const p1Regions = await getP1Regions(clientId, icp);
  const departement = regionsToDepartements(p1Regions);
  const lookbackHours = options.lookbackHours ?? 24;

  // Sprint catalogue P1.3 (17/05) — codes ROME depuis ClientSignalConfig.P1
  // avec fallback icp.francetravailRomeCodes (default DTL informatique).
  const romeCodesFromCatalog = await getP1RomeCodes(clientId, icp);
  const romeCodes = romeCodesFromCatalog.length > 0
    ? romeCodesFromCatalog
    : ["M1805", "M1810", "M1811"];
  const requireTechFilter = icp.francetravailRequireTechFilter ?? true;
  // Signal #1 boost (anciennement isFTQaOffer hardcodé) — désormais générique
  // via titleFilterInclude / titleFilterExclude du client.icp.
  // Sprint catalogue P1bis (17/05) — titleFilter via catalogue P1.parameters
  const signalBoostFilter = await buildTitleFilterFromCatalog(clientId, icp);

  // Fenêtre 24h glissante (API exige min+max)
  const now = new Date();
  const since = new Date(now.getTime() - lookbackHours * 3600 * 1000);
  const minCreationDate = since.toISOString().slice(0, 19) + "Z";
  const maxCreationDate = now.toISOString().slice(0, 19) + "Z";

  try {
    const offers = await searchFranceTravailOffers({
      minCreationDate,
      maxCreationDate,
      codeROME: romeCodes.join(","),
      departement,
      range: "0-149",
    });
    result.offersFetched = offers.length;

    // C15 — Pré-calcul keywordsHiring du client pour filtrage métier strict.
    // Sprint catalogue P1.3 (17/05) — lit depuis ClientSignalConfig.P1.parameters.keywords
    // avec fallback icp.keywordsHiring (transition). 24 termes pour DTL après C13.
    const p1Keywords = await getP1Keywords(clientId, icp);
    const clientKeywords = p1Keywords.map((k) => k.toLowerCase());

    for (const offer of offers) {
      // Filtre tech strict (sécurité même si ROME devrait suffire) — DTL only.
      // Multi-tenant : skip ce filtre si client.icp.francetravailRequireTechFilter=false.
      if (requireTechFilter && !isFTTechOffer(offer.intitule)) {
        result.triggersSkipped += 1;
        continue;
      }
      // C15 — Filtre métier client : l'intitulé doit matcher 1 keywordHiring.
      // Si keywordsHiring vide, on garde le comportement large (passe).
      if (clientKeywords.length > 0) {
        const titleLower = offer.intitule.toLowerCase();
        const matchKeyword = clientKeywords.some((k) => titleLower.includes(k));
        if (!matchKeyword) {
          result.triggersSkipped += 1;
          continue;
        }
      }
      // Anti-blacklist (intérim, collectivités, restos, etc.)
      const company = offer.entreprise?.nom;
      if (!company || isFTBlacklisted(company)) {
        result.triggersSkipped += 1;
        continue;
      }
      // Anti-personas client
      if (antiCompanies.some((a) => company.toLowerCase().includes(a))) {
        result.triggersSkipped += 1;
        continue;
      }
      // Dédup cross-source HIRING_KEY
      if (await isHiringAlreadyCapturedCrossSource(clientId, company)) {
        result.triggersSkipped += 1;
        continue;
      }

      if (options.dryRun) {
        result.triggersCreated += 1;
        continue;
      }

      try {
        await db.trigger.create({ data: offerToTriggerData(offer, clientId, signalBoostFilter(offer.intitule)) });
        result.triggersCreated += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Trigger_clientId_sourceCode_sourceUrl_unique") || msg.includes("P2002")) {
          result.triggersSkipped += 1;
        } else {
          result.errors.push({ kind: "trigger-create", error: msg });
        }
      }
    }
  } catch (e) {
    result.errors.push({
      kind: "searchOffers",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}
