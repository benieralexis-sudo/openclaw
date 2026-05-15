import "server-only";
import { db } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════
// Ensure Lead — pour CHAQUE Trigger actif, crée un Lead minimal.
//
// Phase 2 recovery 04/05/2026 : assouplissement règle SIRET.
//   AVANT : on exigeait companySiret IS NOT NULL → 9 Pépites Opus≥7
//           sans SIRET (Viaxoft, Air Apps, CTS, Asys-no-lead, etc.)
//           restaient invisibles du dashboard alors qu'elles sont valides
//           (juste attribution SIRENE Pappers échouée).
//   APRÈS : on crée un Lead AUSSI pour les Triggers Opus≥7 sans SIRET,
//           pour permettre HarvestAPI search-by-company (qui n'a pas
//           besoin de SIRET) de poser la persona ultérieurement.
//
// Le Lead minimal a juste : companyName + (companySiret nullable) + status NEW.
// Les pipelines downstream (enrichDirigeants Pappers, HarvestAPI DM,
// Kaspr, FullEnrich) rempliront firstName/lastName/email/phone progressivement.
// ═══════════════════════════════════════════════════════════════════

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 14);
  return `c${ts}${rand}`.slice(0, 25).padEnd(25, "0");
}

export async function ensureLeadsForAllTriggers(
  clientId: string,
): Promise<{ created: number; alreadyExisted: number }> {
  const stats = { created: 0, alreadyExisted: 0 };

  // Fix B11.1 (15/05/2026) — Multi-tenant : lire le domain persona depuis
  // client.icp pour adapter le filtre poster Apify (tech vs sales).
  // DTL → "tech" (CTO/Head Eng), iFIND → "sales" (Head of Sales/CRO/VP Sales).
  const clientConfig = await db.client.findUnique({
    where: { id: clientId },
    select: { icp: true },
  });
  const personaDomain = inferPersonaDomain(clientConfig?.icp);

  // Phase 2 recovery 04/05 : on accepte les Triggers SANS SIRET si Opus≥7
  // (Pépites confirmées par scoring contextuel). Pour les autres, on garde
  // la règle stricte SIRET requis (anti-pollution boîtes ambiguës).
  //
  // Fix audit massif 14/05/2026 — Ajout filtre status NOT IGNORED.
  // Avant : un Trigger IGNORED (verdict V2 NON ou ENRICH non-shippable) avec
  // SIRET tombait dans ensureLead → Lead créé en NEW alors que le judge avait
  // explicitement dit "pas intéressant". 10 leads polluants détectés en DB
  // (2 DTL + 8 iFIND). Maintenant : on skip IGNORED systématiquement.
  // Note : `archiveLeadOnTriggerIgnored` (lead-status-sync) gère déjà les
  // Leads PRÉ-existants → IGNORED, mais ne couvrait pas la création post-qualify.
  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: { not: "IGNORED" },
      score: { gte: 4 },
      OR: [
        { companySiret: { not: null } },
        // Exception Pépite : Opus≥7 = signal contextuel fort, on crée le
        // Lead même sans SIRET (HarvestAPI search-by-company résoudra).
        { score: { gte: 7 } },
      ],
    },
    select: {
      id: true,
      companyName: true,
      companySiret: true,
      companyNaf: true,
      title: true,
      type: true,
      score: true,
      rawPayload: true,
      lead: { select: { id: true } },
    },
  });

  for (const t of triggers) {
    if (t.lead) {
      stats.alreadyExisted++;
      continue;
    }
    // Hydrate Lead.linkedinUrl + nom + titre si l'annonce contenait le poster
    // (Apify LinkedIn jobs / WTTJ recruiter / TheirStack decision_makers).
    // Sinon Pappers prendra le relais sur les pipelines downstream.
    let poster = extractPosterFromPayload(t.rawPayload);

    // Bug Training Orchestra (audit 11/05/2026, étendu 15/05 fix B11.1) — Sur
    // un trigger HIRING_KEY, si le poster Apify de l'annonce n'est pas du bon
    // domain (tech vs sales selon ICP client), on REFUSE de le poser comme
    // contact. Cas DTL : Laetitia Nourry CEO Training Orchestra postée comme
    // contact QA Engineer → reject (non-tech).
    // Cas iFIND : poster CTO sur HIRING_KEY Sales → reject (non-sales), laisser
    // HarvestAPI chercher un Head of Sales/CRO.
    if (
      poster?.title &&
      isHiringTriggerForDomain(t.type, t.companyNaf, t.title, personaDomain)
    ) {
      if (!isAcceptedPersonaTitle(poster.title, personaDomain)) {
        console.log(
          `[ensure-lead.poster-filter] ${t.companyName}: poster Apify "${poster.title}" non-${personaDomain} sur trigger HIRING_KEY ${personaDomain} "${t.title}" → SKIP, on laisse HarvestAPI chercher un décideur ${personaDomain}.`,
        );
        poster = null;
      }
    }

    // Bug B14 fix (Session 3, 10/05/2026) — Avant : try/catch swallow sur
    // unique constraint (clientId, companySiret). Si 2 triggers même client
    // arrivaient avec même SIRET dans le même run, le 2e échouait
    // silencieusement et le Trigger restait sans Lead lié → invisible
    // dashboard. Maintenant : si un Lead existe déjà sur ce SIRET (peu
    // importe l'ancien triggerId), on l'attache au nouveau trigger.
    if (t.companySiret) {
      const existingLead = await db.lead.findFirst({
        where: {
          clientId,
          companySiret: t.companySiret,
          deletedAt: null,
        },
        select: { id: true, triggerId: true },
      });
      if (existingLead) {
        // Lead déjà existant pour ce SIRET — pas de duplicate, juste compté
        // alreadyExisted. Le trigger n'a pas de Lead direct mais son SIRET
        // est déjà couvert par un autre trigger précédent (combo détecté
        // ailleurs). La dedup est faite côté table Trigger.
        //
        // Fix Sêmeia (14/05/2026) — On reset scoreReason du trigger principal
        // (lié au Lead existant) à null pour que qualifyPendingTriggers le
        // re-pioche au prochain cycle. Le re-qualify aura accès au nouveau
        // signal via getPriorSignalsForCompany (90j SIRET) → brief V2 mis à
        // jour avec le contexte fundraising/M&A/etc. capté ici.
        // Cas concret : Lead Mathieu Godart sur trigger apify.wttj-jobs (QA
        // hire) → arrive un trigger rss-levees fundraising 12/05. Sans ce
        // reset, le brief V2 d'origine reste figé sur le seul angle QA. Avec
        // ce reset, Opus voit "PRIOR SIGNALS : fundraising 12/05" et réécrit
        // un brief combo "scale-up + hire QA = sweet spot iFIND".
        if (existingLead.triggerId && existingLead.triggerId !== t.id) {
          await db.trigger
            .update({
              where: { id: existingLead.triggerId },
              data: { scoreReason: null },
            })
            .catch((e: unknown) => {
              console.warn(
                `[ensure-lead.requalify-trigger-on-newsignal] ${t.companyName}: échec reset scoreReason trigger principal ${existingLead.triggerId}: ${e instanceof Error ? e.message : String(e)}`,
              );
            });
        }
        stats.alreadyExisted++;
        continue;
      }
    }

    // 12/05/2026 — Crée en INCOMPLETE si pas de persona à la création.
    // Cas SoWeSoft : trigger sans SIRET ni poster non-tech → Lead "shell"
    // visible Fred mais inutile. Maintenant on le crée INCOMPLETE (caché Fred),
    // les enrichissements (HarvestAPI search-by-company, Pappers dirigeants
    // si SIRET résolu, Kaspr) tentent de remplir. Dès que firstName/lastName
    // arrive, audit-heal le bascule en NEW (visible Fred).
    const initialStatus = poster?.fullName ? "NEW" : "INCOMPLETE";
    try {
      await db.lead.create({
        data: {
          id: genCuid(),
          clientId,
          triggerId: t.id,
          companyName: t.companyName,
          companySiret: t.companySiret,
          status: initialStatus,
          firstName: poster?.firstName ?? null,
          lastName: poster?.lastName ?? null,
          fullName: poster?.fullName ?? null,
          jobTitle: poster?.title ?? null,
          linkedinUrl: poster?.linkedinUrl ?? null,
        },
      });
      stats.created++;
    } catch (e) {
      // Race condition résiduelle (2 invocations parallèles du même cron) :
      // log warning au lieu de swallow silencieux (Bug B14 fix Session 3).
      // L'erreur Prisma "Unique constraint failed" = pas grave, le Lead a
      // été créé par l'autre invocation. Just log pour debug si besoin.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique constraint failed")) {
        console.log(
          `[ensure-lead.race] ${t.companyName} (siret=${t.companySiret}) — Lead créé par run parallèle, skip`,
        );
      } else {
        console.warn(`[ensure-lead.err] ${t.companyName}: ${msg}`);
      }
    }
  }

  return stats;
}

