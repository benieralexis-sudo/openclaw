import dotenv from 'dotenv';
import path from 'node:path';

const ROOT_ENV = '/opt/moltbot/.env';
const DASHBOARD_ENV = '/opt/moltbot/dashboard-v2/.env';

dotenv.config({ path: ROOT_ENV });
dotenv.config({ path: DASHBOARD_ENV, override: false });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function intEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * DRY_RUN flag — détecte si N'IMPORTE quel agent est en dry-run.
 * Accepte DOCTOR_DRY_RUN, AUDITOR_DRY_RUN, ..., AGENT_DRY_RUN.
 * Chaque agent peut surcharger via sa propre var (rétro-compat Doctor).
 */
function isDryRun() {
  return (
    process.env.AGENT_DRY_RUN === '1' ||
    process.env.DOCTOR_DRY_RUN === '1' ||
    process.env.AUDITOR_DRY_RUN === '1' ||
    process.env.WATCHDOG_DRY_RUN === '1' ||
    process.env.VALIDATOR_DRY_RUN === '1'
  );
}

export const ENV = {
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID: required('ADMIN_CHAT_ID'),
  DATABASE_URL: required('DATABASE_URL'),
  // Phase 2 (11/05/2026) — CRON_SECRET pour appeler les routes internes
  // dashboard-v2 (cost-report, audit-heal, health) depuis les agents.
  CRON_SECRET: process.env.CRON_SECRET ?? '',
  // URL base dashboard-v2 (localhost en prod, agents tournent sur même VPS)
  DASHBOARD_BASE_URL: process.env.DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3100',
  DRY_RUN: isDryRun(),
  // Doctrine Anthropic agents — timeout paramétrable par agent.
  // Default 8 min pour Doctor (run léger). Auditor surchargera à 15-20 min
  // (deep dives multi-source plus longs). Optim 2 (11/05/2026).
  AGENT_TIMEOUT_MS: intEnv('AGENT_TIMEOUT_MS', 8 * 60 * 1000),
  // Rate limit SQL queries per run (warn si dépassé). Optim 4 (11/05/2026).
  AGENT_MAX_SQL_QUERIES_PER_RUN: intEnv('AGENT_MAX_SQL_QUERIES_PER_RUN', 15),
};
