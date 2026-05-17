import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollTheirstackForClient, pollTheirstackBuyingIntentForClient, enrichRecentTriggersWithSirene } from "@/lib/theirstack-poller";
import { pollApifyForClient } from "@/lib/apify-poller";
import { qualifyPendingTriggers } from "@/lib/qualify-trigger";
import { detectCombosForClient } from "@/lib/combo-detector";
import { recomputePriorityScoresForClient } from "@/lib/priority-scoring-runner";
import { recomputeFitScoresForClient } from "@/lib/persona-fit-runner";
import { recomputePersonaTierFromHeadlineForClient } from "@/lib/recompute-persona-tier-from-headline-runner";
import { enrichDirigeantsForClient } from "@/lib/enrich-lead-dirigeants";
import { enrichDecisionMakersForClient } from "@/lib/harvestapi-decision-makers";
import { enrichLeadsViaFullEnrich } from "@/lib/enrich-via-fullenrich";
// Dropcontact RÉACTIVÉ 17/05/2026 (Sprint Persona Excellence) :
// 64% des leads créés ces 30j sont sans email. Dropcontact RGPD-strict
// (qualification='valid'/'ok' + filtre domaines perso) couvre une partie
// de ce trou avant le fallback Kaspr+FullEnrich. 416 crédits dispos.
import { enrichLeadsViaDropcontact } from "@/lib/enrich-via-dropcontact";
import { detectDeclarativePainForClient } from "@/lib/declarative-pain";
import { ensureLeadsForAllTriggers } from "@/lib/ensure-lead-for-trigger";
// Audit fix B.1.3 (06/05) — enrichLinkedInProfilesForClient n'était appelé
// par PERSONNE (route /api/internal/enrich-linkedin-profiles existe mais
// aucun cron ne la frappe — ancien clay-linkedin-cron disabled 06/04).
// Conséquence : Sprint 2 B.2 inerte (0 leads avec linkedinProfileJson dense).
// Wire-le ici en source=all (pipeline complet 6h) pour que le judge bénéficie
// du parsing LinkedIn Profile Full sur les leads chauds.
import { enrichLinkedInProfilesForClient } from "@/lib/enrich-linkedin-profile-runner";
import { isSignalEnabled } from "@/lib/signal-config";
import { syncEmailActivitiesToLeadActivity } from "@/lib/lead-activity";
import { auditAndHeal } from "@/lib/audit-heal";
import { mergeLeadsBySiret } from "@/lib/lead-cross-source";
import { enrichLeadsViaRodz } from "@/lib/enrich-via-rodz";
import { enrichLeadsViaKasprDirect } from "@/lib/enrich-via-kaspr-direct";
import { enrichLeadsViaLinkedInFinder } from "@/lib/enrich-via-linkedin-finder";
import { mergeDuplicatePersonaLeads } from "@/lib/dedup-persona-leads";
import { detectGrowthAlertsForClient } from "@/lib/growth-detector";
import { scanQaStuckForClient } from "@/lib/qa-stuck-scanner";
import { pollFranceTravailForClient } from "@/lib/francetravail-poller";
import { pollRssLeveesForClient } from "@/lib/rss-levees-poller";
import { pollBodaccForClient } from "@/lib/bodacc-poller";
import { pollInpiForClient } from "@/lib/inpi-poller";
import { pollJoafeForClient } from "@/lib/joafe-poller";
import { autoGenerateBriefsForHotLeads } from "@/lib/auto-generate-briefs";
// Email pattern DIY — endpoint désactivé 29/04 (risque réputation Primeforge).
// Lib enrich-via-email-pattern conservée pour réactivation post-MillionVerifier.
import { recomputeDataQualityForClient } from "@/lib/recompute-data-quality";
import { recoverIgnoredTriggersForClient } from "@/lib/requalify-engine";
import { notifyAdmin } from "@/lib/telegram-alert";

// Documente l'intention de durée max — Next.js self-hosted ignore mais utile
// pour Vercel + lisibilité humaine. Cohérent avec le timeout cron 15 min côté
// telegram-router (skills/trigger-engine/cron.js).
export const maxDuration = 900; // 15 min

/**
 * Route cron interne — déclenche TheirStack + Apify pour tous les clients actifs
 * avec ICP. Protégée par header `x-cron-secret` (env CRON_SECRET).
 *
 * Appelée par le bot trigger-engine (gateway/telegram-router) toutes les 6h.
 *
 * Query params :
 *   - source=theirstack|apify|all (défaut: all)
 *   - clientId=xxx (défaut: tous les clients actifs avec ICP)
 *   - dryRun=true|false
 */
// Lock global pour éviter chevauchement (audit 30/04 nuit) — cron 1h vs run
// pouvant prendre 8-15 min, on évite que 2 runs tournent en // s'il y a du
// retard. Lock TTL 90 min (cron 1h + buffer). Si ?force=true, bypass le lock.
let runPollersLock: { acquiredAt: number; runId: string } | null = null;
const LOCK_TTL_MS = 90 * 60 * 1000;

