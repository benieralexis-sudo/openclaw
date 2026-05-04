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

  // Phase 2 recovery 04/05 : on accepte les Triggers SANS SIRET si Opus≥7
  // (Pépites confirmées par scoring contextuel). Pour les autres, on garde
  // la règle stricte SIRET requis (anti-pollution boîtes ambiguës).
  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
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
    const poster = extractPosterFromPayload(t.rawPayload);
    try {
      await db.lead.create({
        data: {
          id: genCuid(),
          clientId,
          triggerId: t.id,
          companyName: t.companyName,
          companySiret: t.companySiret,
          status: "NEW",
          firstName: poster?.firstName ?? null,
          lastName: poster?.lastName ?? null,
          fullName: poster?.fullName ?? null,
          jobTitle: poster?.title ?? null,
          linkedinUrl: poster?.linkedinUrl ?? null,
        },
      });
      stats.created++;
    } catch {
      // skip silencieux (race condition possible)
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

const TECH_TITLE_RE =
  /(cto|chief tech|head of (engineering|tech|qa|test|product)|engineering manager|tech lead|vp engineering|vp tech|directeur technique|responsable technique|founder|fondateur|ceo|chief executive|directeur général|président|gérant)/i;

function pickTechDecisionMaker(dms: unknown[]): Record<string, unknown> | null {
  // Prio 1 : titre tech matché
  for (const d of dms) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    const t = asString(r.title) ?? asString(r.job_title) ?? asString(r.position);
    if (t && TECH_TITLE_RE.test(t)) return r;
  }
  // Prio 2 : 1er décideur quelconque
  for (const d of dms) {
    if (d && typeof d === "object") return d as Record<string, unknown>;
  }
  return null;
}
