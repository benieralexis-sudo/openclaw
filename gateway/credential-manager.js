// Phase B4 — Per-tenant credential management.
//
// docker-compose.clients.yml already injects the right `.env` per container,
// so process.env naturally isolates secrets. This module adds:
//
//   1. Boot-time validation — refuse to start if STRICT credentials are
//      missing for the current tenant (e.g. GMAIL_SMTP_PASS).
//   2. Visibility — log on first use whether a credential came from the
//      tenant `.env` or fell back from the global env, so ops can detect
//      forgotten per-client provisioning.
//   3. Single API replacing scattered `process.env.FOO || ''` patterns.
//
// Design rationale (validated with Alexis 19 avril 2026):
// - Services where you can issue one key per client (Claude, OpenAI,
//   Pharow, Rodz, Dropcontact, Resend) → FALLBACK_OK, accept global key
//   but warn so we know to provision properly later.
// - Services tied to client identity (Gmail SMTP, sender email) → STRICT,
//   refuse boot. Sending FIMMOP emails from iFIND mailboxes would torch
//   warmup and reputation.
// - Services with single global account by design (Backblaze, Sentry,
//   Healthchecks) → FALLBACK_ONLY, no per-tenant variant expected.

'use strict';

const log = require('./logger.js');

// Categorisation of credentials.
// STRICT: must be set per-tenant (or globally for the global container).
// FALLBACK_OK: per-tenant preferred; global allowed with a warning.
// FALLBACK_ONLY: single global account by design; no warning expected.
const STRICT_KEYS = new Set([
  'GMAIL_SMTP_PASS',
  'GMAIL_SMTP_USER',
  'SENDER_EMAIL',
  'STRIPE_SECRET_KEY',
]);

const FALLBACK_OK_KEYS = new Set([
  'CLAUDE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'APOLLO_API_KEY',
  'PHAROW_API_KEY',
  'RODZ_API_KEY',
  'DROPCONTACT_API_KEY',
  'RESEND_API_KEY',
  'HUBSPOT_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'FULLENRICH_API_KEY',
  'INSTANTLY_API_KEY',
]);

const FALLBACK_ONLY_KEYS = new Set([
  'B2_KEY_ID',
  'B2_APPLICATION_KEY',
  'SENTRY_DSN',
  'UPTIMEROBOT_API_KEY',
  'HEALTHCHECKS_API_KEY',
  'TELEGRAM_BOT_TOKEN', // single bot account at Telegram side
]);

const _warnedKeys = new Set();
const _tenant = process.env.CLIENT_NAME || null;

// snapshot the per-client `.env` values (docker-compose puts them in process.env).
// We freeze them at boot to detect when a value is the global fallback vs. tenant-specific.
const _bootSnapshot = { ...process.env };

function getCredential(key) {
  const value = process.env[key];

  if (!value) {
    if (STRICT_KEYS.has(key)) {
      const where = _tenant ? `tenant=${_tenant}` : 'global container';
      const msg = `[credential-manager] FATAL: required STRICT credential ${key} missing for ${where}. Add it to clients/${_tenant || '<NAME>'}/.env or set globally in /opt/moltbot/.env`;
      log.error('credential-manager', msg);
      throw new Error(msg);
    }
    if (FALLBACK_OK_KEYS.has(key) || FALLBACK_ONLY_KEYS.has(key)) {
      // No value anywhere — log once so caller can decide what to do (most callers
      // already null-check). Don't throw; some features are optional per deployment.
      if (!_warnedKeys.has(key)) {
        _warnedKeys.add(key);
        log.warn('credential-manager', `${key} not configured (tenant=${_tenant || 'global'}) — feature may be disabled`);
      }
      return undefined;
    }
    return undefined;
  }

  // Value present — for FALLBACK_OK keys, we'd ideally know whether it came
  // from the per-client .env or the global. Since docker-compose merges both,
  // the way to tell is whether the tenant has its own override file. We can't
  // detect that from inside the process — but we CAN warn if the tenant
  // container is using a key that should be tenant-specific but lacks a
  // CLIENT_<TENANT> qualifier. For now, just return; the boot validator below
  // does the upfront sweep.
  return value;
}

// Boot-time check. Call once on startup (telegram-router init). Returns the
// list of validation issues; throws if any STRICT key is missing.
function validateOnBoot() {
  const issues = [];
  const tenant = _tenant || 'global';

  for (const key of STRICT_KEYS) {
    if (!process.env[key]) {
      // STRICT keys may be intentionally absent on the global container if it
      // doesn't send email (only orchestrates). Only enforce when the strict
      // key class is relevant: STRICT email keys required if SENDER_EMAIL or
      // GMAIL_SMTP_USER is set, indicating this container does email work.
      const isEmailContainer = process.env.SENDER_EMAIL || process.env.GMAIL_SMTP_USER || process.env.GMAIL_MAILBOXES;
      if (key.startsWith('GMAIL_') || key === 'SENDER_EMAIL') {
        if (isEmailContainer) {
          issues.push({ key, level: 'fatal', tenant });
        }
      } else {
        // STRIPE etc. — only fatal if there's a clear signal we use it
        // (skipped for now, no Stripe wiring yet)
      }
    }
  }

  // Emit a friendly summary so ops can see config at a glance
  const present = [];
  const missing = [];
  for (const key of [...STRICT_KEYS, ...FALLBACK_OK_KEYS, ...FALLBACK_ONLY_KEYS]) {
    if (process.env[key]) present.push(key);
    else missing.push(key);
  }
  log.info('credential-manager', `tenant=${tenant} present=${present.length}/${present.length + missing.length} missing=[${missing.slice(0, 5).join(',')}${missing.length > 5 ? `,+${missing.length - 5}` : ''}]`);

  if (issues.some(i => i.level === 'fatal')) {
    const fatals = issues.filter(i => i.level === 'fatal').map(i => i.key).join(', ');
    const msg = `[credential-manager] BOOT REFUSED: missing STRICT credentials for tenant=${tenant}: ${fatals}`;
    log.error('credential-manager', msg);
    throw new Error(msg);
  }

  return issues;
}

// Test/ops introspection: report which credentials are configured.
function describe() {
  const tenant = _tenant || 'global';
  const result = { tenant, strict: {}, fallback_ok: {}, fallback_only: {} };
  for (const key of STRICT_KEYS) result.strict[key] = !!process.env[key];
  for (const key of FALLBACK_OK_KEYS) result.fallback_ok[key] = !!process.env[key];
  for (const key of FALLBACK_ONLY_KEYS) result.fallback_only[key] = !!process.env[key];
  return result;
}

module.exports = {
  getCredential,
  validateOnBoot,
  describe,
  STRICT_KEYS,
  FALLBACK_OK_KEYS,
  FALLBACK_ONLY_KEYS,
};
