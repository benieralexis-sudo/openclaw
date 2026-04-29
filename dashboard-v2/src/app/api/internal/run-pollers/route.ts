import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollTheirstackForClient, enrichRecentTriggersWithSirene } from "@/lib/theirstack-poller";
import { pollApifyForClient } from "@/lib/apify-poller";
import { qualifyPendingTriggers } from "@/lib/qualify-trigger";
import { detectCombosForClient } from "@/lib/combo-detector";
import { enrichDirigeantsForClient } from "@/lib/enrich-lead-dirigeants";
import { enrichLeadsViaDropcontact } from "@/lib/enrich-via-dropcontact";
import { detectDeclarativePainForClient } from "@/lib/declarative-pain";
import { ensureLeadsForAllTriggers } from "@/lib/ensure-lead-for-trigger";
import { syncEmailActivitiesToLeadActivity } from "@/lib/lead-activity";
import { auditAndHeal } from "@/lib/audit-heal";
import { mergeLeadsBySiret } from "@/lib/lead-cross-source";
import { enrichLeadsViaRodz } from "@/lib/enrich-via-rodz";
import { enrichLeadsViaKasprDirect } from "@/lib/enrich-via-kaspr-direct";
// Email pattern DIY — endpoint désactivé 29/04 (risque réputation Primeforge).
// Lib enrich-via-email-pattern conservée pour réactivation post-MillionVerifier.

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
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "all";
  const targetClientId = url.searchParams.get("clientId");
  const dryRun = url.searchParams.get("dryRun") === "true";

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
      if (source === "all" || source === "theirstack") {
        entry.theirstack = await pollTheirstackForClient(c.id, { dryRun, jobsLimit: 30, companiesLimit: 15 });
      }
      if (source === "all" || source === "apify") {
        // Apify RÉACTIVÉ 28/04 après diagnostic API live :
        //   - LinkedIn : input fixé (urls + count >= 10), actor curious_coder OK
        //   - WTTJ : nouvel actor clearpath (filtre companySize ICP-aware)
        //   - Indeed FR : nouvel actor misceres (leader Apify)
        //   - france-jobs (joyouscam) : deprecated (Hellowork/FT cassés)
        entry.apify = await pollApifyForClient(c.id, {
          dryRun,
          useFranceJobs: false,
          useLinkedin: true,
          useWttj: true,
          useIndeed: true,
        });
      }
      // Attribution SIRENE Pappers — APRÈS tous les pollers pour couvrir
      // TheirStack + Apify dans une seule passe (fix 28/04 : Apify n'était
      // jamais attribué, créant des Leads orphelins sans SIRET → unactionnable).
      if (!dryRun && (source === "all" || source === "theirstack" || source === "apify")) {
        const sirene = await enrichRecentTriggersWithSirene(c.id, { limit: 60 });
        entry.sireneEnriched = sirene.enriched;
      }
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
        // Combo detector : flag isCombo=true sur les boîtes avec 2+ sources
        const combo = await detectCombosForClient(c.id);
        (entry as { combos?: unknown }).combos = combo;
        // Enrichissement dirigeants Pappers : récupère CTO/CEO/Founder pour
        // chaque Trigger ICP qualifié et crée le Lead avec fullName + jobTitle.
        // Le commercial déclenchera ensuite Kaspr depuis la fiche pour
        // récupérer email pro + téléphone.
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
        // Enrichissement contact via Dropcontact (email + LinkedIn + tel)
        // pour les Leads avec dirigeant nommé mais sans email.
        try {
          const dc = await enrichLeadsViaDropcontact(c.id, { limit: 30 });
          (entry as { dropcontact?: unknown }).dropcontact = dc;
        } catch (e) {
          (entry as { dropcontactError?: string }).dropcontactError = e instanceof Error ? e.message : String(e);
        }
        // 2e passe cross-source — propage les enrichissements Dropcontact
        // (email/phone) vers les Leads sœurs de la même boîte qui n'ont pas
        // été touchés par Dropcontact (limit 30/run).
        try {
          await mergeLeadsBySiret(c.id);
        } catch {
          // skip silencieux — la 1re passe a déjà loggué les groupes
        }
        // Kaspr direct sur les leads avec LinkedIn jamais enrichis Kaspr.
        // Cas concret : Rodz enrichContact ramène un LinkedIn → si Dropcontact
        // ne trouve pas d'email, le chaining Kaspr de enrichLeadsViaDropcontact
        // est skip → on perd mobile + work email. Ce module rattrape (15/run).
        try {
          const kasprDirect = await enrichLeadsViaKasprDirect(c.id, { limit: 15 });
          (entry as { kasprDirect?: unknown }).kasprDirect = kasprDirect;
        } catch (e) {
          (entry as { kasprDirectError?: string }).kasprDirectError = e instanceof Error ? e.message : String(e);
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
        // Declarative pain detection (HarvestAPI LinkedIn posts + Opus)
        // Plafond strict 50 entreprises × 5 posts = 250 posts max/run = ~$0.40
        try {
          const pain = await detectDeclarativePainForClient(c.id, { limit: 50 });
          (entry as { declarativePain?: unknown }).declarativePain = pain;
        } catch (e) {
          (entry as { painError?: string }).painError = e instanceof Error ? e.message : String(e);
        }
        // Sync EmailActivity (écrites par bot IMAP poller hors dashboard)
        // → LeadActivity miroir pour timeline temps réel.
        try {
          const sync = await syncEmailActivitiesToLeadActivity({ limit: 200 });
          (entry as { activitySync?: unknown }).activitySync = sync;
        } catch (e) {
          (entry as { activitySyncError?: string }).activitySyncError = e instanceof Error ? e.message : String(e);
        }
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    summary.push(entry);
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), summary });
}

export async function GET() {
  return NextResponse.json({ method: "POST required with x-cron-secret header" });
}
