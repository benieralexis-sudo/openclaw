import "server-only";
import { db } from "@/lib/db";

/**
 * Combo cross-sources : si une même boîte a 2+ Triggers de sources différentes
 * dans les 30 derniers jours, on flag isCombo=true et on boost score +2 (cap 10).
 *
 * Exemples de combo :
 *   - Levée Rodz + Hire QA TheirStack → "scaling post-funding"
 *   - Hire CTO bot trigger-engine + Levée RSS → "leadership change pre-funding"
 *
 * Tourne périodiquement (toutes les 30 min via /api/internal/run-pollers).
 */

export async function detectCombosForClient(
  clientId: string,
): Promise<{ scanned: number; combos: number; updated: number }> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  // Group triggers par companySiret (ou companyName si pas de SIRET) sur 30j
  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      capturedAt: { gte: since },
      deletedAt: null,
    },
    select: {
      id: true,
      companyName: true,
      companySiret: true,
      sourceCode: true,
      score: true,
      isCombo: true,
    },
  });

  // Clé d'identification entreprise : SIRET prioritaire, sinon nom normalisé
  const groupKey = (t: { companySiret: string | null; companyName: string }) =>
    t.companySiret ?? t.companyName.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Premier passage : préfixe source (rodz / theirstack / trigger-engine / apify)
  const sourcePrefix = (sc: string) => sc.split(".")[0];

  // Group + détection
  const groups = new Map<string, typeof triggers>();
  for (const t of triggers) {
    const key = groupKey(t);
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  let combos = 0;
  let updated = 0;

  for (const [, items] of groups) {
    const sources = new Set(items.map((t) => sourcePrefix(t.sourceCode)));
    const isCombo = sources.size >= 2;
    if (!isCombo) continue;

    combos += 1;
    // Boost +2 sur le PREMIER trigger du groupe (résultats déjà ordonnés capturedAt desc côté DB)
    const target = items[0];
    if (!target) continue;

    if (!target.isCombo || target.score < Math.min(10, target.score + 2)) {
      const newScore = Math.min(10, target.score + 2);
      const isHot = newScore >= 9;
      await db.trigger.update({
        where: { id: target.id },
        data: {
          isCombo: true,
          score: newScore,
          isHot,
          scoreReason: `Combo détecté : ${[...sources].join(" + ")} sur ${target.companyName}`,
        },
      });
      // Flag isCombo=true sur les autres aussi (pour traçabilité)
      for (const other of items) {
        if (other.id !== target.id && !other.isCombo) {
          await db.trigger.update({
            where: { id: other.id },
            data: { isCombo: true },
          });
        }
      }
      updated += 1;
    }
  }

  return { scanned: triggers.length, combos, updated };
}
