/**
 * Sprint 7 (05/05/2026) — Helper client-side pour tracker les interactions
 * dashboard du commercial. Le but : nourrir une boucle d'apprentissage
 * future few-shot dynamique pour le judge Opus, SANS demander 👍/👎 au
 * client (ce qui ne marche pas en pratique — feedback investigation 04/05).
 *
 * Posté sur l'endpoint existant POST /api/leads/[id]/activities avec
 * type=DASHBOARD_INTERACTION et payload.kind distinguant le type d'événement.
 *
 * Best-effort : silent error si erreur réseau (le tracking ne doit JAMAIS
 * casser une action utilisateur). Le commercial copie l'email même si le
 * tracking POST échoue.
 *
 * Usage typique :
 *   await trackLeadInteraction(leadId, "copy_email");
 *   await trackLeadInteraction(leadId, "click_linkedin", { url: "..." });
 */

export type LeadInteractionKind =
  | "view"
  | "copy_email"
  | "copy_phone"
  | "copy_linkedin"
  | "copy_brief"
  | "copy_callscript"
  | "click_linkedin"
  | "click_website"
  | "export_csv"
  | "archive_manual";

export async function trackLeadInteraction(
  leadId: string,
  kind: LeadInteractionKind,
  extraPayload?: Record<string, unknown>,
): Promise<void> {
  if (!leadId) return;
  try {
    await fetch(`/api/leads/${leadId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "DASHBOARD_INTERACTION",
        direction: "OUTBOUND",
        payload: {
          kind,
          ...extraPayload,
        },
      }),
    });
  } catch {
    // Silent fail — le tracking ne doit jamais casser un click utilisateur.
  }
}

/**
 * Sprint 7 — Bouton 1-clic statut. Pose un STATUS_CHANGE activity + update
 * Trigger.status si le statut cible est dans TriggerStatus enum.
 *
 * - "BOOKED" : le commercial a posé un RDV avec le lead
 * - "WON" : deal signé
 * - "LOST" : deal perdu
 *
 * À réutiliser dans tout bouton de changement de statut côté dashboard.
 */
export type LeadStatusChange = "BOOKED" | "WON" | "LOST";

export async function trackLeadStatusChange(
  leadId: string,
  newStatus: LeadStatusChange,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!leadId) return { ok: false, error: "no leadId" };
  try {
    const res = await fetch(`/api/leads/${leadId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "STATUS_CHANGE",
        direction: "OUTBOUND",
        note,
        payload: {
          newStatus,
          source: "dashboard-1click-button",
        },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
