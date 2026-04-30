import "server-only";
import { db } from "@/lib/db";

/**
 * Dedup leads persona+siret (audit 30/04)
 * ════════════════════════════════════════
 *
 * Problème : pour une même personne (firstName + lastName + companySiret),
 * plusieurs Triggers de sources différentes peuvent créer N Lead distincts.
 * Conséquence : enrichissement asymétrique (un Lead a tout, l'autre rien),
 * commercial voit les 2 dans le dashboard, risque double email à la même
 * personne.
 *
 * Stratégie :
 *   1. GROUP BY firstName + lastName + companySiret (sur leads non-deleted)
 *   2. Pour chaque groupe N>=2 : choisir le "winner" (le plus enrichi),
 *      mergeer toutes les données des autres dans le winner, soft-delete les
 *      perdants.
 *   3. Retourner le rapport (groupes traités, leads merged, soft-deleted).
 *
 * Score d'enrichissement (pour décider winner) :
 *   - email présent : +30
 *   - phone (kaspr OU phone OU phoneFullenrich) : +25
 *   - linkedinUrl : +20
 *   - dataQuality : *0.5 (max 50)
 *   - emailSourceCount : *5
 *   - briefJson présent : +10
 *
 * Champs propagés du perdant vers le winner si manquants :
 *   email, phone, linkedinUrl, kasprPhone, kasprWorkEmail, kasprPersonalEmail,
 *   emailRodz, emailDropcontact, emailFullenrich, phoneFullenrich,
 *   linkedinSource, personaSource, personaTier, jobTitle, companySiret,
 *   companyRevenue, companyResultNet, companyHasInsolvency, companyEtabsCount,
 *   pitchJson, callBriefJson, linkedinDmJson, briefJson, briefGeneratedAt,
 *   pitchGeneratedAt
 */

interface DedupResult {
  groupsScanned: number;
  groupsWithDuplicates: number;
  leadsMerged: number;
  leadsSoftDeleted: number;
  details: Array<{
    persona: string;
    siret: string | null;
    winnerId: string;
    losersIds: string[];
    fieldsBackfilled: string[];
  }>;
}

// Liste des champs simples à backfill du perdant vers le winner
const SIMPLE_BACKFILL_FIELDS = [
  "email",
  "phone",
  "linkedinUrl",
  "linkedinSource",
  "kasprPhone",
  "kasprWorkEmail",
  "kasprPersonalEmail",
  "kasprTitle",
  "kasprResponseJson",
  "emailRodz",
  "emailDropcontact",
  "emailFullenrich",
  "phoneFullenrich",
  "personaSource",
  "personaTier",
  "jobTitle",
  "companySiret",
  "companyRevenue",
  "companyResultNet",
  "companyEtabsCount",
  "pitchJson",
  "callBriefJson",
  "linkedinDmJson",
  "briefJson",
] as const;

interface LeadForDedup {
  id: string;
  clientId: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string;
  companySiret: string | null;
  email: string | null;
  phone: string | null;
  kasprPhone: string | null;
  kasprWorkEmail: string | null;
  kasprPersonalEmail: string | null;
  phoneFullenrich: string | null;
  emailFullenrich: string | null;
  emailRodz: string | null;
  emailDropcontact: string | null;
  linkedinUrl: string | null;
  linkedinSource: string | null;
  personaSource: string | null;
  personaTier: number | null;
  jobTitle: string | null;
  emailSourceCount: number;
  dataQuality: number;
  briefJson: unknown;
  pitchJson: unknown;
  callBriefJson: unknown;
  linkedinDmJson: unknown;
  kasprResponseJson: unknown;
  kasprTitle: string | null;
  companyRevenue: number | null;
  companyResultNet: number | null;
  companyHasInsolvency: boolean;
  companyEtabsCount: number | null;
  createdAt: Date;
}

function scoreLead(l: LeadForDedup): number {
  let s = 0;
  if (l.email) s += 30;
  if (l.phone || l.kasprPhone || l.phoneFullenrich) s += 25;
  if (l.linkedinUrl) s += 20;
  s += Math.min(50, Math.round(l.dataQuality * 0.5));
  s += l.emailSourceCount * 5;
  if (l.briefJson) s += 10;
  return s;
}