function tryAcquireLock(force: boolean): { ok: true; runId: string } | { ok: false; lockedAt: number; ageMinutes: number } {
  const now = Date.now();
  if (runPollersLock && !force) {
    const age = now - runPollersLock.acquiredAt;
    if (age < LOCK_TTL_MS) {
      return { ok: false, lockedAt: runPollersLock.acquiredAt, ageMinutes: Math.round(age / 60_000) };
    }
    // Lock expiré → on le casse et on en prend un nouveau
  }
  const runId = `run-${now}-${Math.random().toString(36).slice(2, 8)}`;
  runPollersLock = { acquiredAt: now, runId };
  return { ok: true, runId };
}

function releaseLock(runId: string): void {
  if (runPollersLock?.runId === runId) {
    runPollersLock = null;
  }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "all";
  const targetClientId = url.searchParams.get("clientId");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";

  // Acquire lock (anti-chevauchement)
  const lock = tryAcquireLock(force);
  if (!lock.ok) {
    return NextResponse.json(
      {
        error: "run_pollers_locked",
        message: `Un run-pollers tourne déjà depuis ${lock.ageMinutes} min. Utiliser ?force=true pour bypass.`,
        lockedAt: new Date(lock.lockedAt).toISOString(),
      },
      { status: 423 },
    );
  }
  const runId = lock.runId;

  // Le reste de la fonction est wrappé try/finally pour garantir releaseLock
  try {
  const clients = targetClientId
    ? await db.client.findMany({ where: { id: targetClientId, deletedAt: null }, select: { id: true, name: true, icp: true } })
    : await db.client.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "PROSPECT"] } }, select: { id: true, name: true, icp: true } });

  const summary: Array<{ client: string; theirstack?: unknown; apify?: unknown; sireneEnriched?: number; opusQualified?: number; error?: string; skipped?: string }> = [];

  for (const c of clients) {
    const entry: { client: string; theirstack?: unknown; apify?: unknown; sireneEnriched?: number; opusQualified?: number; error?: string; skipped?: string } = { client: c.name };
    if (!c.icp) {
      entry.skipped = "no icp";
      summary.push(entry);
      continue;
    }
    try {
      // TheirStack job-offer DÉSACTIVÉ jusqu'au 26/05 (audit 10/05 19h) —
      // quota tendu 4701/5200 cr (90%), 16j restants à 31 cr/j budget max.
      // On garde seulement buying-intent (gate UTC=12+18 ci-dessous, plus
      // précis selon mémoire 05/05 : 100% des Pépites historiques 28/04+04/05
      // captées via buying-intent 12h ou 18h UTC).
      // source=theirstack manuel reste autorisé pour debug/rattrapage.
      // Réactiver après reset 26/05 en retirant la condition false.
      const theirstackHour = new Date().getUTCHours();
      const theirstackJobOfferEnabled = false; // ← réactiver après 26/05
      if (source === "theirstack" || (theirstackJobOfferEnabled && source === "all" && theirstackHour === 18)) {
        entry.theirstack = await pollTheirstackForClient(c.id, { dryRun, jobsLimit: 30, companiesLimit: 15 });
      }
      // Buying-intent QA (Bougie 2 — 04/05, gate aligné cron 15/05).
      // Audit 05/05 : cron run-pollers tourne 24×/j, le commentaire d'origine
      // "cron 6h ~45 cr/j" était faux → 1080 cr/j théorique, conso réelle
      // ~960 cr/j (76% du quota mensuel 5200 atteint en 10j). Gate horaire
      // ramène à ~90 cr/j en gardant une fenêtre de rattrapage si VPS down
      // sur une exécution.
      //
      // Fix B9.1 (15/05/2026) — Le cron run-pollers-all tourne à 8h05 + 18h05
      // UTC (cf. `scripts/run-pollers-all-cron.sh` crontab). L'ancienne gate
      // `12 || 18` ne déclenchait QUE 18h (12h n'a jamais de cron) → 1×/j
      // au lieu de 2×/j. Burn TheirStack effectif 45/j au lieu de 90 attendu.
      // Maintenant : `8 || 18` aligné sur le cron réel → 2×/j effectif.
      // Note : 8h05 UTC = 10h Paris (DST), TheirStack a réindexé pendant la
      // nuit FR, captures matin OK.
      const buyingIntentHour = new Date().getUTCHours();
      // Sprint catalogue P2.1 (17/05/2026) — Catalogue ClientSignalConfig est
      // la seule source de vérité. Le check legacy icp.disabledSources a été
      // retiré (source-toggle.ts supprimé) après finalisation du wiring.
      const catalogEnabled = await isSignalEnabled(c.id, "P3");
      if (!dryRun && source === "all" && (buyingIntentHour === 8 || buyingIntentHour === 18)) {
        if (!catalogEnabled) {
          (entry as { theirstackBuyingIntent?: string }).theirstackBuyingIntent =
            "disabled-by-catalog-P3";
        } else {
          try {
            (entry as { theirstackBuyingIntent?: unknown }).theirstackBuyingIntent =
              await pollTheirstackBuyingIntentForClient(c.id, { companiesLimit: 15 });
          } catch (e) {
            (entry as { theirstackBuyingIntentError?: string }).theirstackBuyingIntentError =
              e instanceof Error ? e.message : String(e);
          }
        }
      }
      // France Travail (Bougie 5 — 04/05) : poller gratuit (3000 req/jour).
      // Codes ROME M180* (info) + filtre tech strict + dédup cross-source.
      // Tourne sur source=all (cron 6h, lookback 24h glissante = pas de
      // doublons même si tourné 4×/jour théoriquement).
      if (!dryRun && source === "all") {
        try {
          (entry as { francetravail?: unknown }).francetravail =
            await pollFranceTravailForClient(c.id, { lookbackHours: 24 });
        } catch (e) {
          (entry as { francetravailError?: string }).francetravailError =
            e instanceof Error ? e.message : String(e);
        }
      }
      // Sprint 1 (10/05) — Sources migrees du bot trigger-engine.
      // Strategie : on shutdown progressivement le bot. Ces pollers reprennent
      // la collecte des sources uniques (BODACC/INPI/RSS-levees/JOAFE).
      // RSS-levees : 1h cron (signal levee fraiche <14j = ULTRA fort).
      if (!dryRun && (source === "all" || source === "rss-levees")) {
        try {
          (entry as { rssLevees?: unknown }).rssLevees =
            await pollRssLeveesForClient(c.id);
        } catch (e) {
          (entry as { rssLeveesError?: string }).rssLeveesError =
            e instanceof Error ? e.message : String(e);
        }
      }
      // BODACC : annonces commerciales. API publique sans auth, MAJ quotidienne 03h.
      // Cron 3h. Filtre type : capital_increase (signal levee pre-officiel),
      // company_merger (scaling), modification_statuts. Skip cessation/RJ/LJ.
      if (!dryRun && (source === "all" || source === "bodacc")) {
        try {
          (entry as { bodacc?: unknown }).bodacc =
            await pollBodaccForClient(c.id, { lookbackDays: 7, limit: 100 });
        } catch (e) {
          (entry as { bodaccError?: string }).bodaccError =
            e instanceof Error ? e.message : String(e);
        }
      }
      // INPI : depots marques (signal "nouveau produit" 6-12 mois avant launch).
      // Auth multi-step (XSRF + login). 1x/jour suffit (indexation INPI hebdo).
      //
      // Fix gate timing (14/05/2026) — Avant : UTCHours===4 mais aucun cron à
      // 4h UTC dans le crontab (run-pollers-all tourne à 08:05 + 18:05 UTC).
      // INPI jamais déclenché en pratique. Maintenant : UTCHours===8 pour
      // matcher le cron matinal.
      const inpiHour = new Date().getUTCHours();
      if (!dryRun && (source === "inpi" || (source === "all" && inpiHour === 8))) {
        try {
          (entry as { inpi?: unknown }).inpi =
            await pollInpiForClient(c.id, { lookbackDays: 30 });
        } catch (e) {
          (entry as { inpiError?: string }).inpiError =
            e instanceof Error ? e.message : String(e);
        }
      }
      // JOAFE : STUB Sprint 1 (associations/fondations, ROI faible pour ICP DTL).
      // Voir joafe-poller.ts header pour decision detaillee.
      if (!dryRun && source === "joafe") {
        try {
          (entry as { joafe?: unknown }).joafe = await pollJoafeForClient(c.id);
        } catch (e) {
          (entry as { joafeError?: string }).joafeError =
            e instanceof Error ? e.message : String(e);
        }
      }
      if (source === "all" || source === "apify") {
        // Apify RÉACTIVÉ 28/04 après diagnostic API live :
        //   - LinkedIn : input fixé (urls + count >= 10), actor curious_coder OK
        //   - WTTJ : nouvel actor clearpath (filtre companySize ICP-aware)
        //   - Indeed FR : nouvel actor misceres (leader Apify)
        //   - france-jobs (joyouscam) : deprecated (Hellowork/FT cassés)
        // Audit 03/05/2026 (incident plafond Apify $57.50/$60) :
        //  - cron pollApifyForClient passé 1h → 6h côté gateway/cron.js
        //  - WTTJ adapter fixé : nouveau schéma flat (organizationName +
        //    offices[]) découvert via inspection dataset. L'ancien adapter
        //    nested retournait null sur 100% items → 0 trigger en 7j malgré
        //    $8.38 scrape. Réactivé après fix.
        //  - Indeed ABANDON DÉFINITIF (audit 03/05 soir, A/B test 4 stratégies) :
        //    1) `position: "QA Engineer"` simple → 0% pertinent (vu en prod 7j)
        //    2) `startUrls` avec guillemets exact-match → actor FAILED (encodage)
        //    3) `startUrls` query OR + exclusions → 1 item hors-sujet retourné
        //    4) `startUrls` sans guillemets → 0/15 pertinents (DBA, AI, designer)
        //    Indeed FR est dominé par industriel/aérospatial/finance/AI/data.
        //    L'actor misceres ne supporte pas le filtre catégorie Indeed natif
        //    (Quality Assurance). Aucun chemin viable identifié. À reconsidérer
        //    seulement si on trouve un actor Indeed catégorisable.
        entry.apify = await pollApifyForClient(c.id, {
          dryRun,
          useFranceJobs: false,
          useLinkedin: true,
          useWttj: true,
          useIndeed: false,
        });
      }
      // Attribution SIRENE Pappers — APRÈS tous les pollers pour couvrir
      // TheirStack + Apify dans une seule passe (fix 28/04 : Apify n'était
      // jamais attribué, créant des Leads orphelins sans SIRET → unactionnable).
      if (!dryRun && (source === "all" || source === "theirstack" || source === "apify")) {
        const sirene = await enrichRecentTriggersWithSirene(c.id, { limit: 60 });
        entry.sireneEnriched = sirene.enriched;
      }
      // B4 (17/05/2026) — Retry attribution SIRENE sur les triggers verdict=ENRICH
      // bloqués depuis +24h. Consomme la recommandation Opus enrichmentNeeded
      // "Attribution SIRENE via Pappers" en tentant des variantes du companyName.
      // Archive automatiquement après 7j sans résolution.
      // Tourne sur le cron horaire light ET sur les runs all, pour rattraper
      // continuellement les triggers ENRICH bloqués (cf. session 17/05 audit).
      if (!dryRun && (source === "cron" || source === "all")) {
        try {
          const { retrySirenAttributionForEnrichTriggers } = await import(
            "@/lib/retry-enrich-attribution"
          );
          const retry = await retrySirenAttributionForEnrichTriggers(c.id, { limit: 20 });
          (entry as { retryEnrichSirene?: unknown }).retryEnrichSirene = retry;
        } catch (e) {
          (entry as { retryEnrichSireneError?: string }).retryEnrichSireneError =
            e instanceof Error ? e.message : String(e);
        }
      }
      // ────────────────────────────────────────────────────────────
      // Split léger (1h, source=cron) vs lourd (6h, source=all)
      // Audit 03/05 : profile-search brûlait $2.32/jour (16 runs) car
      // enrichDecisionMakers + linkedinFinder + dirigeants tournaient 24×/jour
      // via le crontab horaire `run-pollers-cron.sh ?source=cron`. Or ces
      // enrichissements ont des TTL 30j → 23 runs/24 ne font rien d'utile
      // (juste payer le start cost + la query).
      // - source=cron (crontab 1h)  → léger : audit-heal, qualify, ensure,
      //                                dedup, combo, priority, fit, sirene,
      //                                activity-sync, dataQuality. DB only.
      // - source=all  (bot 6h)       → tout (léger + enrichissements coûteux).
      // Économie projetée ~$18-25/mois (profile-search 16 runs/jour → 4).
      // ────────────────────────────────────────────────────────────
      const isFullPipeline = source === "all";
      // Audit & heal — backfill linkedinUrl/jobTitle/SIRET depuis rawPayload
      // pour rattraper les leads créés AVANT un fix de mapping (Rodz, Apify,
      // etc). Idempotent — safe à chaque run.
      if (!dryRun) {
        try {
          const heal = await auditAndHeal({ clientId: c.id });
          (entry as { auditHeal?: unknown }).auditHeal = heal;
        } catch (e) {
          (entry as { auditHealError?: string }).auditHealError = e instanceof Error ? e.message : String(e);
        }
      }
      // Qualify Opus tous les Triggers du client sans scoreReason (limite 30/run pour budget tokens).
      if (!dryRun) {
        const q = await qualifyPendingTriggers(c.id, { limit: 30 });
        entry.opusQualified = q.qualified;
        // Ensure Lead : crée Lead minimal pour chaque Trigger actif sans Lead.
        // Permet à Apify/Rodz/TheirStack d'apparaître dans le dashboard même
        // sans dirigeant Pappers résolu.
        const ensured = await ensureLeadsForAllTriggers(c.id);
        (entry as { ensuredLeads?: unknown }).ensuredLeads = ensured;
        // Dedup persona+siret (audit 30/04) : fusionne les leads doublons
        // (même firstName+lastName+companySiret) en propageant le meilleur
        // enrichissement vers un winner et soft-deletant les autres.
        // Tourne avant enrichissement pour éviter d'enrichir 2 fois la même persona.
        try {
          const dedup = await mergeDuplicatePersonaLeads({ clientId: c.id });
          (entry as { dedup?: unknown }).dedup = {
            groupsScanned: dedup.groupsScanned,
            groupsWithDuplicates: dedup.groupsWithDuplicates,
            leadsMerged: dedup.leadsMerged,
            leadsSoftDeleted: dedup.leadsSoftDeleted,
          };
        } catch (e) {
          (entry as { dedupError?: string }).dedupError =
            e instanceof Error ? e.message : String(e);
        }
        // Combo detector : flag isCombo=true sur les boîtes avec 2+ sources
        const combo = await detectCombosForClient(c.id);
        (entry as { combos?: unknown }).combos = combo;
        // Priority Scoring Engine (chantier #1, 01/05/2026) — recalcule
        // freshnessScore + multiSourceBoost + priorityScore sur tous les
        // triggers actifs. L'âge évolue à chaque heure → recompute essentiel.
        try {
          const priority = await recomputePriorityScoresForClient(c.id);
          (entry as { priority?: unknown }).priority = priority;
        } catch (e) {
          (entry as { priorityError?: string }).priorityError =
            e instanceof Error ? e.message : String(e);
        }
        // Persona Fit Scoring (chantier #2b, 01/05/2026) — recalcule fitScore
        // composite (base tier + tenure + backgrounds + size). Recompute
        // essentiel pour intégrer les nouveaux profils LinkedIn enrichis.
        try {
          const fit = await recomputeFitScoresForClient(c.id);
          (entry as { fit?: unknown }).fit = fit;
        } catch (e) {
          (entry as { fitError?: string }).fitError =
            e instanceof Error ? e.message : String(e);
        }
        // Growth detector (audit 30/04 soir) : crée un Trigger growth-alert
        // pour les boîtes <11p qui hire 3+ en 60j (pré-ICP qui scale).
        try {
          const growth = await detectGrowthAlertsForClient(c.id, { limit: 30 });
          (entry as { growthAlerts?: unknown }).growthAlerts = growth;
        } catch (e) {
          (entry as { growthError?: string }).growthError =
            e instanceof Error ? e.message : String(e);
        }
        // QA stuck scanner (Bougie 3 — 04/05) : boost score 9 + isHot=true
        // sur les triggers HIRING_KEY QA dont publishedAt ∈ [30j, 90j] et
        // dont le lead n'est pas encore contacté. Signal frustration
        // recrutement = bascule externalisation imminente, cible parfaite
        // pour DTL. Idempotent (marker [QA-STUCK Xj] dans scoreReason).
        try {
          const qaStuck = await scanQaStuckForClient(c.id);
          (entry as { qaStuck?: unknown }).qaStuck = qaStuck;
        } catch (e) {
          (entry as { qaStuckError?: string }).qaStuckError =
            e instanceof Error ? e.message : String(e);
        }
        // Sprint 3.3 (05/05) — Recovery sweep ARCHIVED riches.
        // Audit Phase 1 du 05/05 : 22 leads DTL ARCHIVED avec score≥8 ET
        // linkedinProfileJson volumineux (WeFiiT 76k chars, Smile 71k…) =
        // trésor potentiel. La query trouve les Triggers status=IGNORED
        // dont le Lead a un profil LinkedIn dense (>3000c) et force re-judge
        // avec les blocs PERSONA QUAL + LinkedIn Profile + COMPANY HEALTH
        // (Sprint 1+2). Estimation conservatrice : 5-8 récupérables par sweep.
        //
        // Audit fix B.1.3 (06/05) — Le bot trigger-engine NE FAIT PAS d'appel
        // ?source=all (0 trace 24h). Donc source=all bloqué = recovery sweep
        // jamais déclenché. Gate horaire ajouté : tourne aussi sur source=cron
        // si UTC hour % 6 === 1 (01h, 07h, 13h, 19h UTC = 4×/j vs 6×/j attendu).
        // Coût : 4 × $0.15 = $0.60/jour worst case (acceptable).
        const recoveryHour = new Date().getUTCHours();
        const shouldRunRecovery = source === "all" || (source === "cron" && recoveryHour % 6 === 1);
        if (shouldRunRecovery) {
          try {
            const recovered = await recoverIgnoredTriggersForClient(c.id, { limit: 30 });
            (entry as { recovery?: unknown }).recovery = {
              candidates: recovered.candidates,
              revived: recovered.revived,
              stillIgnored: recovered.stillIgnored,
              errors: recovered.errors,
            };
          } catch (e) {
            (entry as { recoveryError?: string }).recoveryError =
              e instanceof Error ? e.message : String(e);
          }
        }
        // Audit fix B.1.3 (06/05) — Sprint 2 B.2 wire enrichLinkedInProfilesForClient.
        // Idem : gate horaire pour ne pas dépendre de source=all (jamais déclenché).
        // TTL 30j sur Lead.linkedinProfileEnrichedAt → ne re-traite pas ceux déjà
        // enrichis. Apify HarvestAPI ~$0.005/lead × 30 max = $0.15/run.
        // Cron 4×/j = $0.60/jour. Couvre 26 candidats DTL en attente.
        const linkedinProfilesHour = new Date().getUTCHours();
        const shouldRunLinkedinProfiles =
          source === "all" || (source === "cron" && linkedinProfilesHour % 6 === 2);
        if (shouldRunLinkedinProfiles && !dryRun) {
          try {
            const liProfiles = await enrichLinkedInProfilesForClient(c.id, { limit: 30 });
            (entry as { linkedinProfiles?: unknown }).linkedinProfiles = {
              scanned: liProfiles.scanned,
              enriched: liProfiles.enriched,
              emptyResponses: liProfiles.emptyResponses,
              mismatchCompany: liProfiles.mismatchCompany,
              skipped: liProfiles.skipped,
              errorsCount: liProfiles.errors.length,
            };
          } catch (e) {
            (entry as { linkedinProfilesError?: string }).linkedinProfilesError =
              e instanceof Error ? e.message : String(e);
          }
        }
        // Auto-génération briefs Opus (Étape C — 04/05) : pour les leads
        // chauds (trigger.score >= 8 + isHot OU fitScore >= 75 OU QA-stuck)
        // qui n'ont pas encore de briefJson valide. Max 5/run pour borner
        // le coût (~5 × 0,02€ = 0,10€/run worst case = 0,40€/jour avec
        // 4 runs/jour si beaucoup de nouveaux). Tourne sur source=all
        // uniquement (cron 6h) car coût Anthropic non-négligeable.
        // Auto-briefs DÉSACTIVÉ (audit 10/05 19h) — Fred ne se connecte pas
        // au dashboard (1 seule session 26/04 = test admin). Briefs Opus
        // auto-générés inutilisés → gaspillage $0.40/jour ($12/mo).
        // Briefs disponibles à la demande via /api/leads/[id]/brief uniquement.
        // Réactiver si Fred utilise le dashboard à l'avenir.
        const AUTO_BRIEFS_ENABLED = false;
        if (AUTO_BRIEFS_ENABLED && source === "all") {
          try {
            const autoBriefs = await autoGenerateBriefsForHotLeads(c.id, { maxPerRun: 5 });
            (entry as { autoBriefs?: unknown }).autoBriefs = autoBriefs;
          } catch (e) {
            (entry as { autoBriefsError?: string }).autoBriefsError =
              e instanceof Error ? e.message : String(e);
          }
        }
        // ════════════════════════════════════════════════════════════
        // ENRICHISSEMENTS COÛTEUX — gated par isFullPipeline (source=all, 6h)
        // Skippés sur source=cron (crontab horaire) car TTL 30j rend les runs
        // intermédiaires inutiles. Économie majeure profile-search/HarvestAPI.
        // ════════════════════════════════════════════════════════════
        if (isFullPipeline) {
        // ────────────────────────────────────────────────────────────
        // ÉTAGE 3 — Trouver le bon décideur via HarvestAPI search-by-company
        // (Levier 4 anti-pollution, audit 29/04). Priorité sur Pappers récursion
        // holdings qui produit 24% de pollution "(via XXX HOLDING)" sur les
        // signaux Apify QA-engineer. HarvestAPI cherche par nom d'entreprise +
        // filtre titre tech (CTO/Head of QA/Eng Manager). Coût ~$0.16/lookup.
        // Validé empiriquement sur 12 boîtes : 58% résolution avec décideur
        // tech valable, 100% sur les top profils (CTO/Co-founder).
        // S'applique aux Leads sans firstName/lastName (= signal n'a pas livré
        // la persona). Skip si Rodz/Apify-poster/TheirStack-hiring_team déjà
        // posé via ensureLeadsForAllTriggers.
        // ────────────────────────────────────────────────────────────
        try {
          const dms = await enrichDecisionMakersForClient(c.id, { limit: 15 });
          (entry as { harvestapiDM?: unknown }).harvestapiDM = dms;
        } catch (e) {
          (entry as { harvestapiDMError?: string }).harvestapiDMError =
            e instanceof Error ? e.message : String(e);
        }
        // Enrichissement dirigeants Pappers : fallback ultime si HarvestAPI
        // n'a rien trouvé. Récupère CTO/CEO/Founder pour chaque Trigger ICP
        // qualifié et crée le Lead avec fullName + jobTitle. La récursion
        // holdings est désactivée par défaut (cf. enrich-lead-dirigeants.ts)
        // pour éviter la pollution "(via HOLDING)".
        const enrichDir = await enrichDirigeantsForClient(c.id, { limit: 30 });
        (entry as { dirigeants?: unknown }).dirigeants = enrichDir;
        // Rodz enrichContact — RÉSOUT LE LINKEDIN BOTTLENECK
        // Pour chaque Lead avec firstName+lastName+companyName mais sans
        // LinkedIn, demande à Rodz de résoudre. Rodz a une couverture
        // PME FR bien meilleure que HarvestAPI Profile Search car ils
        // agrégent plusieurs bases (LinkedIn public + RCS + Crunchbase).
        // Endpoint payé via abonnement Rodz mais jamais appelé jusqu'au
        // 28/04/2026 (commit b6zjfpwy7). +25-30% LinkedIn coverage attendu.
        try {
          const rodz = await enrichLeadsViaRodz(c.id, { limit: 30 });
          (entry as { rodzEnrich?: unknown }).rodzEnrich = rodz;
        } catch (e) {
          (entry as { rodzEnrichError?: string }).rodzEnrichError = e instanceof Error ? e.message : String(e);
        }
        // ────────────────────────────────────────────────────────────
        // ÉTAGE 3-bis — LinkedIn finder cascade (30/04)
        // Pour les Leads avec persona connue (firstName+lastName+companyName)
        // mais sans LinkedIn URL après Rodz enrichContact, on déclenche :
        //   1. HarvestAPI Profile Search par nom+société (~70% hit, $0.005)
        //   2. Google CSE site:linkedin.com/in/ (gratuit, ~50% du résidu)
        // Gate strict : Trigger.score >= 6 (Qualifiés + Pépites uniquement).
        // TTL 30j sur linkedinFinderAttemptedAt.
        // ────────────────────────────────────────────────────────────
        try {
          const lif = await enrichLeadsViaLinkedInFinder(c.id, { limit: 15 });
          (entry as { linkedinFinder?: unknown }).linkedinFinder = lif;
        } catch (e) {
          (entry as { linkedinFinderError?: string }).linkedinFinderError =
            e instanceof Error ? e.message : String(e);
        }
        // ────────────────────────────────────────────────────────────
        // Sprint 1, 04/05/2026 — Upgrade personaTier depuis headline LinkedIn
        // ────────────────────────────────────────────────────────────
        // Bug Paul Vidal résolu : Pappers RCS écrit qualite="Angel Investor"
        // pour des CTO Co-founders → personaTier reste null/3 alors que le
        // headline LinkedIn dit "Co-founder & CTO". Tourne APRÈS linkedinFinder
        // (qui enrichit linkedinProfileJson) et AVANT le re-recompute fitScore
        // pour que le fit utilise le tier upgradé. UPGRADE-only (jamais downgrade).
        try {
          const tierUp = await recomputePersonaTierFromHeadlineForClient(c.id);
          (entry as { tierUpgrade?: unknown }).tierUpgrade = {
            scanned: tierUp.scanned,
            upgraded: tierUp.upgraded,
            skipped: tierUp.skipped,
            errors: tierUp.errors,
            // Limite log à 5 details pour ne pas exploser le summary
            sample: tierUp.upgradeDetails.slice(0, 5),
          };
        } catch (e) {
          (entry as { tierUpgradeError?: string }).tierUpgradeError =
            e instanceof Error ? e.message : String(e);
        }
        // Recompute fitScore APRÈS tier upgrade pour appliquer le nouveau base
        // (Tier 1 base 60 vs Tier 3 base 35). Sinon le fit sortirait obsolète
        // jusqu'au prochain cron 1h.
        try {
          const fitAfterTier = await recomputeFitScoresForClient(c.id);
          (entry as { fitAfterTierUpgrade?: unknown }).fitAfterTierUpgrade =
            fitAfterTier;
        } catch (e) {
          (entry as { fitAfterTierUpgradeError?: string }).fitAfterTierUpgradeError =
            e instanceof Error ? e.message : String(e);
        }
        // Cross-source merge — propage LinkedIn/email/phone entre Leads
        // de la même boîte (même SIRET) issus de sources différentes.
        // Tourne AVANT Dropcontact pour que le LinkedIn cross-fertilisé
        // alimente le chaining Kaspr en aval.
        try {
          const merged = await mergeLeadsBySiret(c.id);
          (entry as { crossSourceMerged?: unknown }).crossSourceMerged = merged;
        } catch (e) {
          (entry as { crossSourceError?: string }).crossSourceError = e instanceof Error ? e.message : String(e);
        }
        // Sprint Persona Excellence (17/05/2026) — Dropcontact RÉACTIVÉ
        // en primaire AVANT Kaspr. Mode RGPD-strict (qualification valid/ok
        // + blacklist domaines perso). Cascade le Kaspr en aval pour récupérer
        // le mobile direct quand Dropcontact n'a fourni que l'email pro.
        // Plafond 50 leads/run (limite du batch Dropcontact).
        try {
          const dropcontact = await enrichLeadsViaDropcontact(c.id, { limit: 50 });
          (entry as { dropcontact?: unknown }).dropcontact = dropcontact;
        } catch (e) {
          (entry as { dropcontactError?: string }).dropcontactError = e instanceof Error ? e.message : String(e);
        }
        // Kaspr direct sur les leads avec LinkedIn jamais enrichis Kaspr
        // (qui n'ont pas transité par Dropcontact — soit déjà email, soit
        // pas de nom complet pour Dropcontact).
        try {
          const kasprDirect = await enrichLeadsViaKasprDirect(c.id, { limit: 30 });
          (entry as { kasprDirect?: unknown }).kasprDirect = kasprDirect;
        } catch (e) {
          (entry as { kasprDirectError?: string }).kasprDirectError = e instanceof Error ? e.message : String(e);
        }
        // ────────────────────────────────────────────────────────────
        // ÉTAGE 4-bis — FullEnrich fallback (audit 29/04 soir, après mesure
        // Kaspr 45% sur les nouveaux décideurs HarvestAPI).
        //
        // Pour les Leads avec persona identifiée mais sans email après tous
        // les autres providers, on tape FullEnrich qui cascade sur 20+
        // providers (Hunter, Apollo, Anymail Finder, Findymail, Datagma...).
        // Crédits déduits seulement si succès. Plafond 5 leads/run par défaut.
        //
        // Activation : si FULLENRICH_API_KEY est configuré.
        // ────────────────────────────────────────────────────────────
        if (process.env.FULLENRICH_API_KEY) {
          try {
            // Sprint Persona Excellence (17/05) — limit 15 → 30 après mesure
            // FullEnrich = 74% taux email réel sur 46 cas prod (vs 0%
            // Dropcontact). 72 éligibles non couverts sur 30j → on double la
            // capacité pour les rattraper en 2-3j au lieu de 5. Coût marginal
            // ~+8€/mois. Gate score >= 6 maintenue dans enrich-via-fullenrich.
            const fe = await enrichLeadsViaFullEnrich(c.id, { limit: 30 });
            (entry as { fullEnrich?: unknown }).fullEnrich = fe;
          } catch (e) {
            (entry as { fullEnrichError?: string }).fullEnrichError =
              e instanceof Error ? e.message : String(e);
          }
        }
        // Email pattern DIY — DÉSACTIVÉ COMPLÈTEMENT 29/04 (audit waterfall).
        // Endpoint /api/internal/enrich-email-pattern retourne 410 Gone.
        // Réactivation post-MillionVerifier (cf README).
        // 3e passe cross-source pour propager les emails/mobiles Kaspr
        // direct aux Leads sœurs de la même boîte.
        try {
          await mergeLeadsBySiret(c.id);
        } catch {
          // skip silencieux
        }
        // Declarative pain detection — ❌ DÉSACTIVÉ 06/05/2026 (audit Apify)
        // Mesure empirique : 0 pain détecté sur 51 scans en 30 jours côté DTL.
        // Cause : `Lead.linkedinUrl` = profil persona (/in/...) au lieu de
        // page company (/company/...) → l'actor harvestapi/linkedin-company-posts
        // scrape les mauvaises URLs, le LLM analyse des posts persos cherchant
        // une douleur entreprise. Signal corrompu structurellement.
        // Pour réactiver proprement : ajouter Lead.companyLinkedinUrl + résoudre
        // via Pappers/HarvestAPI puis re-câbler ici. Estimé 1-2h dev.
        // const pain = await detectDeclarativePainForClient(c.id, { limit: 20 });
        } // end if (isFullPipeline) — fin enrichissements coûteux
        // Sync EmailActivity (écrites par bot IMAP poller hors dashboard)
        // → LeadActivity miroir pour timeline temps réel.
        try {
          const sync = await syncEmailActivitiesToLeadActivity({ limit: 200 });
          (entry as { activitySync?: unknown }).activitySync = sync;
        } catch (e) {
          (entry as { activitySyncError?: string }).activitySyncError = e instanceof Error ? e.message : String(e);
        }
        // Recompute dataQuality pour tous les leads du client (Q7).
        // En fin de pipeline pour intégrer tous les enrichissements de ce run.
        try {
          const dq = await recomputeDataQualityForClient(c.id);
          (entry as { dataQuality?: unknown }).dataQuality = dq;
        } catch (e) {
          (entry as { dataQualityError?: string }).dataQualityError = e instanceof Error ? e.message : String(e);
        }
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    summary.push(entry);
  }

  // Sprint 10 (05/05) — Alert thresholds : checke des dérives critiques après
  // chaque run et alerte Telegram (dédup 60 min in-process). Anti-spam +
  // best-effort (n'casse jamais le pipeline si Telegram down).
  try {
    await checkRunHealthAndAlert(summary, runId);
  } catch {
    // silent — le monitoring ne doit pas casser le pipeline
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), runId, summary });
  } finally {
    releaseLock(runId);
  }
}

