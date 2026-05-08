import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { qualifyTrigger } from "@/lib/qualify-trigger";

/**
 * Sprint 3 (05/05/2026) — Re-qualify engine.
 *
 * Deux flux complémentaires pour ne plus laisser un Trigger figé sur un
 * mauvais verdict après que le Lead se soit enrichi :
 *
 *   1. invalidateTriggerForRequalify(triggerId, reason)
 *      Appelé par les enrichers (HarvestAPI Profile Full, Rodz job-changes,
 *      LinkedIn Finder) quand ils remplissent un champ persona-déterminant
 *      (linkedinProfileJson, fullName+jobTitle première fois, linkedinUrl
 *      résolu pour la 1re fois). Pose scoreReason=null + status=NEW (si
 *      C3 below_min_score) pour que qualifyPendingTriggers() repickup au
 *      prochain run avec la nouvelle data.
 *
 *   2. recoverIgnoredTriggersForClient(clientId)
 *      Sweep quotidien : trouve les Triggers status=IGNORED dont le Lead
 *      a un linkedinProfileJson volumineux (post-enrichissement). Force
 *      re-qualify. Si le verdict reste IGNORED → annote. Si le verdict
 *      remonte → annote [RECOVERED] et le trigger redevient visible.
 *
 * Audit Phase 1 du 05/05 : 22 leads ARCHIVED sur DTL avec score≥8 et
 * linkedinProfileJson volumineux = trésor potentiel à récupérer.
 */

interface RequalifyResult {
  candidates: number;
  revived: number;
  stillIgnored: number;
  errors: number;
  details: Array<{ triggerId: string; oldScore: number; newScore: number; outcome: string }>;
}

/**
 * Marque un Trigger pour requalification. Idempotent.
 *
 * Si le Trigger était IGNORED → repasse à NEW (lui redonne sa chance).
 * Si NEW → on touche juste scoreReason pour que qualifyPendingTriggers
 *   le pickup (la query filtre `where scoreReason IS NULL`).
 */
