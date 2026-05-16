import "server-only";

/**
 * Sprint 1 (10/05/2026) — Poller BODACC pour dashboard-v2.
 *
 * BODACC = Bulletin officiel des annonces civiles et commerciales.
 * Source : opendatasoft (publique, sans auth, MAJ quotidienne ~03:00 UTC).
 *
 * Event types détectés :
 *   - company_creation     (immatriculation) — pas un signal d'achat fort
 *   - company_cessation    (radiation) — anti-signal (à ignorer)
 *   - company_merger       (fusion) — signal scaling fort
 *   - procedure_collective (RJ/LJ/sauvegarde) — anti-signal hard (insolvabilité)
 *   - capital_increase     (augm. capital) — signal levée pré-officiel (1-2 sem
 *                           avant Rodz/RSS-levées)
 *   - modification_statuts (changement statuts) — signal moyen (M&A, rebrand)
 *
 * On ne crée des Triggers que pour les types VALEUR : capital_increase, merger,
 * modification_statuts. Les cessations/procédures collectives sont enregistrées
 * comme TriggerType.OTHER pour traçabilité (le judge décidera).
 */

import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { getEntreprise } from "@/lib/pappers";
import { matchesClientIcp, type ClientIcp } from "@/lib/client-icp-matcher";

const BODACC_API =
  "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

export interface BodaccPollerResult {
  clientId: string;
  itemsFetched: number;
  candidatesProcessed: number;
  triggersCreated: number;
  triggersSkippedDup: number;
  triggersSkippedIcp: number;
  triggersSkippedType: number;
  errors: string[];
}

type BodaccEventType =
  | "capital_increase"
  | "company_merger"
  | "modification_statuts"
  | "procedure_collective"
  | "company_cessation"
  | "company_creation"
  | "bodacc_other";

function flatten(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map(flatten).join(" ");
  if (typeof val === "object")
    return Object.values(val as Record<string, unknown>).map(flatten).join(" ");
  return "";
}

/**
 * Map BODACC familleavis/typeavis vers notre taxonomie.
 * Logique portée du bot trigger-engine/sources/bodacc.js (fix C10 04/05).
 */
function mapBodaccType(
  familleAvis: string,
  typeAvis: string,
  contenu: string,
): BodaccEventType {
  const f = (familleAvis || "").toLowerCase();
  const t = (typeAvis || "").toLowerCase();
  const c = (contenu || "").toLowerCase();

  if (f.includes("création") || t.includes("création")) return "company_creation";
  if (f.includes("radiation") || t.includes("radiation")) return "company_cessation";
  if (
    f.includes("procédure") ||
    t.includes("redressement") ||
    t.includes("liquidation") ||
    t.includes("sauvegarde")
  ) {
    return "procedure_collective";
  }
  // 13/05 — chercher fusion + augmentation_capital AVANT le générique modification
  // (sinon "Modifications diverses" famille capture tout en modification_statuts
  // alors que c'est en réalité une augmentation capital ou fusion qu'on a filtrée
  // côté API). Bug détecté : YUKAN/lempire/ADAPT1SOLUTION classés modification
  // alors qu'ils étaient bien des augmentations capital.
  if (
    /fusion/i.test(f) ||
    /fusion/i.test(t) ||
    /fusion/i.test(c)
  ) {
    return "company_merger";
  }
  // 13/05 — Détection capital_increase élargie : le descriptif BODACC réel
  // est souvent "modification survenue sur le capital (augmentation)" ou
  // "augmentation du capital", on cherche les 2 patterns (mots colocs).
  if (
    /augmentation\s+(de\s+|du\s+)?capital/.test(f) ||
    /augmentation\s+(de\s+|du\s+)?capital/.test(t) ||
    /augmentation\s+(de\s+|du\s+)?capital/.test(c) ||
    (c.includes("capital") && c.includes("augmentation"))
  ) {
    return "capital_increase";
  }
  if (f.includes("modification") || t.includes("modification")) {
    return "modification_statuts";
  }
  return "bodacc_other";
}

interface BodaccRecord {
  id?: string;
  registre?: string[];
  numerodepartement?: string;
  numerodegestion?: string;
  publication?: string;
  ville?: string;
  departement_nom_officiel?: string;
  dateparution?: string;
  familleavis_lib?: string;
  typeavis_lib?: string;
  commercant?: unknown;
  contenu_modification?: unknown;
  modificationsgenerales?: unknown;
  contenu?: unknown;
  listepersonnes?: unknown;
}

