import "server-only";
import { db } from "@/lib/db";
import { attributeSirene } from "@/lib/pappers";
import { isBlacklistNaf } from "@/lib/naf-whitelist";

// ════════════════════════════════════════════════════════════════════════
// B4 (17/05/2026) — Retry attribution SIRENE sur les triggers verdict=ENRICH.
//
// Pourquoi : Opus dit verdict=ENRICH avec enrichmentNeeded[0]="Attribution
// SIRENE via Pappers (fuzzy search ...)". Aucun service ne consommait cette
// recommandation → triggers ENRICH restaient sans SIRET indéfiniment et
// polluaient le dashboard avec "À VÉRIFIER 58%" sans contact.
//
// Stratégie : pour chaque Trigger {verdict=ENRICH, companySiret=null} créé
// dans les 7 derniers jours, on retente attributeSirene avec :
//   1. Le nom brut
//   2. Variantes stripées (sans "SAS"/"SA"/"SARL"/"SASU" suffix)
//   3. Variantes sans "Paris"/"France" si présent
// On stoppe au premier hit non-blacklist NAF.
//
// Au-delà de 7j sans hit → archive automatique (trigger soft-delete +
// scoreReason "[B4-no-sirene-7d]"). Évite l'accumulation indéfinie.
// ════════════════════════════════════════════════════════════════════════

const MAX_AGE_DAYS = 7;
const COMPANY_SUFFIXES = [
  / SAS$/i,
  / SASU$/i,
  / SARL$/i,
  / SA$/i,
  / EURL$/i,
  / SNC$/i,
  / SCOP$/i,
];
const LOCATION_SUFFIXES = [/ Paris$/i, / France$/i, / Lyon$/i, / FR$/i];

function generateVariants(name: string): string[] {
  const variants = new Set<string>([name]);
  for (const re of COMPANY_SUFFIXES) {
    if (re.test(name)) variants.add(name.replace(re, "").trim());
  }
  for (const re of LOCATION_SUFFIXES) {
    if (re.test(name)) variants.add(name.replace(re, "").trim());
  }
  // Strip both : ex "ACME SAS Paris" → "ACME"
  let stripped = name;
  for (const re of [...COMPANY_SUFFIXES, ...LOCATION_SUFFIXES]) {
    stripped = stripped.replace(re, "").trim();
  }
  if (stripped !== name) variants.add(stripped);
  return [...variants].filter((v) => v.length >= 3);
}

export async function retrySirenAttributionForEnrichTriggers(
  clientId: string,
  options: { limit?: number } = {},
): Promise<{
  scanned: number;
  attributed: number;
  archivedOld: number;
  stillUnknown: number;
  errors: number;
}> {
  const limit = options.limit ?? 20;
  const stats = { scanned: 0, attributed: 0, archivedOld: 0, stillUnknown: 0, errors: 0 };

  const sevenDaysAgo = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);

  // Pilier 1 (20/05/2026) — étendu aux 3 verdicts (OUI/NON/ENRICH) ET aux
  // Triggers sans brief V2 (cas legacy). Avant : ENRICH-only laissait 12
  // Triggers OUI/NON sans SIRET dériver > 7j sans action.
  // Politique : SIRET attribué sous 7j ou archivé. Garantit "boîte FR
  // identifiable" du Pilier 1 (1ère partie de la promesse).
  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      companySiret: null,
      status: { not: "IGNORED" },
    },
    select: {
      id: true,
      companyName: true,
      capturedAt: true,
      createdAt: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  stats.scanned = triggers.length;

  for (const t of triggers) {
    // Archive si plus vieux que 7j sans résolution — évite accumulation
    if (t.createdAt < sevenDaysAgo) {
      await db.trigger.update({
        where: { id: t.id },
        data: {
          status: "IGNORED",
          ignoredAt: new Date(),
          ignoredReason: `[Pilier1-no-sirene-7d] Attribution SIRENE échouée 7j après création — boîte non identifiable, auto-archive`,
          deletedAt: new Date(),
        },
      });
      stats.archivedOld += 1;
      continue;
    }

    const variants = generateVariants(t.companyName);
    let hit: Awaited<ReturnType<typeof attributeSirene>> = null;
    for (const variant of variants) {
      try {
        hit = await attributeSirene(variant);
        if (hit) break;
      } catch (e) {
        console.warn(`[retry-enrich-attribution] ${t.companyName} (variant=${variant}): ${e instanceof Error ? e.message : String(e)}`);
        stats.errors += 1;
      }
    }

    if (!hit) {
      stats.stillUnknown += 1;
      continue;
    }

    // Si NAF blacklist → archive direct (cohérent avec theirstack-poller)
    if (isBlacklistNaf(hit.code_naf)) {
      await db.trigger.update({
        where: { id: t.id },
        data: {
          companySiret: hit.siren,
          companyNaf: hit.code_naf ?? null,
          size: hit.effectif ?? null,
          status: "IGNORED",
          ignoredAt: new Date(),
          ignoredReason: `[B4-naf-blacklist:${hit.code_naf}] Secteur hors-ICP après retry SIRENE`,
          deletedAt: new Date(),
        },
      });
      stats.archivedOld += 1;
      continue;
    }

    // Attribution OK → backfill + reset scoreReason pour re-qualif
    await db.trigger.update({
      where: { id: t.id },
      data: {
        companySiret: hit.siren,
        companyNaf: hit.code_naf ?? null,
        size: hit.effectif ?? null,
        scoreReason: null, // re-qualif au prochain cycle
      },
    });
    stats.attributed += 1;
  }

  return stats;
}