export async function invalidateTriggerForRequalify(
  triggerId: string,
  reason: string,
): Promise<void> {
  try {
    await db.trigger.update({
      where: { id: triggerId },
      data: {
        scoreReason: null,
        status: "NEW",
      },
    });
    console.log(`[requalify-engine.invalidate] ${triggerId} reason=${reason}`);
  } catch (e) {
    // Trigger soft-deleted ou inexistant — silent skip pour ne pas casser
    // le flow d'enrichissement appelant.
    console.warn(
      `[requalify-engine.invalidate] skip ${triggerId} (${reason}):`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Sweep recovery sur les triggers IGNORED dont le Lead a un profil LinkedIn
 * suffisamment riche pour mériter un nouveau jugement.
 *
 * Critères :
 *   - Trigger.status = IGNORED
 *   - Trigger.deletedAt = null (pas insolvency-archived)
 *   - Lead lié existe avec linkedinProfileJson non vide
 *   - JSON.stringify(linkedinProfileJson).length >= minLinkedinJsonLength (3000c défaut)
 *
 * Pour chaque candidat : reset (scoreReason=null + status=NEW) puis call
 * qualifyTrigger(force=true). Le judge re-évalue avec les blocs
 * PERSONA QUAL + LinkedIn Profile + COMPANY HEALTH (Sprint 1+2).
 * Si C3 below_min_score se redéclenche → status reste IGNORED, on annote.
 * Sinon le trigger redevient NEW + on annote [RE-JUDGED v2 X→Y RECOVERED].
 */
export async function recoverIgnoredTriggersForClient(
  clientId: string,
  opts: { limit?: number; minLinkedinJsonLength?: number; dryRun?: boolean } = {},
): Promise<RequalifyResult> {
  const limit = opts.limit ?? 30;
  const minJsonLength = opts.minLinkedinJsonLength ?? 3000;

  // On fetch large puis on filtre par taille JSON in-process (pas faisable
  // en SQL Prisma sans raw query, et le set est petit en pratique).
  // Approche : query côté Lead (1:1 avec Trigger via triggerId @unique),
  // simpler typing pour Prisma JSON filter sur `linkedinProfileJson`.
  // Sprint D fix anti-rebond (07/05/2026 nuit) — empêche la boucle infinie.
  //
  // Avant ce fix : à chaque cycle horaire, recoverIgnoredTriggersForClient
  // re-jugeait les MÊMES 26 triggers DTL (status=IGNORED + linkedinProfileJson
  // rich) qui restaient IGNORED après chaque tentative. Bug : aucun mécanisme
  // pour éviter les re-essais. Résultat : 410 calls Opus/jour gaspillés en
  // boucle (~$12/jour, ~85% du burn Anthropic observé).
  //
  // Fix Option A : on EXCLUT les triggers dont le scoreReason commence déjà
  // par "[RE-JUDGED" — c'est-à-dire ceux qu'on a DÉJÀ tenté de récupérer.
  // Ils ne seront re-tentés que si :
  //   (a) un nouvel enrichissement les remet à status=NEW + scoreReason=null
  //       via invalidateTriggerForRequalify (linkedinProfileJson nouvellement
  //       résolu, combo retroactif détecté) → comportement souhaité
  //   (b) une intervention manuelle reset scoreReason
  //
  // Triggers dont scoreReason commence par "[C3 below_min_score" ou autre
  // (= IGNORED jamais tenté par recover) restent éligibles à 1 tentative.
  const richLeads = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      linkedinProfileJson: { not: Prisma.JsonNull },
      triggerId: { not: null },
      trigger: {
        is: {
          status: "IGNORED",
          deletedAt: null,
          scoreReason: { not: { startsWith: "[RE-JUDGED" } },
        },
      },
    },
    select: {
      triggerId: true,
      linkedinProfileJson: true,
      trigger: {
        select: {
          id: true,
          score: true,
          scoreReason: true,
          sourceCode: true,
        },
      },
    },
    take: limit * 3,
  });

  const eligible = richLeads
    .filter((l) => {
      const json = l.linkedinProfileJson;
      if (json == null) return false;
      try {
        return JSON.stringify(json).length >= minJsonLength;
      } catch {
        return false;
      }
    })
    .slice(0, limit)
    .map((l) => l.trigger)
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const stats: RequalifyResult = {
    candidates: eligible.length,
    revived: 0,
    stillIgnored: 0,
    errors: 0,
    details: [],
  };

  for (const t of eligible) {
    const oldScore = t.score;

    if (opts.dryRun) {
      stats.details.push({
        triggerId: t.id,
        oldScore,
        newScore: -1,
        outcome: "DRY-RUN (would-rejudge)",
      });
      continue;
    }

    // Helper rollback — restaure status=IGNORED + scoreReason annoté
    // [RE-JUDGED-FAILED] pour empêcher l'état limbo (NEW + scoreReason=null)
    // si qualifyTrigger plante après le reset. Filtre anti-boucle existant
    // (richLeads.where.scoreReason.not.startsWith("[RE-JUDGED")) exclut
    // automatiquement ces triggers du prochain sweep recover.
    const rollbackToIgnored = async (reasonDetail: string): Promise<void> => {
      await db.trigger.update({
        where: { id: t.id },
        data: {
          status: "IGNORED",
          scoreReason: `[RE-JUDGED v2 ${oldScore}→? FAILED] ${reasonDetail}`.slice(0, 500),
        },
      }).catch(() => {});
    };

    try {
      await db.trigger.update({
        where: { id: t.id },
        data: { scoreReason: null, status: "NEW" },
      });
      const result = await qualifyTrigger(t.id, { force: true });
      if (!result) {
        // BUG ALDEMIA fix (08/05) — qualifyTrigger retourné null = Anthropic
        // down, persistance échouée, ou autre. Rollback explicite à IGNORED
        // pour ne pas laisser le trigger en limbo NEW + scoreReason=null.
        await rollbackToIgnored("qualifyTrigger returned null (Anthropic down ou erreur silencieuse)");
        stats.errors += 1;
        stats.details.push({ triggerId: t.id, oldScore, newScore: -1, outcome: "ERROR" });
        continue;
      }
      // qualifyTrigger pose lui-même status=IGNORED si C3 below_min_score
      const after = await db.trigger.findUnique({
        where: { id: t.id },
        select: { status: true, scoreReason: true },
      });
      if (after?.status === "IGNORED") {
        // Reste rejeté → annote pour audit
        const annotated = `[RE-JUDGED v2 ${oldScore}→${result.opusScore} still-IGNORED] ${result.reason}`.slice(0, 500);
        await db.trigger.update({
          where: { id: t.id },
          data: { scoreReason: annotated },
        });
        stats.stillIgnored += 1;
        stats.details.push({
          triggerId: t.id,
          oldScore,
          newScore: result.opusScore,
          outcome: "still-IGNORED",
        });
      } else {
        // Promu NEW
        const annotated = `[RE-JUDGED v2 ${oldScore}→${result.opusScore} RECOVERED] ${result.reason}`.slice(0, 500);
        await db.trigger.update({
          where: { id: t.id },
          data: { scoreReason: annotated },
        });
        stats.revived += 1;
        stats.details.push({
          triggerId: t.id,
          oldScore,
          newScore: result.opusScore,
          outcome: "RECOVERED",
        });
        console.log(
          `[requalify-engine.recover] ${t.id} (${t.sourceCode}): ${oldScore} → ${result.opusScore} RECOVERED`,
        );
      }
    } catch (e) {
      // BUG ALDEMIA fix (08/05) — exception lors de qualifyTrigger →
      // rollback explicite à IGNORED. Sans ça, le trigger reste en limbo
      // NEW + scoreReason=null avec son ancien score (cas observé : ALDEMIA
      // score=1 NEW visible dans le dashboard alors que IGNORED par qualif).
      const errMsg = e instanceof Error ? e.message : String(e);
      await rollbackToIgnored(errMsg);
      stats.errors += 1;
      stats.details.push({ triggerId: t.id, oldScore, newScore: -1, outcome: "ERROR" });
      console.warn(
        `[requalify-engine.recover] err ${t.id}:`,
        errMsg,
      );
    }
  }

  return stats;
}