function extractSiren(record: BodaccRecord): string | null {
  if (record.registre && Array.isArray(record.registre)) {
    for (const reg of record.registre) {
      if (typeof reg === "string" && /^\d{9}/.test(reg)) {
        return reg.slice(0, 9);
      }
    }
  }
  if (record.numerodegestion) {
    const m = String(record.numerodegestion).match(/\d{9}/);
    if (m) return m[0];
  }
  return null;
}

function extractCompanyName(record: BodaccRecord): string {
  const c = record.commercant;
  if (typeof c === "string") return c;
  if (typeof c === "object" && c !== null) {
    const obj = c as { raisonSociale?: string; denomination?: string; nom?: string };
    return obj.raisonSociale || obj.denomination || obj.nom || "Unknown";
  }
  return "Unknown";
}

/**
 * Mapping bot type → Trigger Prisma TriggerType + score base
 */
function getBodaccTypeMapping(
  type: BodaccEventType,
): { triggerType: TriggerType; score: number; shouldCreate: boolean } {
  switch (type) {
    case "capital_increase":
      return { triggerType: TriggerType.CAPITAL_INCREASE, score: 7, shouldCreate: true };
    case "company_merger":
      return { triggerType: TriggerType.EXPANSION, score: 7, shouldCreate: true };
    case "modification_statuts":
      return { triggerType: TriggerType.OTHER, score: 5, shouldCreate: true };
    case "procedure_collective":
      // Anti-signal : on ne crée pas (le judge V2 reject de toute façon)
      return { triggerType: TriggerType.OTHER, score: 1, shouldCreate: false };
    case "company_cessation":
      return { triggerType: TriggerType.OTHER, score: 1, shouldCreate: false };
    case "company_creation":
      // Création seule = signal faible. On skip.
      return { triggerType: TriggerType.OTHER, score: 3, shouldCreate: false };
    case "bodacc_other":
    default:
      return { triggerType: TriggerType.OTHER, score: 4, shouldCreate: false };
  }
}

