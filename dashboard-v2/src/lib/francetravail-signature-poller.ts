import "server-only";

/**
 * Poller France Travail filtré "signature topic" (Bombora FR — Jour 11, 19/05/2026).
 *
 * Symétrique du Jour 9 (LinkedIn Jobs signature) mais 100% GRATUIT via l'API
 * gouv France Travail (3000 req/jour). Particulièrement adapté à Digidemat
 * dont la cible = secteur public FR (collectivités, ministères, écoles).
 *
 * Différences clés vs apify-linkedin-signature-poller (Jour 9) :
 *   - 100% gratuit (vs $45/mo)
 *   - Filtre côté API via paramètre `motsCles` (full-text titre+desc) plutôt
 *     que côté client → bande passante optimale
 *   - SIRET souvent fourni nativement (entreprise.siret) → résout le bug
 *     "no-siret" qu'on a eu sur SOFTEAM côté LinkedIn
 *   - Blacklist Bombora-spécifique (PAS les collectivités, qui sont cibles)
 *
 * Différences clés vs francetravail-poller (P1 Hiring) :
 *   - Cherche par mots-clés PRODUIT (signature, DocuSign…) au lieu de codes ROME tech
 *   - Filtre DESCRIPTION (la spec dit explicitement)
 *   - sourceCode "francetravail.signature" → P3 (vs P1)
 *   - Pas de filtre sectoriel tech (cibles tous secteurs : public + privé)
 *
 * Mots-clés : ClientSignalConfig.parameters.signatureKeywords (futur) puis
 * fallback boampKeywords (déjà configuré Digidemat Jour 6).
 *
 * Économie : 1 run/jour à 8h UTC. Rotation 6 mots-clés/run (cohérent
 * LinkedIn). 30 KW → couverture en 5 jours. Coût : 6 × 1 req = 6 req/jour
 * (sur quota 3000 req/jour FT, négligeable).
 *
 * Cohérence pipeline aval :
 *   - signal-mapping.ts ajoute `francetravail.signature` → P3
 *   - priority-scoring.ts idem
 *   - qualify-trigger.ts : SIREN gate déjà géré (FT fournit SIRET inline)
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { searchFranceTravailOffers } from "@/lib/francetravail";
import { getRotatedKeywords } from "@/lib/keyword-rotation";
import { isSignalEnabled, getSignalConfig } from "@/lib/signal-config";
import { hasGenericSignatureSignal } from "@/lib/signature-vendor-names";
import {
  countSignatureMatchesInOffer,
  isBombloraBlacklisted,
  isVendorCompany,
} from "@/lib/francetravail-signature-helpers";

const SOURCE_CODE = "francetravail.signature";

// Sans mots-clés signature configurés → skip (cohérent autres pollers
// signature). On ne veut pas produire de bruit générique.
const DEFAULT_KEYWORDS: string[] = [];

interface ClientIcp {
  antiPersonas?: string[];
  country_codes?: string[];
}

export interface FrancetravailSignaturePollerResult {
  clientId: string;
  keywordsTotal: number;
  keywordsRun: number;
  offersFetched: number;
  candidatesProcessed: number;
  triggersCreated: number;
  triggersSkippedNoMatch: number;
  triggersSkippedVendorOnlyMatch: number;
  triggersSkippedBlacklist: number;
  triggersSkippedVendor: number;
  triggersSkippedAntiPersona: number;
  triggersSkippedNoSiret: number;
  triggersSkippedDup: number;
  errors: string[];
}

/**
 * Lit la liste de mots-clés signature configurée pour le client.
 * Priorité : signatureKeywords > boampKeywords > DEFAULT (vide).
 * Logique identique à apify-linkedin-signature-poller.getSignatureKeywords.
 */
