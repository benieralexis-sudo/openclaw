import "server-only";
import { db } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════
// Cross-source Lead merge — propage les enrichissements COMPANY-LEVEL
// entre Leads de la même boîte (même SIRET).
//
// 🛑 SCOPE RÉDUIT 29/04 (audit qualité Q4) : la version précédente propageait
// linkedinUrl/email/phone/firstName/lastName/jobTitle/kasprPhone/kasprWorkEmail
// → générait des emails fantômes (le CEO d'une boîte recevait le email d'un
// autre CEO d'une boîte différente avec même SIRET, et inversement les hiring
// managers Apify se faisaient écraser leur LinkedIn par celui du CEO Pappers).
//
// Désormais on ne propage QUE les fields *entreprise* (financials, depots,
// procédure collective, établissements). Ces données sont identiques pour
// toute personne de l'entreprise donc safe à propager.
//
// Cas d'usage légitime : Asys remontée via Apify ET TheirStack → 2 Leads,
// 2 personnes différentes, mais même boîte. On veut que les 2 fiches
// affichent le CA, le résultat net et les dépôts récents pour le brief Opus,
// sans mélanger les identités.
//
// Idempotent — peut tourner 100x sans dégât.
// ═══════════════════════════════════════════════════════════════════

export interface CrossSourceResult {
  groupsScanned: number;
  groupsMerged: number;
  fieldsBackfilled: {
    companyRevenue: number;
    companyResultNet: number;
    companyHasInsolvency: number;
    companyEtabsCount: number;
    companyRecentDepots: number;
  };
}

export async function mergeLeadsBySiret(
  clientId: string,
): Promise<CrossSourceResult> {
  const result: CrossSourceResult = {
    groupsScanned: 0,
    groupsMerged: 0,
    fieldsBackfilled: {
      companyRevenue: 0,
      companyResultNet: 0,
      companyHasInsolvency: 0,
      companyEtabsCount: 0,
      companyRecentDepots: 0,
    },
  };

  const leads = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      companySiret: { not: null },
    },
    select: {
      id: true,
      companySiret: true,
      companyRevenue: true,
      companyResultNet: true,
      companyHasInsolvency: true,
      companyEtabsCount: true,
      companyRecentDepots: true,
    },
  });

  // Groupe par SIREN (9 premiers chiffres) pour matcher inter-sources.
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

    // "Premier non-null wins" sur les fields company-level uniquement.
    // Pour booleans (insolvency), `true` l'emporte sur `false` ou null.
    const winners = {
      companyRevenue: pickFirstNumber(members.map((m) => m.companyRevenue)),
      companyResultNet: pickFirstNumber(members.map((m) => m.companyResultNet)),
      companyHasInsolvency: members.some((m) => m.companyHasInsolvency === true),
      companyEtabsCount: pickFirstNumber(members.map((m) => m.companyEtabsCount)),
      companyRecentDepots: pickFirstJson(members.map((m) => m.companyRecentDepots)),
    };

    let groupChanged = false;
    for (const m of members) {
      const updates: Record<string, unknown> = {};
      if (m.companyRevenue == null && winners.companyRevenue != null) {
        updates.companyRevenue = winners.companyRevenue;
        result.fieldsBackfilled.companyRevenue++;
      }
      if (m.companyResultNet == null && winners.companyResultNet != null) {
        updates.companyResultNet = winners.companyResultNet;
        result.fieldsBackfilled.companyResultNet++;
      }
      // Insolvency : on propage UNIQUEMENT le `true` (si une seule fiche flag,
      // toute la boîte est en procédure → tous les leads doivent être marqués).
      if (m.companyHasInsolvency !== true && winners.companyHasInsolvency) {
        updates.companyHasInsolvency = true;
        result.fieldsBackfilled.companyHasInsolvency++;
      }
      if (m.companyEtabsCount == null && winners.companyEtabsCount != null) {
        updates.companyEtabsCount = winners.companyEtabsCount;
        result.fieldsBackfilled.companyEtabsCount++;
      }
      if (m.companyRecentDepots == null && winners.companyRecentDepots != null) {
        updates.companyRecentDepots = winners.companyRecentDepots;
        result.fieldsBackfilled.companyRecentDepots++;
      }

      if (Object.keys(updates).length === 0) continue;

      await db.lead.update({
        where: { id: m.id },
        data: updates,
      });
      groupChanged = true;
    }
    if (groupChanged) result.groupsMerged++;
  }

  return result;
}

function pickFirstNumber(values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

function pickFirstJson<T>(values: Array<T | null | undefined>): T | null {
  for (const v of values) {
    if (v != null) return v;
  }
  return null;
}
