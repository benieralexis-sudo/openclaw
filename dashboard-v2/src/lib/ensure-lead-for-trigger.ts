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
      lead: { select: { id: true } },
    },
  });

  for (const t of triggers) {
    if (t.lead) {
      stats.alreadyExisted++;
      continue;
    }
    try {
      await db.lead.create({
        data: {
          id: genCuid(),
          clientId,
          triggerId: t.id,
          companyName: t.companyName,
          companySiret: t.companySiret,
          status: "NEW",
        },
      });
      stats.created++;
    } catch {
      // skip silencieux (race condition possible)
    }
  }

  return stats;
}
