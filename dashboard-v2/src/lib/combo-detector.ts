import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Combo cross-sources : si une même boîte a 2+ Triggers de sources différentes
 * dans les 30 derniers jours, on flag isCombo=true et on boost score +2 (cap 10).
 *
 * Exemples de combo :
 *   - Levée Rodz + Hire QA TheirStack → "scaling post-funding"
 *   - Hire CTO bot trigger-engine + Levée RSS → "leadership change pre-funding"
 *
 * + Pattern spécial SCALE-UP-TECH (Bougie 4, 04/05) : si combo = (FUNDRAISING
 * ou CAPITAL_INCREASE) + ≥1 HIRING_KEY tech (dev/engineer/qa/devops/etc),
 * on force score=10, isHot=true et reason explicit "scale-up-tech".
 * C'est le pattern le plus puissant pour DTL : levée + scale équipe dev =
 * besoin QA externe vital pour scaler sans casser.
 *
 * Tourne périodiquement (toutes les 30 min via /api/internal/run-pollers).
 */

const TECH_HIRING_KEYWORDS = /\b(dev|engineer|tech|qa|devops|sre|fullstack|backend|frontend|data|machine learning|ml|ai|software|architect|cto|vp eng|head of eng|lead|product manager|po|product owner)\b/i;

const SCALE_UP_TECH_MARKER = "[SCALE-UP-TECH]";

export async function detectCombosForClient(
  clientId: string,
): Promise<{ scanned: number; combos: number; updated: number; scaleUpTech: number }> {
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
      type: true,
      title: true,
      scoreReason: true,
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
  let scaleUpTech = 0;

  for (const [, items] of groups) {
    const sources = new Set(items.map((t) => sourcePrefix(t.sourceCode)));
    const isCombo = sources.size >= 2;
    if (!isCombo) continue;

    combos += 1;
    // Boost +2 sur le PREMIER trigger du groupe (résultats déjà ordonnés capturedAt desc côté DB)
    const target = items[0];
    if (!target) continue;

    // ──────────────────────────────────────────────────────────────────
    // Pattern SCALE-UP-TECH : (funding ou capital-increase) + hire tech
    // ──────────────────────────────────────────────────────────────────
    const hasFunding = items.some(
      (t) => t.type === "FUNDRAISING" || t.type === "CAPITAL_INCREASE",
    );
    const techHires = items.filter(
      (t) => t.type === "HIRING_KEY" && TECH_HIRING_KEYWORDS.test(t.title),
    );
    const isScaleUpTech = hasFunding && techHires.length >= 1;

    if (isScaleUpTech) {
      scaleUpTech += 1;
      const fundingTrigger = items.find((t) => t.type === "FUNDRAISING" || t.type === "CAPITAL_INCREASE");
      const fundingTitle = fundingTrigger?.title ?? "Levée";
      const techTitlesPreview = techHires
        .slice(0, 2)
        .map((t) => t.title.replace(/\s*\(QA match\)\s*$/, ""))
        .join(" + ");
      const newReason = `${SCALE_UP_TECH_MARKER} ${fundingTitle} + hire tech (${techTitlesPreview}) sur ${target.companyName} — scale post-funding = besoin QA externe vital pour scaler sans casser`.slice(0, 500);

      // Skip si déjà boosté scale-up-tech (idempotence)
      if (target.scoreReason?.includes(SCALE_UP_TECH_MARKER) && target.score >= 10 && target.isCombo) {
        // déjà à jour
        for (const other of items) {
          if (other.id !== target.id && !other.isCombo) {
            await db.trigger.update({ where: { id: other.id }, data: { isCombo: true } });
          }
        }
        continue;
      }

      await db.trigger.update({
        where: { id: target.id },
        data: {
          isCombo: true,
          score: 10,
          isHot: true,
          scoreReason: newReason,
        },
      });
      // Flag isCombo=true sur les autres aussi
      for (const other of items) {
        if (other.id !== target.id && !other.isCombo) {
          await db.trigger.update({ where: { id: other.id }, data: { isCombo: true } });
        }
      }
      // Invalider pitch/brief sur le lead lié (sera régénéré avec contexte scale-up)
      try {
        await db.lead.updateMany({
          where: { triggerId: target.id, deletedAt: null },
          data: {
            briefJson: null as unknown as Prisma.InputJsonValue,
            briefGeneratedAt: null,
            pitchJson: null as unknown as Prisma.InputJsonValue,
            pitchGeneratedAt: null,
          },
        });
      } catch {
        // best effort
      }
      updated += 1;
      continue;
    }

    // Combo générique (existant)
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

      // Invalider briefJson + pitchJson sur le Lead lié au target (audit 30/04)
      // pour forcer régénération avec contexte combo. Sinon le pitch reste figé
      // sur le 1er signal et ne mentionne pas les autres sources convergentes.
      // Le commercial qui clique "regénérer" récupère un pitch enrichi des 2+ angles.
      try {
        await db.lead.updateMany({
          where: { triggerId: target.id, deletedAt: null },
          data: {
            briefJson: null as unknown as Prisma.InputJsonValue,
            briefGeneratedAt: null,
            pitchJson: null as unknown as Prisma.InputJsonValue,
            pitchGeneratedAt: null,
          },
        });
      } catch {
        // best effort — l'invalidation est cosmétique
      }
    }
  }

  return { scanned: triggers.length, combos, updated, scaleUpTech };
}
