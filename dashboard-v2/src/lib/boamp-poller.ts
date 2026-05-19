import "server-only";

/**
 * Poller BOAMP (Bombora FR pivot — 18/05/2026, Jour 4).
 *
 * BOAMP = Bulletin Officiel des Annonces des Marchés Publics.
 * Source : opendatasoft DILA (publique, sans auth, MAJ continue).
 * Documentation testée live le 18/05/2026 — 1.6M+ records, 49 AO
 * "signature électronique / dématérialisation" sur 6 dernières semaines.
 *
 * Pourquoi BOAMP pour Bombora FR :
 *   - Source 100% gratuite, sans clé, sans rate-limit notable
 *   - Signal d'achat MAXIMAL : un acheteur publie un AO = il achète
 *     littéralement dans les 30-90 jours
 *   - Couverture FR exhaustive sur le secteur public + collectivités
 *   - Mots-clés très spécifiques au topic (signature électronique, CRM,
 *     facturation, ERP, dématérialisation, etc.)
 *   - Champs riches : objet, montant estimé, date limite réponse, acheteur,
 *     type marché (TRAVAUX/FOURNITURES/SERVICES), code département
 *
 * Mapping signal catalogue :
 *   - sourceCode = "boamp.tender" → signal P3 (Intent d'achat)
 *
 * Stratégie de récupération :
 *   - Lookup mots-clés depuis ClientSignalConfig.parameters.boampKeywords
 *     pour le signal P3. Fallback : icp.topics ou liste par défaut tech.
 *   - Query OpenDataSoft v2.1 : where=search(objet, "kw1") OR search(objet, "kw2")
 *   - Lookback 14j par défaut (AO BOAMP visibles 30-60j avant date limite)
 *
 * Idempotence : sourceUrl = "boamp:<idweb>" garanti unique par AO.
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { attributeSirene } from "@/lib/pappers";
import { isSignalEnabled, getSignalConfig } from "@/lib/signal-config";

const BOAMP_API =
  "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

// Mots-clés par défaut si le client n'a pas configuré ses propres mots-clés
// dans ClientSignalConfig.parameters.boampKeywords. Volontairement larges
// "tech/SaaS" pour cohérence avec la cible primaire iFIND/DTL.
const DEFAULT_KEYWORDS = [
  "logiciel",
  "saas",
  "plateforme numérique",
  "dématérialisation",
];

export interface BoampPollerResult {
  clientId: string;
  itemsFetched: number;
  candidatesProcessed: number;
  triggersCreated: number;
  triggersSkippedDup: number;
  triggersSkippedNoSiren: number;
  errors: string[];
}

interface BoampRecord {
  idweb?: string;
  id?: string;
  objet?: string;
  nomacheteur?: string;
  dateparution?: string;
  datelimitereponse?: string;
  code_departement?: string[];
  type_marche?: string[];
  nature_libelle?: string;
  url_avis?: string;
  donnees?: string;
}

/**
 * Nettoie le nom d'acheteur BOAMP avant attribution SIRENE.
 *
 * Audit Jour 14 Bombora FR (19/05/2026) : 8 triggers BOAMP Digidemat sans SIRET
 * → analyse révèle que les suffixes administratifs cassent la recherche gouv-api.
 * Exemples confirmés en live :
 *   - "VILLE DE PARIS - DCPA - SELT -SET" → 0 résultat, "VILLE DE PARIS" → SIREN OK
 *   - "Syndicat Départemental de la Voirie (17)" → 0, sans "(17)" → SIREN OK
 *   - "CAP Territoires (60)" → 0, sans "(60)" → match approximatif
 * Stratégie :
 *   1. Strip parenthèses + leur contenu (code département, sigle interne)
 *   2. Strip tout après " - " (sous-direction de ministère/collectivité)
 *   3. Normalize whitespace
 * Exporté pour tests + réutilisation par d'autres pollers d'acheteurs publics.
 */
export function cleanBuyerName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*/g, " ") // parenthèses + contenu
    .replace(/\s*-\s+.*$/, "") // tout après " - "
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lit la liste de mots-clés BOAMP configurée pour le client.
 * Priorité : ClientSignalConfig P3 .boampKeywords > defaults.
 */
async function getKeywordsForClient(clientId: string): Promise<string[]> {
  const cfg = await getSignalConfig(clientId, "P3");
  const params = cfg.parameters as { boampKeywords?: unknown };
  const fromConfig = Array.isArray(params.boampKeywords)
    ? (params.boampKeywords as unknown[]).filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  if (fromConfig.length > 0) return fromConfig;
  return DEFAULT_KEYWORDS;
}

/**
 * Construit la clause WHERE OpenDataSoft pour la recherche multi-keywords.
 * Format : (search(objet,"kw1") OR search(objet,"kw2")) AND dateparution >= date'YYYY-MM-DD'
 */
