import "server-only";
import { db } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════
// Cross-source Lead merge — propage les enrichissements entre Leads
// de la même boîte (même SIRET) provenant de sources différentes.
//
// Cas d'usage : Asys remontée via Apify (job-offer) ET TheirStack
// (buying-intent) → 2 Leads, chacun lié à son Trigger, mais l'un a
// le LinkedIn du CTO et l'autre a un email Dropcontact. On veut que
// les 2 Leads bénéficient des 2 enrichissements (linkedin + email)
// pour que les pipelines downstream (Kaspr, brief Opus, send-email)
// disposent du maximum d'infos quel que soit le Trigger affiché.
//
// Stratégie : pour chaque groupe SIRET, "premier non-null wins" sur
// les champs d'enrichissement. Les Leads gardent leur triggerId
// d'origine (multi-tenant safe, pas de fusion destructive).
//
// Idempotent — peut tourner 100x sans dégât (un Lead déjà rempli
// n'est jamais écrasé par un null/empty).
// ═══════════════════════════════════════════════════════════════════

export interface CrossSourceResult {
  groupsScanned: number;
  groupsMerged: number;
  fieldsBackfilled: {
    linkedinUrl: number;
    email: number;
    phone: number;
    firstName: number;
    lastName: number;
    fullName: number;
    jobTitle: number;
    kasprWorkEmail: number;
    kasprPhone: number;
  };
}

const FR_MOBILE_RE = /^(\+?33\s?[67]|0[67])/;

function isFrenchMobile(p: string | null | undefined): boolean {
  if (!p) return false;
  return FR_MOBILE_RE.test(p.replace(/\s+/g, ""));
}

export async function mergeLeadsBySiret(
  clientId: string,
): Promise<CrossSourceResult> {
  const result: CrossSourceResult = {
    groupsScanned: 0,
    groupsMerged: 0,
    fieldsBackfilled: {
      linkedinUrl: 0,
      email: 0,
      phone: 0,
      firstName: 0,
      lastName: 0,
      fullName: 0,
      jobTitle: 0,
      kasprWorkEmail: 0,
      kasprPhone: 0,
    },
  };

  // Récupère tous les Leads avec SIRET groupés par SIRET, exclut soft-deleted.
  const leads = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      companySiret: { not: null },
    },
    select: {
      id: true,
      companySiret: true,
      linkedinUrl: true,
      email: true,
      emailStatus: true,
      phone: true,
      firstName: true,
      lastName: true,
      fullName: true,
      jobTitle: true,
      kasprWorkEmail: true,
      kasprPhone: true,
    },
  });

  // Groupe par SIRET (9 premiers chiffres SIREN pour matcher inter-sources)
  const groups = new Map<string, typeof leads>();
  for (const l of leads) {
    if (!l.companySiret) continue;
    const siren = l.companySiret.replace(/\s+/g, "").slice(0, 9);
    if (!/^\d{9}$/.test(siren)) continue;
    const arr = groups.get(siren) ?? [];
    arr.push(l);
    groups.set(siren, arr);
  }

  result.groupsScanned = groups.size;

  for (const [, members] of groups) {
    if (members.length < 2) continue;

    // Pick "premier non-null wins" — on parcourt les membres dans l'ordre
    // (peu importe lequel, la sémantique est "n'importe lequel rempli > vide").
    const winners = {
      linkedinUrl: pickNonEmpty(members.map((m) => m.linkedinUrl)),
      email: pickValidEmail(members),
      phone: pickPhone(members),
      firstName: pickNonEmpty(members.map((m) => m.firstName)),
      lastName: pickNonEmpty(members.map((m) => m.lastName)),
      fullName: pickNonEmpty(members.map((m) => m.fullName)),
      jobTitle: pickNonEmpty(members.map((m) => m.jobTitle)),
      kasprWorkEmail: pickNonEmpty(members.map((m) => m.kasprWorkEmail)),
      kasprPhone: pickPhoneRaw(members.map((m) => m.kasprPhone)),
    };

    // Pour chaque membre, n'update QUE les champs vides du Lead avec la valeur
    // gagnante. On n'écrase jamais une valeur déjà présente (idempotent +
    // respecte l'enrichissement Pappers/Kaspr propre à chaque Lead).
    let groupChanged = false;
    for (const m of members) {
      const updates: Record<string, string> = {};
      if (!m.linkedinUrl && winners.linkedinUrl) updates.linkedinUrl = winners.linkedinUrl;
      if (!m.email && winners.email) updates.email = winners.email;
      if (!m.phone && winners.phone) updates.phone = winners.phone;
      if (!m.firstName && winners.firstName) updates.firstName = winners.firstName;
      if (!m.lastName && winners.lastName) updates.lastName = winners.lastName;
      if (!m.fullName && winners.fullName) updates.fullName = winners.fullName;
      if (!m.jobTitle && winners.jobTitle) updates.jobTitle = winners.jobTitle;
      if (!m.kasprWorkEmail && winners.kasprWorkEmail) updates.kasprWorkEmail = winners.kasprWorkEmail;
      if (!m.kasprPhone && winners.kasprPhone) updates.kasprPhone = winners.kasprPhone;

      if (Object.keys(updates).length === 0) continue;

      await db.lead.update({
        where: { id: m.id },
        data: updates,
      });
      groupChanged = true;
      for (const k of Object.keys(updates)) {
        const key = k as keyof typeof result.fieldsBackfilled;
        if (key in result.fieldsBackfilled) result.fieldsBackfilled[key]++;
      }
    }
    if (groupChanged) result.groupsMerged++;
  }

  return result;
}

function pickNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v && v.trim().length > 0) return v;
  }
  return null;
}

function pickValidEmail(
  members: Array<{ email: string | null; emailStatus: string }>,
): string | null {
  // Privilégie un email avec emailStatus VERIFIED, fallback sur n'importe lequel non-vide.
  const verified = members.find(
    (m) => m.email && m.email.length > 0 && m.emailStatus === "VERIFIED",
  );
  if (verified?.email) return verified.email;
  return pickNonEmpty(members.map((m) => m.email));
}

function pickPhone(
  members: Array<{ phone: string | null; kasprPhone: string | null }>,
): string | null {
  // Privilégie un mobile FR (06/07/+336/+337) parmi tous les phones disponibles.
  for (const m of members) {
    if (isFrenchMobile(m.phone)) return m.phone;
    if (isFrenchMobile(m.kasprPhone)) return m.kasprPhone;
  }
  return pickNonEmpty(members.map((m) => m.phone));
}

function pickPhoneRaw(values: Array<string | null | undefined>): string | null {
  // Pour kasprPhone : privilégie un mobile FR.
  for (const v of values) {
    if (isFrenchMobile(v)) return v ?? null;
  }
  return pickNonEmpty(values);
}
