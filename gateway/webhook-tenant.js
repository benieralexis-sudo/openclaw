// Phase B2 — Webhook tenant routing.
//
// Each external service (Pharow, Rodz, Clay, Instantly) can be configured
// with one secret per tenant via env vars suffixed with the client name:
//
//   PHAROW_WEBHOOK_SECRET                  # global / fallback
//   PHAROW_WEBHOOK_SECRET_FIMMOP           # tenant-specific
//   PHAROW_WEBHOOK_SECRET_DIGITESTLAB      # tenant-specific
//
// On webhook receipt, this module checks the provided secret against ALL
// known tenant secrets (constant-time per comparison) and returns the
// matched tenant name, or null if no match.
//
// Usage:
//   const { resolveTenantFromSecret } = require('./webhook-tenant');
//   const tenant = resolveTenantFromSecret(req.headers['x-pharow-secret'], 'PHAROW_WEBHOOK_SECRET');
//   if (tenant === null) return res.writeHead(401).end();
//   const adminChat = getAdminChatId(tenant === '__global__' ? null : tenant);

'use strict';

const { safeEqual } = require('./webhook-auth.js');
const log = require('./logger.js');

const GLOBAL_TENANT = '__global__';

// Strip optional "Bearer " prefix and surrounding whitespace.
function _normalize(headerValue) {
  if (!headerValue) return '';
  return String(headerValue).replace(/^Bearer\s+/i, '').trim();
}

// Find all env vars whose key starts with prefix + '_' (per-tenant secrets).
// Returns Map<tenantName(lowercase), secret>.
function _enumerateTenantSecrets(prefix) {
  const out = new Map();
  const tenantPrefix = prefix + '_';
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (!k.startsWith(tenantPrefix)) continue;
    if (k === prefix) continue; // not a tenant variant
    const tenantPart = k.slice(tenantPrefix.length);
    if (!tenantPart) continue;
    out.set(tenantPart.toLowerCase(), String(v));
  }
  return out;
}

// Resolve tenant from a shared-secret header.
// - tenant variants checked in deterministic order (alphabetical by name)
// - global fallback checked last
// - returns tenant name (lowercase), '__global__', or null
function resolveTenantFromSecret(providedHeader, prefix) {
  const provided = _normalize(providedHeader);
  if (!provided) return null;

  // Per-tenant secrets first
  const tenantSecrets = _enumerateTenantSecrets(prefix);
  const sortedTenants = Array.from(tenantSecrets.keys()).sort();
  for (const tenant of sortedTenants) {
    if (safeEqual(provided, tenantSecrets.get(tenant))) return tenant;
  }

  // Global fallback (legacy single-tenant deployments)
  const globalSecret = process.env[prefix];
  if (globalSecret && safeEqual(provided, String(globalSecret))) {
    return GLOBAL_TENANT;
  }

  return null;
}

// HMAC variant: same enumeration logic but verifies HMAC signature instead.
function resolveTenantFromHmac(body, providedSig, prefix) {
  if (!providedSig) return null;
  const { verifyHmac } = require('./webhook-auth.js');

  const tenantSecrets = _enumerateTenantSecrets(prefix);
  const sortedTenants = Array.from(tenantSecrets.keys()).sort();
  for (const tenant of sortedTenants) {
    if (verifyHmac(body, tenantSecrets.get(tenant), providedSig)) return tenant;
  }

  const globalSecret = process.env[prefix];
  if (globalSecret && verifyHmac(body, String(globalSecret), providedSig)) {
    return GLOBAL_TENANT;
  }

  return null;
}

// Convenience: get list of all configured tenants for a given prefix.
// Useful for ops/admin endpoints.
function listTenantsFor(prefix) {
  const t = Array.from(_enumerateTenantSecrets(prefix).keys()).sort();
  if (process.env[prefix]) t.push(GLOBAL_TENANT);
  return t;
}

// Diagnostic: log a startup summary (which webhooks have which tenants).
// Call once at boot so ops can see config without dumping secrets.
function logTenantConfig() {
  const prefixes = [
    'PHAROW_WEBHOOK_SECRET',
    'RODZ_WEBHOOK_SECRET',
    'CLAY_WEBHOOK_SECRET',
    'INSTANTLY_WEBHOOK_SECRET',
  ];
  for (const p of prefixes) {
    const tenants = listTenantsFor(p);
    if (tenants.length === 0) {
      log.warn('webhook-tenant', `${p}: no secret configured (webhook will reject all requests)`);
    } else {
      log.info('webhook-tenant', `${p}: ${tenants.length} secret(s) configured (${tenants.join(', ')})`);
    }
  }
}

module.exports = {
  resolveTenantFromSecret,
  resolveTenantFromHmac,
  listTenantsFor,
  logTenantConfig,
  GLOBAL_TENANT,
};
