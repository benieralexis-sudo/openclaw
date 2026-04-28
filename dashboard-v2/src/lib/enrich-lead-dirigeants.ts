import "server-only";
import { db } from "@/lib/db";
import { getEntreprise, findHumanDirigeantRecursive } from "@/lib/pappers";

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
  { regex: /vp\s+engineering|head\s+of\s+engineering|engineering\s+manager|tech\s+lead/i, label: "Head of Engineering", weight: 9 },
  { regex: /chief\s+executive|président\s+du\s+directoire/i, label: "CEO", weight: 8 },
  { regex: /président|fondateur|founder|associé\s+gérant/i, label: "Président / Fondateur", weight: 8 },
  { regex: /\bDG\b|directeur\s+général|gérant/i, label: "Directeur Général / Gérant", weight: 7 },
  { regex: /head\s+of\s+product|cpo|chief\s+product/i, label: "CPO / Head of Product", weight: 6 },
  { regex: /coo|chief\s+operating|directeur\s+des?\s+opérations?/i, label: "COO", weight: 5 },
];

function matchPersonaPriority(qualite: string | undefined): { label: string; weight: number } {
  if (!qualite) return { label: "Représentant", weight: 1 };
  for (const p of PERSONA_PRIORITY) {
    if (p.regex.test(qualite)) return { label: p.label, weight: p.weight };
  }
  return { label: qualite, weight: 1 };
}

/**
 * Lit la `tranche_effectif` Pappers et retourne :
 *  - "small" : 0-49p, dirigeant RCS = bonne cible (signal direct au décideur)
 *  - "mid"   : 50-249p, dirigeant RCS = OK mais préférable hiring manager LinkedIn
 *  - "large" : 250+p, dirigeant RCS = mauvaise cible (CEO ALTEN ne lit pas un mail QA)
 *  - null    : effectif inconnu (Pappers retourne souvent null)
 *
 * Codes Pappers : "00"=0p · "01"=1-2p · "02"=3-5p · "03"=6-9p · "11"=10-19p
 *  · "12"=20-49p · "21"=50-99p · "22"=100-199p · "31"=200-249p · "32"=250-499p
 *  · "41"=500-999p · "42"=1000-1999p · "51"=2000-4999p · "52"=5000-9999p · "53"=10000+
 */
