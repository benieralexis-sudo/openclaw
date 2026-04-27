import "server-only";
import { db } from "@/lib/db";
import { getEntreprise } from "@/lib/pappers";

/**
 * Enrichissement Pappers dirigeants : pour chaque Trigger ICP qualifié sans Lead
 * contact, récupère les dirigeants via /v2/entreprise?representants=true et crée
 * le Lead avec le meilleur match (priorité CTO > CEO > Founder > DG > Président).
 *
 * Coût : 1 requête Pappers / SIRET. Limite 30/run pour budget.
 *
 * Le Lead créé n'a pas encore d'email/tel — le commercial déclenche ensuite
 * Kaspr depuis la fiche pour l'enrichir avec LinkedIn → email pro + tel.
 */

const PERSONA_PRIORITY = [
  { regex: /\bCTO\b|chief\s+technology|directeur\s+technique/i, label: "CTO", weight: 10 },
  { regex: /chief\s+executive|directeur\s+général|président\s+du\s+directoire/i, label: "CEO", weight: 9 },
  { regex: /\bDG\b|directeur\s+général/i, label: "Directeur Général", weight: 8 },
  { regex: /president|fondateur|founder/i, label: "Président / Fondateur", weight: 8 },
  { regex: /vp\s+engineering|head\s+of\s+engineering/i, label: "VP Engineering", weight: 7 },
  { regex: /head\s+of\s+product|cpo|chief\s+product/i, label: "CPO / Head of Product", weight: 6 },
];

function matchPersonaPriority(qualite: string | undefined): { label: string; weight: number } {
  if (!qualite) return { label: "Représentant", weight: 1 };
  for (const p of PERSONA_PRIORITY) {
    if (p.regex.test(qualite)) return { label: p.label, weight: p.weight };
  }
  return { label: qualite, weight: 1 };
}

function genCuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 14);
  return `c${ts}${rand}`.slice(0, 25).padEnd(25, "0");
}

function splitFullName(fullName: string): { firstName: string; lastName: string; full: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? "", lastName: "", full: fullName };
  const lastName = parts[parts.length - 1] ?? "";
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName, full: fullName };
}

export async function enrichDirigeantsForClient(
  clientId: string,
  options: { limit?: number } = {},
): Promise<{ scanned: number; enriched: number; skipped: number; errors: number }> {
  const limit = options.limit ?? 30;

  // Triggers avec SIRET qui n'ont PAS de Lead avec un contact (fullName) renseigné.
  const triggers = await db.trigger.findMany({
    where: {
      clientId,
      companySiret: { not: null },
      deletedAt: null,
    },
    select: { id: true, companyName: true, companySiret: true },
    take: limit * 2, // overshoot car certains auront déjà un Lead
  });

  const stats = { scanned: 0, enriched: 0, skipped: 0, errors: 0 };

  for (const t of triggers) {
    if (stats.enriched >= limit) break;
    if (!t.companySiret) continue;

    // Skip si Lead existe déjà avec fullName (déjà enrichi)
    const existingLead = await db.lead.findFirst({
      where: { triggerId: t.id, deletedAt: null, fullName: { not: null } },
      select: { id: true },
    });
    if (existingLead) {
      stats.skipped += 1;
      continue;
    }

    stats.scanned += 1;

    try {
      // SIREN seulement (pas SIRET établissement)
      const siren = t.companySiret.replace(/\s+/g, "").slice(0, 9);
      if (!/^\d{9}$/.test(siren)) {
        stats.skipped += 1;
        continue;
      }

      const data = await getEntreprise(siren, { includeRepresentants: true });
      const reps = data.representants ?? [];
      if (reps.length === 0) {
        stats.skipped += 1;
        continue;
      }

      // Pick le dirigeant prioritaire (CTO > CEO > DG > etc).
      // Filtre les personnes morales :
      //   - Suffixes/mots-clés explicites (Holding, Invest, Gestion, Conseils, etc)
      //   - Sigles avec points (H.S.D, R.G., S.A.R.L)
      //   - Tout en majuscules sans accents (= raison sociale)
      //   - Pas d'espace = nom commercial unique (Gestionphi, Lemonway)
      // Filtre aussi les fonctions hors décision : Commissaire aux comptes, etc.
      const isPersonneMorale = (nom: string | undefined): boolean => {
        if (!nom) return false;
        const n = nom.trim();
        if (/\b(holding|invest|gestion|patrimoine|finance|capital|conseil|conseils|sas|sarl|company|limited|group|cap|sci|fcpr|sci\s|société\s)\b/i.test(n)) return true;
        if (/\.\s*[A-Z]/.test(n)) return true; // sigles avec points (H.S.D, R.G.)
        if (/^[A-Z][A-Z]+(\s+[A-Z\d]+)*$/.test(n) && !/\s/.test(n.split(" ").slice(-1)[0] ?? "")) return true; // SOCIETE AAA BBB sans accent
        if (!/\s/.test(n) && /^[A-Z][a-zA-Z]+$/.test(n)) return true; // un seul mot capitalisé = nom commercial
        return false;
      };
      const isWrongPersona = (qualite: string | undefined): boolean => {
        if (!qualite) return false;
        return /commissaire\s+aux\s+comptes|expert[\s-]comptable|administrateur\s+judiciaire|liquidateur/i.test(qualite);
      };
      let best: { nom_complet?: string; qualite?: string; weight: number } | null = null;
      for (const r of reps) {
        if (r.type && /morale/i.test(r.type)) continue;
        if (isPersonneMorale(r.nom_complet)) continue;
        if (isWrongPersona(r.qualite)) continue;
        const m = matchPersonaPriority(r.qualite);
        if (!best || m.weight > best.weight) best = { ...r, weight: m.weight };
      }
      // Si aucune personne physique : skip (pas le bon contact à attaquer)
      if (!best || !best.nom_complet) {
        stats.skipped += 1;
        continue;
      }

      const { firstName, lastName, full } = splitFullName(best.nom_complet);
      const personaLabel = matchPersonaPriority(best.qualite).label;

      // Upsert Lead lié à ce trigger
      const existingTriggerLead = await db.lead.findFirst({
        where: { triggerId: t.id, deletedAt: null },
        select: { id: true },
      });
      if (existingTriggerLead) {
        await db.lead.update({
          where: { id: existingTriggerLead.id },
          data: {
            firstName,
            lastName,
            fullName: full,
            jobTitle: personaLabel,
          },
        });
      } else {
        await db.lead.create({
          data: {
            id: genCuid(),
            clientId,
            triggerId: t.id,
            firstName,
            lastName,
            fullName: full,
            jobTitle: personaLabel,
            companyName: t.companyName,
            companySiret: t.companySiret,
            status: "NEW",
          },
        });
      }
      stats.enriched += 1;
    } catch (e) {
      stats.errors += 1;
      console.warn(`[enrich-dirigeants] err ${t.companyName}:`, e instanceof Error ? e.message : e);
    }
  }

  return stats;
}
