import "server-only";
import { db } from "@/lib/db";
import type { PappersEntreprise } from "@/lib/pappers";

/**
 * Sprint Perfection P1 (08/05/2026) — Helper centralisé pour persister
 * les données Pappers sur le Lead + tagger `enrichedAt`.
 *
 * Avant ce helper : 4 fichiers (`pappers.ts`, `enrich-lead-dirigeants.ts`,
 * `enrich-via-rodz.ts`, `theirstack-poller.ts`) appelaient Pappers mais
 * AUCUN ne posait `enrichedAt`. Seuls 3 chemins (`enrich-via-linkedin-finder.ts:199`,
 * `webhooks/rodz/route.ts:393`, `test-linkedin-finder/route.ts:72`) le posaient,
 * non corrélés à Pappers.
 *
 * Conséquence : `Lead.enrichedAt` rempli sur 1.5% des leads 7j (vs 80% attendu),
 * `companyRevenue` sur 22%, et le judge Opus jugeait sans signal financier.
 *
 * Ce helper :
 *   - Pose `enrichedAt: new Date()` TOUJOURS (single source of truth Pappers)
 *   - Persiste tous les champs financiers structurés en DB en même temps
 *     (companyRevenue, companyResultNet, companyEtabsCount, companyRecentDepots,
 *     companyHasInsolvency)
 *   - Idempotent : skip si dernier `enrichedAt` < 24h sauf `opts.force`
 *   - Loggue JSON [lead-enrichment-tagging.usage] pour audit
 *
 * Sécurité : update via `lead.updateMany({ where: triggerId })` car un
 * trigger peut avoir plusieurs Leads (cas multi-personae). Le helper agit
 * sur tous les Leads non-deleted du trigger.
 */

const TAGGING_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RECENT_DEPOTS_WINDOW_DAYS = 90;

export interface TaggingResult {
  /** Nombre de Leads mis à jour (peut être >1 si multi-personae) */
  updated: number;
  /** Liste des champs effectivement modifiés (pour log + tests) */
  fields: string[];
  /** True si skip pour idempotence */
  skipped: boolean;
  /** Raison si skipped */
  reason?: string;
}

/**
 * Persiste les données Pappers sur tous les Leads d'un trigger + tag
 * `enrichedAt`. Idempotent.
 *
 * @param triggerId - id du Trigger Prisma. Tous les Leads liés non-deleted seront tagués.
 * @param pappers - payload Pappers retourné par `getEntreprise(siren, ...)`.
 * @param opts.force - bypass le TTL idempotence (défaut false).
 */
export async function markLeadEnrichedFromPappers(
  triggerId: string,
  pappers: Pick<
    PappersEntreprise,
    "finances" | "etablissements" | "depots_actes" | "procedure_collective_en_cours"
  > | null | undefined,
  opts: { force?: boolean } = {},
): Promise<TaggingResult> {
  if (!pappers) {
    return { updated: 0, fields: [], skipped: true, reason: "pappers-payload-null" };
  }

  // Idempotence : si tous les leads du trigger ont enrichedAt < 24h, skip
  // sauf force=true. Évite les double-tags inutiles dans la même fenêtre cron.
  if (!opts.force) {
    const recentTtl = new Date(Date.now() - TAGGING_TTL_MS);
    const recentlyTagged = await db.lead.findFirst({
      where: {
        triggerId,
        deletedAt: null,
        enrichedAt: { gte: recentTtl },
      },
      select: { id: true, enrichedAt: true },
    });
    if (recentlyTagged) {
      return {
        updated: 0,
        fields: [],
        skipped: true,
        reason: `recently-tagged-at-${recentlyTagged.enrichedAt?.toISOString() ?? "?"}`,
      };
    }
  }

  // Extraire les champs depuis le payload Pappers
  const lastFinance = pappers.finances?.[0];
  const ninetyDaysAgo = new Date(Date.now() - RECENT_DEPOTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentDepots = (pappers.depots_actes ?? [])
    .filter((d) => d.date_depot && new Date(d.date_depot) > ninetyDaysAgo)
    .map((d) => ({ date: d.date_depot, type: d.type, decisions: d.decisions }))
    .slice(0, 5);
  const etabsActifs = (pappers.etablissements ?? []).filter((e) => e.actif !== false);

  // Build the update payload — toujours `enrichedAt`, plus les champs disponibles
  const data: Record<string, unknown> = {
    enrichedAt: new Date(),
  };
  const fields: string[] = ["enrichedAt"];

  if (lastFinance?.chiffre_affaires != null) {
    data.companyRevenue = lastFinance.chiffre_affaires;
    fields.push("companyRevenue");
  }
  if (lastFinance?.resultat != null) {
    data.companyResultNet = lastFinance.resultat;
    fields.push("companyResultNet");
  }
  if (etabsActifs.length > 0) {
    data.companyEtabsCount = etabsActifs.length;
    fields.push("companyEtabsCount");
  }
  if (recentDepots.length > 0) {
    data.companyRecentDepots = recentDepots;
    fields.push("companyRecentDepots");
  }
  if (pappers.procedure_collective_en_cours === true) {
    data.companyHasInsolvency = true;
    fields.push("companyHasInsolvency");
  }

  // Update via updateMany — un trigger peut avoir N Leads (multi-personae).
  // On taggue tous les non-deleted.
  const result = await db.lead.updateMany({
    where: { triggerId, deletedAt: null },
    data,
  });

  console.log(
    `[lead-enrichment-tagging.usage] ${JSON.stringify({
      triggerId,
      updated: result.count,
      fields,
      hasFinances: !!lastFinance,
      hasInsolvency: pappers.procedure_collective_en_cours === true,
    })}`,
  );

  return { updated: result.count, fields, skipped: false };
}
