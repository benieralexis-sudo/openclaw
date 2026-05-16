import "server-only";

/**
 * Audit 16/05/2026 — Helper partagé pour les guards pré-Opus.
 *
 * Avant d'appeler Claude pour générer un brief / pitch / DM / call-brief / opener
 * qualify-v2, on vérifie 3 conditions :
 *   - doNotContact : RGPD opt-out (auto IMAP "stop"/"unsubscribe" ou manuel)
 *   - bouncedAt : email a déjà rebondi → ne pas relancer
 *   - status === INCOMPLETE : Lead sans persona résolue (cas SoWeSoft 12/05),
 *                              pas actionnable, économie tokens
 *
 * Avant cet audit, seul `/copy` via copy-runner avait ces gardes. Les 4 routes
 * /brief, /pitch, /linkedin-dm, /call-brief appelaient Opus sans check → risque
 * RGPD (email illégal généré et prêt à envoyer) + dépense Opus inutile.
 *
 * qualifyTriggerV2 lui-même n'avait pas non plus ces gardes : Opus jugeait des
 * Leads INCOMPLETE ou avec bounce, gaspillant des tokens.
 */

export type LeadGuardInput = {
  doNotContact?: boolean | null;
  doNotContactReason?: string | null;
  bouncedAt?: Date | null;
  status?: string | null;
};

export type LeadGuardResult =
  | { ok: true }
  | { ok: false; reason: "doNotContact" | "bouncedAt" | "incomplete" | "archived"; message: string };

const BOUNCE_RECENCY_DAYS = 30;

export function checkLeadCanGenerate(lead: LeadGuardInput): LeadGuardResult {
  if (lead.doNotContact === true) {
    const why = lead.doNotContactReason ? ` (${lead.doNotContactReason})` : "";
    return {
      ok: false,
      reason: "doNotContact",
      message: `Lead doNotContact — refus RGPD${why}`,
    };
  }

  if (lead.bouncedAt) {
    const ageMs = Date.now() - lead.bouncedAt.getTime();
    if (ageMs < BOUNCE_RECENCY_DAYS * 24 * 60 * 60 * 1000) {
      return {
        ok: false,
        reason: "bouncedAt",
        message: `Lead bouncedAt <${BOUNCE_RECENCY_DAYS}j — refus génération`,
      };
    }
  }

  if (lead.status === "INCOMPLETE") {
    return {
      ok: false,
      reason: "incomplete",
      message: "Lead INCOMPLETE — persona pas résolue, pas actionnable",
    };
  }

  if (lead.status === "ARCHIVED") {
    return {
      ok: false,
      reason: "archived",
      message: "Lead ARCHIVED — pas de génération",
    };
  }

  return { ok: true };
}