interface ExtractedPoster {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  title?: string;
}

function extractPosterFromPayload(payload: unknown): ExtractedPoster | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // 1. Apify NormalizedJob (poster*) — LinkedIn jobs, WTTJ recruiter
  const fullName =
    asString(p.posterFullName) ??
    asString(p.posterName) ??
    asString(p.recruiterName) ??
    asString(p.hiringManagerName);
  const firstName = asString(p.posterFirstName);
  const lastName = asString(p.posterLastName);
  const linkedinUrl = pickLinkedinUrl(
    p.posterLinkedinUrl,
    p.posterProfileUrl,
    p.recruiterLinkedinUrl,
    p.hiringManagerLinkedinUrl,
  );
  const title = asString(p.posterTitle) ?? asString(p.recruiterTitle);

  // 2. TheirStack hiring_team / decision_makers — premier décideur "tech" si présent
  const dm = (p.hiring_team ?? p.hiringTeam ?? p.decision_makers ?? p.decisionMakers) as unknown;
  if (Array.isArray(dm) && dm.length > 0 && !linkedinUrl) {
    const tech = pickTechDecisionMaker(dm);
    if (tech) {
      const dmFull = asString(tech.full_name) ?? asString(tech.fullName) ?? asString(tech.name);
      const { firstName: dmFirst, lastName: dmLast } = splitNameLocal(dmFull);
      return {
        fullName: dmFull,
        firstName: asString(tech.first_name) ?? asString(tech.firstName) ?? dmFirst,
        lastName: asString(tech.last_name) ?? asString(tech.lastName) ?? dmLast,
        linkedinUrl: pickLinkedinUrl(tech.linkedin_url, tech.linkedinUrl, tech.profile_url, tech.profileUrl),
        title: asString(tech.title) ?? asString(tech.job_title) ?? asString(tech.position),
      };
    }
  }

  if (!fullName && !firstName && !linkedinUrl) return null;
  return {
    fullName,
    firstName: firstName ?? splitNameLocal(fullName).firstName,
    lastName: lastName ?? splitNameLocal(fullName).lastName,
    linkedinUrl,
    title,
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function pickLinkedinUrl(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const s = asString(c);
    if (s && /linkedin\.com\/(in|pub)\//i.test(s)) return s;
  }
  return undefined;
}

function splitNameLocal(full: string | undefined): { firstName?: string; lastName?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Tech-hire guards extraits dans tech-persona-guard.ts (14/05/2026) pour tests.
// Import local + re-export pour rétro-compat des call sites externes
// (qualify-trigger.ts, etc.) ET pour usage interne (ligne 77).
//
// Fix B11.1 (15/05/2026) — Ajout des wrappers config-driven multi-tenant :
//   - isAcceptedPersonaTitle(title, domain) : tech OU sales selon client.icp
//   - isHiringTriggerForDomain(type, naf, title, domain) : idem
//   - inferPersonaDomain(icp) : déduit "tech" ou "sales" depuis ICP
import {
  isTechHiringTrigger,
  isTechPersonaTitle,
  isAcceptedPersonaTitle,
  isHiringTriggerForDomain,
  inferPersonaDomain,
} from "@/lib/tech-persona-guard";
export { isTechHiringTrigger, isTechPersonaTitle };

// Fix WeWard (14/05/2026) — pickTechDecisionMaker (TheirStack DM picker) utilise
// désormais le MÊME isTechPersonaTitle que le poster Apify, pour homogénéiser
// le guard. Avant : regex TECH_TITLE_RE permissive (acceptait CEO/Founder) →
// trigger TheirStack avec CEO en tête des decision_makers → Lead = CEO.
// Maintenant : check identique au poster Apify (STRONG_NON_TECH prime).
function pickTechDecisionMaker(dms: unknown[]): Record<string, unknown> | null {
  // Prio 1 : titre tech matché via isTechPersonaTitle (guard homogène)
  for (const d of dms) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    const t = asString(r.title) ?? asString(r.job_title) ?? asString(r.position);
    if (t && isTechPersonaTitle(t)) return r;
  }
  // Prio 2 : 1er décideur quelconque (fallback si aucun tech identifié — le
  // tech-hire-guard ensure-leadsForAllTriggers le rejettera de toute façon
  // si le trigger est HIRING_KEY tech et le titre non-tech).
  for (const d of dms) {
    if (d && typeof d === "object") return d as Record<string, unknown>;
  }
  return null;
}
