import "server-only";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/internal/secrets-audit
 *
 * Liste les secrets configurés (sans valeurs, juste présence + length).
 * Permet de vérifier que tous les secrets requis sont bien chargés au runtime
 * sans risquer de fuite côté logs.
 *
 * Auth : header `x-cron-secret`.
 */

// Required côté dashboard-v2 (Next.js process). Resend / TelegramBot /
// Rodz sont côté container telegram-router donc OPTIONAL ici.
// V1 18/05/2026 — PAPPERS_API_TOKEN retiré : migration vers l'API gouv
// gratuite recherche-entreprises.api.gouv.fr (cf. gouv-api.ts). Plus aucun
// appel vers api.pappers.fr dans le code. La variable peut être supprimée
// du .env quand tu auras annulé l'abonnement Pappers.
const REQUIRED_SECRETS = [
  "ANTHROPIC_API_KEY",
  "FULLENRICH_API_KEY",
  "KASPR_API_KEY",
  "APIFY_API_TOKEN",
  "GOOGLE_API_KEY",
  "GOOGLE_CSE_ID",
  "CRON_SECRET",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
] as const;

const OPTIONAL_SECRETS = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "CAL_WEBHOOK_SECRET",
  "RODZ_API_KEY",
  "DROPCONTACT_API_KEY", // archivé 30/04
  "PAPPERS_API_TOKEN", // V1 18/05 — déprécié, migration vers API gouv (à supprimer post-annulation)
  "TELEGRAM_BOT_TOKEN",
  "ADMIN_CHAT_ID",
] as const;

interface SecretAudit {
  name: string;
  configured: boolean;
  length: number;
  startsWith: string;
  required: boolean;
  warning?: string;
}

function auditSecret(name: string, required: boolean): SecretAudit {
  const v = process.env[name];
  if (!v) {
    return {
      name,
      configured: false,
      length: 0,
      startsWith: "",
      required,
      warning: required ? "REQUIRED but missing" : undefined,
    };
  }
  // Show only first 4 chars to confirm it's the right one without leaking
  const startsWith = v.length > 4 ? v.slice(0, 4) + "…" : "***";
  let warning: string | undefined;
  if (v.length < 10) warning = "suspiciously short";
  if (/^(test|dummy|placeholder|changeme)/i.test(v)) warning = "looks like placeholder";
  return {
    name,
    configured: true,
    length: v.length,
    startsWith,
    required,
    warning,
  };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const required = REQUIRED_SECRETS.map((n) => auditSecret(n, true));
  const optional = OPTIONAL_SECRETS.map((n) => auditSecret(n, false));

  const missing = required.filter((s) => !s.configured);
  const warnings = [...required, ...optional].filter((s) => s.warning);

  return NextResponse.json({
    ok: missing.length === 0,
    summary: {
      requiredConfigured: required.filter((s) => s.configured).length,
      requiredTotal: required.length,
      optionalConfigured: optional.filter((s) => s.configured).length,
      optionalTotal: optional.length,
      missingRequired: missing.map((s) => s.name),
      warnings: warnings.length,
    },
    required,
    optional,
    note: "Aucune valeur de secret n'est exposée. startsWith = 4 premiers caractères seulement.",
  });
}