function buildWhereClause(keywords: string[], sinceDate: string): string {
  const orClauses = keywords
    .map((k) => k.replace(/"/g, '\\"'))
    .map((k) => `search(objet, "${k}")`)
    .join(" OR ");
  return `(${orClauses}) AND dateparution >= date'${sinceDate}'`;
}

/**
 * Filtre déterministe côté Node : ne garde que les records dont l'`objet`
 * contient effectivement au moins un keyword.
 *
 * Jour 14 Sujet 8 (19/05/2026) — Bug racine BOAMP : la requête API
 * OpenDataSoft `search(objet, "kw")` matche en réalité sur un index
 * full-text plus large que le champ `objet` lui-même (probablement le
 * JSON `donnees` qui contient le règlement de consultation complet).
 *
 * Conséquence pré-fix : sur 25 BOAMP Digidemat audités, 22 (88%) n'avaient
 * AUCUN keyword dans `objet` — ils ont matché parce que le règlement
 * mentionne "offres déposées avec signature électronique" (procédure
 * standard de tout marché public dématérialisé). Exemples concrets en
 * verdict Opus NON : déménagement bureaux, HVAC, protections hygiéniques,
 * conseil achat espaces pub, fournitures alimentaires.
 *
 * Filtre côté Node = garde-fou indépendant du comportement OpenDataSoft.
 * Exporté pour les tests.
 */
export function filterRecordsByObjetKeyword(
  records: BoampRecord[],
  keywords: string[],
): { kept: BoampRecord[]; dropped: number } {
  if (keywords.length === 0) return { kept: records, dropped: 0 };
  const kwsLower = keywords.map((k) => k.toLowerCase());
  const kept = records.filter((r) => {
    const objet = (r.objet ?? "").toLowerCase();
    return kwsLower.some((k) => objet.includes(k));
  });
  return { kept, dropped: records.length - kept.length };
}

/**
 * Fetch les records BOAMP correspondant à la requête.
 */
async function fetchBoampRecords(
  keywords: string[],
  lookbackDays: number,
  limit: number,
): Promise<BoampRecord[]> {
  const sinceDate = new Date(Date.now() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const where = buildWhereClause(keywords, sinceDate);
  const url = new URL(BOAMP_API);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order_by", "dateparution DESC");
  url.searchParams.set("where", where);
  url.searchParams.set(
    "select",
    "idweb,objet,nomacheteur,dateparution,datelimitereponse,code_departement,type_marche,nature_libelle,url_avis,donnees",
  );

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "iFIND TriggerEngine/1.0 (contact: hello@ifind.fr)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`BOAMP HTTP ${response.status}`);
  }
  const data = (await response.json()) as { results?: BoampRecord[] };
  const raw = data.results ?? [];
  const { kept, dropped } = filterRecordsByObjetKeyword(raw, keywords);
  if (dropped > 0) {
    console.log(
      `[boamp-poller.objet-filter] dropped ${dropped}/${raw.length} records — aucun keyword dans objet (API OpenDataSoft full-text match hors champ objet)`,
    );
  }
  return kept;
}

/**
 * Extrait email + adresse depuis le champ JSON imbriqué `donnees`.
 */
function extractDonneesContact(record: BoampRecord): {
  email?: string;
  ville?: string;
  cp?: string;
} {
  if (!record.donnees) return {};
  try {
    const parsed = JSON.parse(record.donnees);
    const id = (parsed as { IDENTITE?: { MEL?: string; VILLE?: string; CP?: string } })
      ?.IDENTITE;
    return {
      email: id?.MEL,
      ville: id?.VILLE,
      cp: id?.CP,
    };
  } catch {
    return {};
  }
}

export async function pollBoampForClient(
  clientId: string,
  opts: { lookbackDays?: number; limit?: number } = {},
): Promise<BoampPollerResult> {
  const result: BoampPollerResult = {
    clientId,
    itemsFetched: 0,
    candidatesProcessed: 0,
    triggersCreated: 0,
    triggersSkippedDup: 0,
    triggersSkippedNoSiren: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true, deletedAt: true },
  });
  // Bombora FR 19/05/2026 (Jour 14) — accepter PROSPECT pour aligner sur
  // rss-medias-signature-poller / francetravail-signature-poller /
  // ted-europa-signature-poller. Sinon Digidemat (PROSPECT) ne reçoit
  // jamais le moindre trigger BOAMP via le cron.
  if (
    !client ||
    client.deletedAt ||
    (client.status !== "ACTIVE" && client.status !== "PROSPECT")
  ) {
    result.errors.push(`Client ${clientId} not active/prospect or deleted`);
    return result;
  }

  // Bombora FR — Gate sur P3 enabled (pas obligatoirement pilier).
  // BOAMP est un signal secondaire qui complète les piliers principaux.
  // Le client peut l'activer sans toucher à ses 3 piliers (économie API + DB
  // si P3.enabled=false dans ClientSignalConfig).
  if (!(await isSignalEnabled(clientId, "P3"))) {
    console.log(`[boamp-poller] P3 not enabled for client=${clientId}, skip`);
    return result;
  }

  const keywords = await getKeywordsForClient(clientId);
  const lookbackDays = opts.lookbackDays ?? 14;
  const limit = opts.limit ?? 50;

  console.log(
    `[boamp-poller] ${clientId}: fetching ${keywords.length} keywords (lookback=${lookbackDays}j, limit=${limit})`,
  );

  let records: BoampRecord[];
  try {
    records = await fetchBoampRecords(keywords, lookbackDays, limit);
  } catch (e) {
    result.errors.push(
      `BOAMP fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }

  result.itemsFetched = records.length;
  console.log(`[boamp-poller] ${clientId}: ${records.length} records fetched`);

  for (const record of records) {
    result.candidatesProcessed += 1;
    if (!record.idweb || !record.objet || !record.nomacheteur) {
      continue;
    }

    const sourceUrl = `boamp:${record.idweb}`;

    // Idempotence
    const existing = await db.trigger.findFirst({
      where: { clientId, sourceCode: "boamp.tender", sourceUrl },
      select: { id: true },
    });
    if (existing) {
      result.triggersSkippedDup += 1;
      continue;
    }

    // Résolution SIRET via gouv-api (best effort — beaucoup d'acheteurs
    // publics n'ont pas de SIRET résolvable car ce sont des entités
    // administratives. Pas grave : on garde le Trigger avec companyName seul,
    // l'enrichissement dirigeant ne tournera pas mais le brief IA reste utile).
    const contact = extractDonneesContact(record);
    let siren: string | null = null;
    let companyNaf: string | null = null;
    try {
      // Essai 1 : nom brut
      let sirene = await attributeSirene(record.nomacheteur, {
        ville: contact.ville,
        code_postal: contact.cp,
      });
      // Essai 2 : nom nettoyé (suffixes administratifs / parenthèses code dept)
      // si le brut a échoué. Évite ~50% des "no_siret" sur acheteurs publics.
      if (!sirene) {
        const cleaned = cleanBuyerName(record.nomacheteur);
        if (cleaned && cleaned !== record.nomacheteur) {
          sirene = await attributeSirene(cleaned, {
            ville: contact.ville,
            code_postal: contact.cp,
          });
        }
      }
      if (sirene) {
        siren = sirene.siren;
        companyNaf = sirene.code_naf ?? null;
      }
    } catch {
      // siret non résolu, on garde le Trigger sans SIRET (pas un blocker pour P3)
    }

    if (!siren) {
      result.triggersSkippedNoSiren += 1;
      // On crée quand même le Trigger pour traçabilité (publié dans le
      // dashboard avec companyName, le client peut quand même contacter).
    }

    const eventDate = record.dateparution ?? new Date().toISOString().slice(0, 10);
    const typeMarche = Array.isArray(record.type_marche)
      ? record.type_marche.join("/")
      : "";
    const departement = Array.isArray(record.code_departement)
      ? record.code_departement[0]
      : "";

    const title = `BOAMP : ${record.nomacheteur.slice(0, 80)} cherche ${typeMarche || "prestataire"}`;
    const detail = [
      record.objet?.slice(0, 800),
      record.datelimitereponse ? `Date limite réponse : ${record.datelimitereponse}` : null,
      departement ? `Département : ${departement}` : null,
      record.url_avis ? `URL : ${record.url_avis}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await db.trigger.create({
        data: {
          clientId,
          sourceCode: "boamp.tender",
          signalCode: "P3",
          sourceUrl,
          capturedAt: new Date(),
          publishedAt: new Date(eventDate),
          companyName: record.nomacheteur.slice(0, 255),
          companySiret: siren,
          companyNaf,
          type: TriggerType.OTHER,
          title,
          detail,
          rawPayload: record as unknown as Prisma.InputJsonValue,
          // Score 8 : signal d'achat dur + récent + ciblé sur mot-clé client.
          // L'IA Claude qualifiera plus finement en aval.
          score: 8,
          scoreReason: `BOAMP tender match keywords (${keywords.slice(0, 3).join("/")}...)`,
          status: TriggerStatus.NEW,
        },
      });
      result.triggersCreated += 1;
    } catch (e) {
      result.errors.push(
        `BOAMP create failed for ${record.idweb}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(
    `[boamp-poller] ${clientId}: created=${result.triggersCreated} dup=${result.triggersSkippedDup} noSiren=${result.triggersSkippedNoSiren} errors=${result.errors.length}`,
  );

  return result;
}
