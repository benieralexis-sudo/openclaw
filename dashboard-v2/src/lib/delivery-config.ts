// Sprint 3 (10/05/2026) — Schema Zod pour Client.deliveryConfig (JSON).
//
// Permet a chaque client de configurer comment il recoit ses leads :
//   - Email digest hebdomadaire (lundi 7h Paris par defaut)
//   - Alertes realtime sur pepites (score >= seuil)
//   - Branding email (sender name, color)
//
// Stocke en jsonb sur Client.deliveryConfig (migration Sprint 3).
// Editable via UI /clients/[id] tab Delivery (Sprint 3 S7).

import { z } from "zod";

export const WeeklyDigestConfigSchema = z.object({
  enabled: z.boolean().default(false),
  email: z.string().email().nullable().optional(),
  /** Score Opus minimum pour inclure le lead (defaut 7 = Brulants + Tres chauds) */
  minScore: z.number().int().min(1).max(10).default(7),
  /** Cap nombre de leads dans le mail (defaut 15, evite emails geants) */
  maxLeads: z.number().int().min(1).max(50).default(15),
  /** Jour d'envoi : 0=Dim, 1=Lun, ... 6=Sam */
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  /** Heure UTC d'envoi (defaut 6 UTC = 7-8h Paris selon DST) */
  hourUtc: z.number().int().min(0).max(23).default(6),
});
export type WeeklyDigestConfig = z.infer<typeof WeeklyDigestConfigSchema>;

export const RealtimeAlertConfigSchema = z.object({
  enabled: z.boolean().default(false),
  email: z.string().email().nullable().optional(),
  /** Optionnel : Telegram chat ID dedicated client (override admin) */
  telegramChatId: z.string().nullable().optional(),
  /** Score min pour declencher alerte (defaut 9 = Pepite) */
  minScore: z.number().int().min(1).max(10).default(9),
  /** Cap quotidien d'alertes (anti-flood, defaut 10) */
  maxPerDay: z.number().int().min(1).max(100).default(10),
});
export type RealtimeAlertConfig = z.infer<typeof RealtimeAlertConfigSchema>;

export const BrandConfigSchema = z.object({
  /** Nom expediteur (defaut "iFIND") */
  senderName: z.string().min(1).max(100).default("iFIND"),
  /** Email expediteur custom (defaut SENDER_EMAIL env) */
  senderEmail: z.string().email().nullable().optional(),
  /** Couleur primaire HTML (hex, ex "#5B7CFA"). Defaut iFIND blue. */
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#5B7CFA"),
  /** Logo URL (optionnel, affiche dans header email) */
  logoUrl: z.string().url().nullable().optional(),
});
export type BrandConfig = z.infer<typeof BrandConfigSchema>;

export const DeliveryConfigSchema = z.object({
  weeklyDigest: WeeklyDigestConfigSchema.default({} as WeeklyDigestConfig),
  realtimeAlert: RealtimeAlertConfigSchema.default({} as RealtimeAlertConfig),
  brand: BrandConfigSchema.default({} as BrandConfig),
});
export type DeliveryConfig = z.infer<typeof DeliveryConfigSchema>;

/**
 * Parse + valide la config delivery brute (depuis DB ou form). Defauts safe
 * si champ absent. Retourne null si JSON corrompu.
 */
export function parseDeliveryConfig(raw: unknown): DeliveryConfig {
  const parsed = DeliveryConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // Defauts safe si parse echoue (config corrompue)
  console.warn("[delivery-config] parse failed, using defaults:", parsed.error.issues[0]);
  return DeliveryConfigSchema.parse({});
}
