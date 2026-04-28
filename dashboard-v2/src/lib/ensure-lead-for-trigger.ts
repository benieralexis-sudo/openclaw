import "server-only";
import { db } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════
// Ensure Lead — pour CHAQUE Trigger actif AVEC SIRET, crée un Lead minimal
// s'il n'existe pas. Permet au dashboard d'afficher tous les signaux remontés
// (Apify, Rodz, TheirStack) même quand Pappers n'a pas encore résolu le dirigeant.
//
// Garde-fou : on ignore les Triggers sans companySiret. L'attribution SIRENE
// (via Pappers) tourne en amont à l'ingestion ; l'absence de SIRET signifie
// boîte étrangère ou nom ambigu non résolu → Lead inactionnable (pas de
// dirigeants Pappers, pas de domain Dropcontact, Kaspr skip si pas LinkedIn).
//
// Le Lead minimal a juste : companyName + companySiret + status NEW.
// Les pipelines downstream (enrichDirigeants Pappers, Dropcontact, Kaspr)
// rempliront firstName/lastName/email/phone progressivement.
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

  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      score: { gte: 4 }, // skip vraiment hors-ICP (score 1-3 = anti-ICP confirmé)
      companySiret: { not: null }, // pas de SIRET = attribution SIRENE échouée (boîte étrangère / nom ambigu) → lead inactionnable
    },
    select: {
      id: true,
      companyName: true,
      companySiret: true,
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
