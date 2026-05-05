import "server-only";
import { db } from "@/lib/db";
import type { Prisma, TriggerType } from "@prisma/client";
import { invalidateTriggerForRequalify } from "@/lib/requalify-engine";

/**
 * Combo cross-sources : si une même boîte a 2+ Triggers de sources différentes
 * dans la fenêtre dynamique (14-60j selon type-pair), on flag isCombo=true et
 * on boost score +2 (cap 10).
 *
 * Sprint 6 v2 (05/05/2026) :
 *   - Fenêtre dynamique 30j → 60j max + per-pair narrowing (cf. COMBO_WINDOW_DAYS)
 *   - Combo rétrospectif : les Triggers du groupe DÉJÀ jugés sont invalidés
 *     (scoreReason=null) pour que qualifyPendingTriggers re-pickup et bénéficie
 *     du PRIOR SIGNALS bloc côté qualify-trigger.ts
 *
 * Exemples de combo :
 *   - Levée Rodz + Hire QA TheirStack → "scaling post-funding" (14j window)
 *   - Hire CTO bot trigger-engine + Levée RSS → "leadership change pre-funding" (30j)
 *   - M&A + Restructuring → "consolidation post-deal" (60j)
 *
 * + Pattern spécial SCALE-UP-TECH (Bougie 4, 04/05) : si combo = (FUNDRAISING
 * ou CAPITAL_INCREASE) + ≥1 HIRING_KEY tech (dev/engineer/qa/devops/etc),
 * on force score=10, isHot=true et reason explicit "scale-up-tech".
 * C'est le pattern le plus puissant pour DTL : levée + scale équipe dev =
 * besoin QA externe vital pour scaler sans casser.
 *
 * Tourne périodiquement (toutes les 30 min via /api/internal/run-pollers).
 */

/**
 * Fenêtre dynamique combo selon paire de types (jours max d'écart).
 * Clé = paire triée alphabétiquement de TriggerType ("|" séparateur).
 * Si paire absente → fallback DEFAULT_COMBO_WINDOW_DAYS (30j).
 *
 * Logique :
 *   - 14j : couples très urgents (post-funding hire = budget frais à activer)
 *   - 30j : couples standards (funding + leadership change)
 *   - 60j : couples lents (M&A + restructuring, expansion strategique)
 */
const DEFAULT_COMBO_WINDOW_DAYS = 30;
const MAX_FETCH_WINDOW_DAYS = 60; // largest pair window — bound for query

const COMBO_WINDOW_DAYS: Record<string, number> = {
  // Tight (14j) — urgence maximale
  "FUNDRAISING|HIRING_KEY": 14,
  "CAPITAL_INCREASE|HIRING_KEY": 14,
  // Standard (30j) — défaut implicite, listé pour lisibilité
  "FUNDRAISING|LEADERSHIP_CHANGE": 30,
  "HIRING_KEY|LEADERSHIP_CHANGE": 30,
  // Slow (60j) — M&A et expansion sont des signaux à long terme
  "FUNDRAISING|EXPANSION": 60,
  "EXPANSION|HIRING_KEY": 60,
  "REGULATORY|HIRING_KEY": 60,
};

function pairKey(a: TriggerType, b: TriggerType): string {
  return [a, b].sort().join("|");
}

function getComboWindowDays(types: TriggerType[]): number {
  if (types.length < 2) return DEFAULT_COMBO_WINDOW_DAYS;
  // Plus restrictif des window applicables si plusieurs paires (combo 3+ types).
  let minWindow = MAX_FETCH_WINDOW_DAYS;
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const a = types[i];
      const b = types[j];
      if (a == null || b == null) continue;
      const w = COMBO_WINDOW_DAYS[pairKey(a, b)] ?? DEFAULT_COMBO_WINDOW_DAYS;
      minWindow = Math.min(minWindow, w);
    }
  }
  return minWindow;
}

const TECH_HIRING_KEYWORDS = /\b(dev|engineer|tech|qa|devops|sre|fullstack|backend|frontend|data|machine learning|ml|ai|software|architect|cto|vp eng|head of eng|lead|product manager|po|product owner)\b/i;