/**
 * Sprint 10 — Surveille les dérives sur la summary du run et alerte
 * l'admin via Telegram avec dédup 60 min.
 *
 * Seuils déclenchant alert :
 *   - Pipeline échoué pour un client (entry.error présent)
 *   - 0 trigger qualifié alors que le client a une ICP (panne Anthropic ?)
 *   - Erreurs Pappers SIRENE > 10 (quota ?)
 *   - Erreurs HarvestAPI > 5 (Apify down ?)
 *   - Recovery sweep errors > 5
 *   - Sirene enriched=0 sur source=all (tous skip ?)
 */
async function checkRunHealthAndAlert(
  summary: Array<{ client: string; [key: string]: unknown }>,
  runId: string,
): Promise<void> {
  const issues: string[] = [];

  for (const entry of summary) {
    const clientName = entry.client;
    if (typeof entry.error === "string" && entry.error) {
      issues.push(`${clientName} → pipeline échoué : ${String(entry.error).slice(0, 200)}`);
    }
    // Erreurs HarvestAPI Decision Makers
    const dm = entry.harvestapiDM as { errors?: number; scanned?: number } | undefined;
    if (dm && typeof dm.errors === "number" && dm.errors > 5) {
      issues.push(`${clientName} → harvestapiDM ${dm.errors} erreurs (scanned=${dm.scanned ?? "?"})`);
    }
    // Erreurs Recovery (Sprint 3.3)
    const recovery = entry.recovery as { errors?: number; revived?: number; candidates?: number } | undefined;
    if (recovery && typeof recovery.errors === "number" && recovery.errors > 5) {
      issues.push(`${clientName} → recovery sweep ${recovery.errors} erreurs (candidates=${recovery.candidates ?? 0})`);
    }
    // Qualify rien fait alors que client actif
    const qualified = entry.opusQualified;
    if (typeof qualified === "number" && qualified === 0 && entry.skipped == null) {
      // 0 qualified peut être normal (pas de pending) → on ne l'alerte que sur 3 runs consécutifs.
      // Pour simplicité, dédup 60 min suffit ici.
      issues.push(`${clientName} → 0 trigger qualifié sur ce run (Anthropic down ?)`);
    }
    // Erreurs Pappers SIRENE
    const sirene = entry.sireneEnriched;
    const sireneObj = entry.sirene as { errors?: number; enriched?: number } | undefined;
    void sirene;
    if (sireneObj && typeof sireneObj.errors === "number" && sireneObj.errors > 10) {
      issues.push(`${clientName} → SIRENE ${sireneObj.errors} erreurs (quota Pappers ?)`);
    }
    // Erreurs theirstack buying intent
    const tsbiError = entry.theirstackBuyingIntentError;
    if (typeof tsbiError === "string" && tsbiError) {
      issues.push(
        `${clientName} → TheirStack buying-intent erreur : ${tsbiError.slice(0, 100)}`,
      );
    }
  }

  if (issues.length === 0) return;

  const message = `Run ${runId.slice(0, 16)} - ${issues.length} alerte(s) :\n${issues
    .map((i) => `• ${i}`)
    .join("\n")}`;
  await notifyAdmin(message, {
    urgency: "warn",
    title: "iFIND run-pollers health",
    dedupKey: `run-pollers-issues|${issues.slice(0, 3).join("|").slice(0, 200)}`,
  });
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" });
}
