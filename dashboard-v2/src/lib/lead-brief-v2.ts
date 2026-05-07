import { z } from "zod";

/**
 * Sprint D.1 (07/05/2026) — Schéma LeadBriefV2.
 *
 * Game changer iFIND : le judge passe de `{score: int 1-10, reason: string}`
 * (numérique opaque) à un brief raisonné OUI/NON/ENRICH avec citations,
 * risks et opener. Pour le commercial : opener prêt à coller dans un email
 * ou LinkedIn message. Pour le client : verdict tranché, thesis défendable,
 * risks anticipés. Pour l'audit : citations [src:#X] traçables.
 *
 * Le champ `briefV2Json` est ajouté au modèle Trigger (Prisma) en double-write
 * pendant 30 jours : `scoreReason` legacy reste rempli en parallèle pour
 * rollback safety (Sprint D.5).
 *
 * Le validator D.3 utilise ce schéma + des règles supplémentaires :
 *   - opener ≤ 250 mots
 *   - thesis et risks doivent contenir au moins une citation [src:#X]
 *   - fallback sur l'ancien {score, reason} si validation échoue
 */

export const VERDICTS = ["OUI", "NON", "ENRICH"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Citation d'un trigger ou signal qui a contribué au verdict.
 * Plusieurs triggers convergents = signal d'achat fort (combo patterns).
 */
export const TriggerCitationSchema = z.object({
  source: z.string().min(1).max(64),
  date: z.string().min(1).max(64),
  relevance: z.string().min(1).max(400),
});
export type TriggerCitation = z.infer<typeof TriggerCitationSchema>;

/**
 * Risque que le commercial doit anticiper avant outreach. Au moins 2 risks
 * sont obligatoires : force le judge à équilibrer son enthousiasme et donner
 * au commercial des garde-fous concrets ("avant d'appeler, vérifie X").
 */
export const RiskSchema = z.object({
  severity: z.enum(SEVERITIES),
  description: z.string().min(1).max(400),
});
export type Risk = z.infer<typeof RiskSchema>;

/**
 * Référence numérotée vers une source brute. Le judge cite `[src:#X]` dans
 * thesis/risks/opener et chaque numéro est résolu via cette table.
 * Permet à l'UI d'afficher des liens cliquables vers la source originale.
 */
export const SourceRefSchema = z.object({
  id: z.number().int().min(1).max(99),
  type: z.string().min(1).max(32),
  ref: z.string().min(1).max(512),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const LeadBriefV2Schema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.number().int().min(0).max(100),
  thesis: z.string().min(20).max(800),
  triggers: z.array(TriggerCitationSchema).min(1).max(10),
  risks: z.array(RiskSchema).min(2).max(8),
  opener: z.string().min(20).max(2000),
  sources: z.array(SourceRefSchema).min(1).max(20),
  enrichmentNeeded: z.array(z.string().min(1).max(200)).max(10).optional(),
});
export type LeadBriefV2 = z.infer<typeof LeadBriefV2Schema>;

/**
 * Parse + valide un brief brut (depuis Opus output ou DB Json). Retourne null
 * si validation échoue (le validator D.3 logguera la raison séparément).
 */
export function parseLeadBriefV2(raw: unknown): LeadBriefV2 | null {
  const result = LeadBriefV2Schema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Type guard. Utile en TS pour resserrer le type d'un champ Prisma `Json?`
 * dans les composants UI (Sprint D.4 markdown render).
 */
export function isLeadBriefV2(raw: unknown): raw is LeadBriefV2 {
  return LeadBriefV2Schema.safeParse(raw).success;
}

/**
 * Parse + retourne soit le brief, soit l'erreur Zod. Utile pour le validator
 * D.3 qui doit logger la raison du fallback dans scoreReason.
 */
export function parseLeadBriefV2WithError(
  raw: unknown,
): { ok: true; brief: LeadBriefV2 } | { ok: false; error: string } {
  const result = LeadBriefV2Schema.safeParse(raw);
  if (result.success) return { ok: true, brief: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join(" | ");
  return { ok: false, error: issues };
}
