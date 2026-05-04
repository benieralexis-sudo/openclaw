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

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  antiPersonas?: string[];
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
): Prisma.TriggerCreateInput {
  const isQa = isFTQaOffer(offer.intitule);
  let score = 6;
  if (isQa) score = 8;
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
    title: `${offer.intitule}${isQa ? " (QA match)" : ""}`,
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

  const icp = client.icp as ClientIcpExtended;
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());
  const departement = regionsToDepartements(icp.regions);
  const lookbackHours = options.lookbackHours ?? 24;

  // Fenêtre 24h glissante (API exige min+max)
  const now = new Date();
  const since = new Date(now.getTime() - lookbackHours * 3600 * 1000);
  const minCreationDate = since.toISOString().slice(0, 19) + "Z";
  const maxCreationDate = now.toISOString().slice(0, 19) + "Z";

  try {
    // Codes ROME M180* (informatique) + M181* (administration SI)
    // M1805 Études et développement informatique
    // M1810 Production et exploitation de systèmes d'information
    // M1811 Data engineering / data science
    const offers = await searchFranceTravailOffers({
      minCreationDate,
      maxCreationDate,
      codeROME: "M1805,M1810,M1811",
      departement,
      range: "0-149",
    });
    result.offersFetched = offers.length;

    for (const offer of offers) {
      // Filtre tech strict (sécurité même si ROME devrait suffire)
      if (!isFTTechOffer(offer.intitule)) {
        result.triggersSkipped += 1;
        continue;
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
        await db.trigger.create({ data: offerToTriggerData(offer, clientId) });
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