function bucketByEffectif(tranche: string | undefined): "small" | "mid" | "large" | null {
  if (!tranche) return null;
  const t = tranche.trim();
  if (/^(00|01|02|03|11|12)$/.test(t)) return "small";
  if (/^(21|22|31)$/.test(t)) return "mid";
  if (/^(32|41|42|51|52|53)$/.test(t)) return "large";
  return null;
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

      // Récupération étendue : représentants + bilans + procédures + dépôts + établissements
      // Forfait Pappers illimité = 0€ surcoût pour ces options.
      const data = await getEntreprise(siren, {
        includeRepresentants: true,
        includeBilans: true,
        includeProceduresCollectives: true,
        includeDepotsActes: true,
        includeEtablissements: true,
      });

      // EXCLUSION AUTO : procédure collective en cours (RJ/LJ) = boîte non-prospectable
      if (data.procedure_collective_en_cours === true) {
        await db.lead.updateMany({
          where: { triggerId: t.id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        await db.trigger.update({
          where: { id: t.id },
          data: {
            deletedAt: new Date(),
            ignoredAt: new Date(),
            ignoredReason: "procedure_collective_en_cours",
          },
        });
        stats.skipped += 1;
        continue;
      }

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
        if (/\b(holding|invest|gestion|patrimoine|finance|capital|conseil|conseils|sas|sarl|company|limited|group|cap|sci|fcpr|sci\s|société\s|services?|solutions?|systems?|consulting|partners?)\b/i.test(n)) return true;
        if (/\.\s*[A-Z]/.test(n)) return true; // sigles avec points (H.S.D, R.G.)
        // Tout en MAJ avec tiret/chiffre/point = raison sociale (EVA-RH, K-NET, RH2A, M.A.X)
        if (/^[A-Z][A-Z\s\-\.\d]+$/.test(n) && /[\-\.\d]/.test(n)) return true;
        if (/^[A-Z][A-Z]+(\s+[A-Z\d]+)*$/.test(n) && !/\s/.test(n.split(" ").slice(-1)[0] ?? "")) return true; // SOCIETE AAA BBB sans accent
        if (!/\s/.test(n) && /^[A-Z][a-zA-Z]+$/.test(n)) return true; // un seul mot capitalisé = nom commercial
        return false;
      };
      const isWrongPersona = (qualite: string | undefined): boolean => {
        if (!qualite) return false;
        return /commissaire\s+aux\s+comptes|expert[\s-]comptable|administrateur\s+judiciaire|liquidateur|censeur|représentant\s+permanent|membre\s+du\s+conseil|conseil\s+de\s+surveillance|administrateur(\s|$)|suppléant/i.test(qualite);
      };
      let best: { nom_complet?: string; qualite?: string; weight: number; holdingPath?: string[] } | null = null;
      for (const r of reps) {
        if (r.type && /morale/i.test(r.type)) continue;
        if (isPersonneMorale(r.nom_complet)) continue;
        if (isWrongPersona(r.qualite)) continue;
        const m = matchPersonaPriority(r.qualite);
        if (!best || m.weight > best.weight) best = { ...r, weight: m.weight };
      }

      // FALLBACK : si aucune personne physique au niveau 1, on remonte les
      // holdings parentes (max 3 niveaux) pour trouver le vrai dirigeant.
      // Très efficace sur les PME FR détenues par holding patrimoniale.
      if (!best || !best.nom_complet) {
        try {
          const recursive = await findHumanDirigeantRecursive(siren, {
            isPersonneMorale: (n: string) => isPersonneMorale(n),
            isWrongPersona: (q: string) => isWrongPersona(q),
            matchPersonaPriority: (q: string) => matchPersonaPriority(q),
            maxDepth: 3,
          });
          if (recursive) {
            best = {
              nom_complet: recursive.nom_complet,
              qualite: recursive.qualite,
              weight: recursive.weight,
              holdingPath: recursive.holdingPath,
            };
          }
        } catch {
          // skip silencieux
        }
      }

      if (!best || !best.nom_complet) {
        stats.skipped += 1;
        continue;
      }

      const { firstName, lastName, full } = splitFullName(best.nom_complet);
      const personaLabel = matchPersonaPriority(best.qualite).label;
      const holdingNote = best.holdingPath?.length
        ? ` (via ${best.holdingPath.join(" → ")})`
        : "";
      // Flag taille : pour les boîtes 250+p, le dirigeant RCS est rarement la
      // bonne cible. On surface ça dans le jobTitle pour que le commercial
      // privilégie le hiring manager LinkedIn (Apify poster / TheirStack
      // hiring_team / HarvestAPI employees) plutôt que d'envoyer au CEO.
      const bucket = bucketByEffectif(data.tranche_effectif);
      const sizeWarning = bucket === "large" ? " ⚠️ 250+p — préférer hiring manager LinkedIn" : "";

      // Extraction données Pappers étendues (si présentes)
      const lastFinance = data.finances?.[0];
      const companyRevenue = lastFinance?.chiffre_affaires ?? null;
      const companyResultNet = lastFinance?.resultat ?? null;
      const companyEtabsCount = data.etablissements?.filter((e) => e.actif !== false).length ?? null;
      // Dépôts d'actes <90j = changements stratégiques récents
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const recentDepots = (data.depots_actes ?? [])
        .filter((d) => d.date_depot && new Date(d.date_depot) > ninetyDaysAgo)
        .map((d) => ({ date: d.date_depot, type: d.type, decisions: d.decisions }))
        .slice(0, 5);

      // Upsert Lead lié à ce trigger
      const existingTriggerLead = await db.lead.findFirst({
        where: { triggerId: t.id, deletedAt: null },
        select: { id: true },
      });
      const jobTitleWithPath = personaLabel + holdingNote + sizeWarning;
      const enrichedFields = {
        firstName,
        lastName,
        fullName: full,
        jobTitle: jobTitleWithPath,
        ...(companyRevenue !== null ? { companyRevenue } : {}),
        ...(companyResultNet !== null ? { companyResultNet } : {}),
        ...(companyEtabsCount !== null ? { companyEtabsCount } : {}),
        ...(recentDepots.length > 0 ? { companyRecentDepots: recentDepots } : {}),
      };
      if (existingTriggerLead) {
        await db.lead.update({
          where: { id: existingTriggerLead.id },
          data: enrichedFields,
        });
      } else {
        await db.lead.create({
          data: {
            id: genCuid(),
            clientId,
            triggerId: t.id,
            ...enrichedFields,
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