export async function getSignatureKeywords(
  clientId: string,
): Promise<string[]> {
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

export async function pollFrancetravailSignatureForClient(
  clientId: string,
  opts: { dryRun?: boolean; batchSize?: number; nowMs?: number } = {},
): Promise<FrancetravailSignaturePollerResult> {
  const result: FrancetravailSignaturePollerResult = {
    clientId,
    keywordsTotal: 0,
    keywordsRun: 0,
    offersFetched: 0,
    candidatesProcessed: 0,
    triggersCreated: 0,
    triggersSkippedNoMatch: 0,
    triggersSkippedVendorOnlyMatch: 0,
    triggersSkippedBlacklist: 0,
    triggersSkippedVendor: 0,
    triggersSkippedAntiPersona: 0,
    triggersSkippedNoSiret: 0,
    triggersSkippedDup: 0,
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

  if (!(await isSignalEnabled(clientId, "P3"))) {
    console.log(
      `[francetravail-signature-poller] P3 not enabled for client=${clientId}, skip`,
    );
    return result;
  }

  const keywords = await getSignatureKeywords(clientId);
  result.keywordsTotal = keywords.length;
  if (keywords.length === 0) {
    console.log(
      `[francetravail-signature-poller] no signature keywords for client=${clientId}, skip`,
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
      `Client ${clientId} country_codes excludes FR, skip`,
    );
    return result;
  }
  const antiCompanies = (icp.antiPersonas ?? []).map((a) => a.toLowerCase());

  const batchSize = opts.batchSize ?? 6;
  const rotated = getRotatedKeywords(keywords, {
    batchSize,
    nowMs: opts.nowMs,
  });
  result.keywordsRun = rotated.length;

  // Plage de recherche : 14 derniers jours (offres FT visibles ~30j, mais
  // on capte au plus tôt pour signal frais).
  const now = new Date(opts.nowMs ?? Date.now());
  const since = new Date(now.getTime() - 14 * 86_400_000);
  // France Travail exige le format strict YYYY-MM-DD'T'HH:MM:SS'Z' (avec Z UTC).
  const minIso = since.toISOString().slice(0, 19) + "Z";
  const maxIso = now.toISOString().slice(0, 19) + "Z";

  console.log(
    `[francetravail-signature-poller] ${clientId}: ${rotated.length}/${keywords.length} keywords this run, window=${minIso}→${maxIso}`,
  );

  for (const keyword of rotated) {
    let offers: Awaited<ReturnType<typeof searchFranceTravailOffers>> = [];
    try {
      offers = await searchFranceTravailOffers({
        motsCles: keyword,
        minCreationDate: minIso,
        maxCreationDate: maxIso,
        range: "0-149",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`FT API "${keyword}": ${msg.slice(0, 150)}`);
      console.warn(`[francetravail-signature-poller] keyword="${keyword}" failed: ${msg}`);
      continue;
    }
    result.offersFetched += offers.length;

    for (const offer of offers) {
      result.candidatesProcessed += 1;

      const nom = offer.entreprise?.nom?.trim();
      if (!nom) {
        result.triggersSkippedBlacklist += 1;
        continue;
      }
      if (isBombloraBlacklisted(nom)) {
        result.triggersSkippedBlacklist += 1;
        continue;
      }
      if (isVendorCompany(nom, keywords)) {
        result.triggersSkippedVendor += 1;
        continue;
      }
      if (
        antiCompanies.length > 0 &&
        antiCompanies.some((a) => nom.toLowerCase().includes(a))
      ) {
        result.triggersSkippedAntiPersona += 1;
        continue;
      }

      // Re-vérif keyword présent (filtre API motsCles fait du fuzzy parfois,
      // on garantit la présence d'au moins 1 keyword).
      const fullText = `${offer.intitule ?? ""} ${offer.description ?? ""}`;
      const matches = countSignatureMatchesInOffer(fullText, keywords);
      if (matches.count === 0) {
        result.triggersSkippedNoMatch += 1;
        continue;
      }
      // Jour 14 Sujet 10 — skip si tous les matches sont des vendor names.
      if (!hasGenericSignatureSignal(matches.labels)) {
        console.log(
          `[francetravail-signature.skip-vendor-only] ${offer.intitule}: matches=[${matches.labels.join(",")}] tous vendors, skip`,
        );
        result.triggersSkippedVendorOnlyMatch += 1;
        continue;
      }

      // Le SIRET est crucial pour la suite du pipeline. FT le fournit
      // nativement la plupart du temps. Si absent, skip pour ne pas créer
      // un lead bloqué (cf. bug SOFTEAM côté LinkedIn).
      const siret = offer.entreprise?.siret;
      if (!siret) {
        result.triggersSkippedNoSiret += 1;
        continue;
      }

      // Dedup 90j par companyName (1 boîte qui poste 5 offres avec keyword =
      // 1 signal suffit pour P3).
      const since90 = new Date(Date.now() - 90 * 86_400_000);
      const existing = await db.trigger.findFirst({
        where: {
          clientId,
          sourceCode: SOURCE_CODE,
          companyName: { equals: nom, mode: "insensitive" },
          capturedAt: { gte: since90 },
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

      let score = 7;
      if (matches.count >= 2) score += 1;
      if (matches.count >= 4) score += 1;
      const labelsStr = matches.labels.slice(0, 5).join(", ");
      const sourceUrl =
        offer.origineOffre?.urlOrigine ?? `francetravail:${offer.id}`;

      try {
        await db.trigger.create({
          data: {
            clientId,
            sourceCode: SOURCE_CODE,
            signalCode: "P3",
            sourceUrl,
            capturedAt: new Date(),
            publishedAt: offer.dateCreation ? new Date(offer.dateCreation) : null,
            companyName: nom,
            companySiret: siret,
            region: offer.lieuTravail?.libelle ?? null,
            type: TriggerType.OTHER,
            title: `France Travail : ${nom} cherche profil mentionnant "${labelsStr}"`,
            detail:
              `Offre "${offer.intitule}" mentionne ${matches.count} mot(s)-clé(s) signature : ${matches.labels.join(", ")}. ` +
              `Signal P3 (Intent d'achat / adoption interne). Source : France Travail (API gouv).`,
            rawPayload: {
              offer,
              matches,
              keyword,
            } as unknown as Prisma.InputJsonValue,
            score,
            scoreReason: `France Travail offre motsCles="${keyword}" match desc ${matches.count} keyword(s): ${labelsStr}`,
            isHot: score >= 9,
            status: TriggerStatus.NEW,
          },
        });
        result.triggersCreated += 1;
      } catch (e) {
        result.errors.push(
          `Trigger create failed for ${nom}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  console.log(
    `[francetravail-signature-poller] ${clientId}: offers=${result.offersFetched} created=${result.triggersCreated} no-match=${result.triggersSkippedNoMatch} blacklist=${result.triggersSkippedBlacklist} vendor=${result.triggersSkippedVendor} no-siret=${result.triggersSkippedNoSiret} dup=${result.triggersSkippedDup}`,
  );

  return result;
}