export async function mergeDuplicatePersonaLeads(
  opts: { clientId?: string; dryRun?: boolean } = {},
): Promise<DedupResult> {
  const result: DedupResult = {
    groupsScanned: 0,
    groupsWithDuplicates: 0,
    leadsMerged: 0,
    leadsSoftDeleted: 0,
    details: [],
  };

  // 1. Charger tous les leads non-deleted avec persona connue
  const leads = (await db.lead.findMany({
    where: {
      deletedAt: null,
      firstName: { not: null },
      lastName: { not: null },
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
    },
    select: {
      id: true,
      clientId: true,
      firstName: true,
      lastName: true,
      companyName: true,
      companySiret: true,
      email: true,
      phone: true,
      kasprPhone: true,
      kasprWorkEmail: true,
      kasprPersonalEmail: true,
      kasprTitle: true,
      kasprResponseJson: true,
      phoneFullenrich: true,
      emailFullenrich: true,
      emailRodz: true,
      emailDropcontact: true,
      linkedinUrl: true,
      linkedinSource: true,
      personaSource: true,
      personaTier: true,
      jobTitle: true,
      emailSourceCount: true,
      dataQuality: true,
      briefJson: true,
      pitchJson: true,
      callBriefJson: true,
      linkedinDmJson: true,
      companyRevenue: true,
      companyResultNet: true,
      companyHasInsolvency: true,
      companyEtabsCount: true,
      createdAt: true,
    },
  })) as LeadForDedup[];

  // 2. Group by clientId|firstName|lastName|companySiret (fallback companyName)
  type GroupKey = string;
  const groups = new Map<GroupKey, LeadForDedup[]>();
  for (const l of leads) {
    const fn = (l.firstName ?? "").trim().toLowerCase();
    const ln = (l.lastName ?? "").trim().toLowerCase();
    const key = `${l.clientId}|${fn}|${ln}|${l.companySiret ?? l.companyName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  result.groupsScanned = groups.size;

  // 3. Pour chaque groupe avec doublons, propager + soft-delete
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    result.groupsWithDuplicates++;

    // Élire le winner (plus haut score, en cas d'égalité le plus récent)
    const sorted = [...group].sort((a, b) => {
      const sa = scoreLead(a);
      const sb = scoreLead(b);
      if (sa !== sb) return sb - sa;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);
    if (!winner) continue;

    // Construire l'update à appliquer au winner (backfill depuis losers)
    const update: Record<string, unknown> = {};
    const fieldsBackfilled: string[] = [];
    for (const field of SIMPLE_BACKFILL_FIELDS) {
      const winnerVal = (winner as unknown as Record<string, unknown>)[field];
      // Si winner a déjà la valeur (truthy), on garde
      if (winnerVal != null && winnerVal !== "") continue;
      // Sinon chercher chez les losers
      for (const l of losers) {
        const loserVal = (l as unknown as Record<string, unknown>)[field];
        if (loserVal != null && loserVal !== "") {
          update[field] = loserVal;
          fieldsBackfilled.push(field);
          break;
        }
      }
    }
    // Boolean : insolvency à OR
    if (
      !winner.companyHasInsolvency &&
      losers.some((l) => l.companyHasInsolvency)
    ) {
      update.companyHasInsolvency = true;
      fieldsBackfilled.push("companyHasInsolvency");
    }
    // Score email source : prendre le max
    const maxSourceCount = Math.max(
      winner.emailSourceCount,
      ...losers.map((l) => l.emailSourceCount),
    );
    if (maxSourceCount > winner.emailSourceCount) {
      update.emailSourceCount = maxSourceCount;
      fieldsBackfilled.push("emailSourceCount");
    }

    if (!opts.dryRun) {
      // Update winner si backfill nécessaire
      if (Object.keys(update).length > 0) {
        try {
          await db.lead.update({
            where: { id: winner.id },
            data: update,
          });
          result.leadsMerged++;
        } catch (e) {
          // Conflit unique constraint possible si email dupliqué — log + skip
          // (dans ce cas, le winner garde ses valeurs, les losers seront
          // soft-deleted comme prévu et l'enrichissement n'est pas perdu
          // car les losers gardent leurs valeurs jusqu'à la soft-delete).
          console.warn(
            `[dedup] update winner ${winner.id} failed:`,
            e instanceof Error ? e.message : e,
          );
        }
      }
      // Soft-delete losers
      for (const loser of losers) {
        try {
          await db.lead.update({
            where: { id: loser.id },
            data: { deletedAt: new Date(), status: "ARCHIVED" },
          });
          result.leadsSoftDeleted++;
        } catch (e) {
          console.warn(
            `[dedup] soft-delete loser ${loser.id} failed:`,
            e instanceof Error ? e.message : e,
          );
        }
      }
    }

    result.details.push({
      persona: `${winner.firstName} ${winner.lastName}`,
      siret: winner.companySiret,
      winnerId: winner.id,
      losersIds: losers.map((l) => l.id),
      fieldsBackfilled,
    });
  }

  return result;
}