const SCALE_UP_TECH_MARKER = "[SCALE-UP-TECH]";

export async function detectCombosForClient(
  clientId: string,
): Promise<{ scanned: number; combos: number; updated: number; scaleUpTech: number; retroInvalidated: number }> {
  // Sprint 6 v2 : fetch sur la fenêtre la PLUS large (60j) puis narrow per-pair
  // côté logique. Indexé sur (clientId, capturedAt) → query rapide.
  const since = new Date();
  since.setDate(since.getDate() - MAX_FETCH_WINDOW_DAYS);

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
      capturedAt: true,
    },
    orderBy: { capturedAt: "desc" },
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
  let retroInvalidated = 0;

  for (const [, items] of groups) {
    const sources = new Set(items.map((t) => sourcePrefix(t.sourceCode)));
    if (sources.size < 2) continue;

    // Sprint 6 v2 — Fenêtre dynamique : on ne déclare un combo que si le delta
    // entre le 1er et le dernier trigger du groupe est dans la fenêtre permise
    // par la paire de types la plus restrictive. Évite les faux combos sur
    // saga (funding + hire 50j après = pas un combo urgent).
    const types = Array.from(new Set(items.map((t) => t.type)));
    const windowDays = getComboWindowDays(types as TriggerType[]);
    const sortedByDate = [...items].sort(
      (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
    );
    const oldest = sortedByDate[0]!;
    const newest = sortedByDate[sortedByDate.length - 1]!;
    const deltaDays = (newest.capturedAt.getTime() - oldest.capturedAt.getTime()) / 86400_000;
    if (deltaDays > windowDays) {
      // Trop espacé pour être un combo significatif sur cette paire.
      // (Note : on continue d'évaluer le groupe au cas où un sous-set récent
      // formerait un combo, mais on garde simple pour V2 — pruner si nécessaire.)
      continue;
    }

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
      // Flag isCombo=true sur les autres + Sprint 6 v2 : invalider les triggers
      // déjà jugés du groupe (scoreReason rempli) pour qu'ils re-jugent avec
      // le contexte combo (PRIOR SIGNALS bloc côté qualify-trigger.ts).
      for (const other of items) {
        if (other.id === target.id) continue;
        if (!other.isCombo) {
          await db.trigger.update({ where: { id: other.id }, data: { isCombo: true } });
        }
        if (other.scoreReason) {
          await invalidateTriggerForRequalify(other.id, "combo-retroactive-scale-up-tech");
          retroInvalidated += 1;
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
      // Fix M1 (04/05) — Préserver le scoreReason d'Opus en concaténant.
      // Avant : "Combo détecté : rodz + apify sur X" écrasait totalement la
      // justification ICP fine d'Opus → traçabilité perdue, le commercial ne
      // sait plus pourquoi le lead était bon à la base.
      const comboLabel = `[Combo ${[...sources].join("+")}]`;
      const preservedReason = target.scoreReason
        ? `${comboLabel} ${target.scoreReason}`.slice(0, 500)
        : `${comboLabel} sur ${target.companyName}`;
      await db.trigger.update({
        where: { id: target.id },
        data: {
          isCombo: true,
          score: newScore,
          isHot,
          scoreReason: preservedReason,
        },
      });
      // Flag isCombo=true sur les autres + Sprint 6 v2 : invalider les triggers
      // déjà jugés du groupe (scoreReason rempli) pour qu'ils re-jugent avec
      // le contexte combo (PRIOR SIGNALS bloc côté qualify-trigger.ts).
      for (const other of items) {
        if (other.id === target.id) continue;
        if (!other.isCombo) {
          await db.trigger.update({
            where: { id: other.id },
            data: { isCombo: true },
          });
        }
        if (other.scoreReason) {
          await invalidateTriggerForRequalify(other.id, "combo-retroactive-generic");
          retroInvalidated += 1;
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

  return { scanned: triggers.length, combos, updated, scaleUpTech, retroInvalidated };
}