export async function pollBodaccForClient(
  clientId: string,
  opts: { lookbackDays?: number; limit?: number } = {},
): Promise<BodaccPollerResult> {
  const result: BodaccPollerResult = {
    clientId,
    itemsFetched: 0,
    candidatesProcessed: 0,
    triggersCreated: 0,
    triggersSkippedDup: 0,
    triggersSkippedIcp: 0,
    triggersSkippedType: 0,
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

  const lookbackDays = opts.lookbackDays ?? 7;
  const limit = opts.limit ?? 100;
  const sinceDate = new Date(Date.now() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // 13/05/2026 nuit — Audit Alexis a montré que 0/100 triggers étaient créés
  // (100% type-filter skipped). Cause : sans filtre côté API, on récupérait
  // mécaniquement les 100 records les plus récents = 95% "Dépôts de comptes"
  // et "Créations" (= shouldCreate=false). BODACC publie 100k+ records/jour
  // donc on ratait systématiquement les ~30-50 capital_increase et ~5 fusions
  // qui sont noyés dans le bruit. Maintenant : 2 queries ciblées avec filtre
  // server-side qui ne ramène QUE les modifications avec "augmentation
  // capital" ou "fusion" dans le descriptif. Volume attendu : ~30-50/jour FR
  // total → ~5-10 après ICP filter tech (NAF 62/58/63).
  const filteredWhere = `dateparution >= date'${sinceDate}' AND familleavis_lib="Modifications diverses"`;
  const queries = [
    {
      label: "augmentation_capital",
      where: `${filteredWhere} AND search(modificationsgenerales, "augmentation capital")`,
    },
    {
      label: "fusion",
      where: `${filteredWhere} AND search(modificationsgenerales, "fusion")`,
    },
  ];

  const allRecords: BodaccRecord[] = [];
  for (const q of queries) {
    const url = new URL(BODACC_API);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order_by", "dateparution DESC");
    url.searchParams.set("where", q.where);

    console.log(`[bodacc-poller] ${clientId}: fetching ${q.label} (${url.toString().slice(0, 200)}...)`);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          "User-Agent": "iFIND TriggerEngine/1.0 (contact: hello@ifind.fr)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      result.errors.push(
        `BODACC fetch ${q.label} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (!response.ok) {
      result.errors.push(`BODACC ${q.label} HTTP ${response.status}`);
      continue;
    }

    const data = (await response.json()) as { results?: BodaccRecord[] };
    const records = data.results ?? [];
    console.log(`[bodacc-poller] ${clientId}: ${q.label} → ${records.length} records`);
    allRecords.push(...records);
  }

  const records = allRecords;
  result.itemsFetched = records.length;

  for (const record of records) {
    result.candidatesProcessed += 1;

    const siren = extractSiren(record);
    const companyName = extractCompanyName(record);
    const contenuExtra = [
      record.contenu_modification,
      record.modificationsgenerales,
      record.contenu,
      record.listepersonnes,
      record.commercant,
    ]
      .map(flatten)
      .filter(Boolean)
      .join(" ");

    const bodaccType = mapBodaccType(
      record.familleavis_lib ?? "",
      record.typeavis_lib ?? "",
      contenuExtra,
    );
    const mapping = getBodaccTypeMapping(bodaccType);

    if (!mapping.shouldCreate) {
      result.triggersSkippedType += 1;
      continue;
    }

    // Resolve Pappers pour ICP filter
    let pappersData: Awaited<ReturnType<typeof getEntreprise>> | null = null;
    if (siren) {
      try {
        pappersData = await getEntreprise(siren);
      } catch {
        // Pappers échoue → on continue avec les data BODACC seules
      }
    }

    // Audit 16/05/2026 — bodacc.capital_increase : 186/208 IGNORED (90%) avaient
    // companyNaf vide = HOLDING/SCI/INVEST/PROPERTIES/HOTEL hors ICP tech.
    // Sans NAF on ne peut pas scorer l'ICP fit → on refuse au polling plutôt
    // que de polluer la file et faire qualifier ces triggers à perte (~$0.04
    // Opus chacun = ~$7/mo économisés rien que sur BODACC).
    if (!pappersData?.code_naf) {
      result.triggersSkippedIcp += 1;
      continue;
    }

    // ICP filter
    const icpCheck = matchesClientIcp(
      pappersData
        ? {
            code_naf: pappersData.code_naf ?? null,
            tranche_effectif: pappersData.tranche_effectif ?? null,
            siege: pappersData.siege
              ? {
                  region: pappersData.siege.region,
                  code_postal: pappersData.siege.code_postal,
                }
              : null,
          }
        : null,
      companyName,
      icp,
    );
    if (!icpCheck.ok) {
      result.triggersSkippedIcp += 1;
      continue;
    }

    const eventDate = record.dateparution ?? new Date().toISOString().slice(0, 10);
    const sourceUrl = record.id
      ? `bodacc:${record.id}`
      : `bodacc:${siren ?? "unknown"}:${eventDate}:${bodaccType}`;

    // Idempotence
    const existing = await db.trigger.findFirst({
      where: { clientId, sourceCode: "bodacc", sourceUrl },
      select: { id: true },
    });
    if (existing) {
      result.triggersSkippedDup += 1;
      continue;
    }

    try {
      await db.trigger.create({
        data: {
          clientId,
          sourceCode: `bodacc.${bodaccType}`,
          sourceUrl,
          capturedAt: new Date(),
          publishedAt: new Date(eventDate),
          companyName,
          companySiret: siren,
          companyNaf: pappersData?.code_naf ?? null,
          type: mapping.triggerType,
          title: `BODACC ${bodaccType.replace(/_/g, " ")} — ${companyName}`,
          detail: contenuExtra.slice(0, 1000),
          rawPayload: record as unknown as Prisma.InputJsonValue,
          score: mapping.score,
          scoreReason: `BODACC ${bodaccType} (${eventDate})`,
          status: TriggerStatus.NEW,
        },
      });
      result.triggersCreated += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${companyName}: ${msg.slice(0, 150)}`);
    }
  }

  console.log(
    `[bodacc-poller] ${clientId}: ${result.triggersCreated} created / ${result.itemsFetched} fetched (${result.triggersSkippedType} type-filter, ${result.triggersSkippedIcp} icp-filter, ${result.triggersSkippedDup} dup)`,
  );

  return result;
}
