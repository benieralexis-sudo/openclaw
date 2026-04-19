// Phase B6 — Admin chat ID resolver per-tenant.
//
// Single source of truth for "where do system notifications go?".
// Replaces 20+ hardcoded `process.env.ADMIN_CHAT_ID || '1409505520'`
// fallbacks scattered across gateway/, skills/, scripts/.
//
// Resolution priority (first non-empty wins):
//   1. explicit clientId arg → CLIENT_ADMIN_CHAT_ID_<UPPER_CLIENTID>
//   2. process.env.CLIENT_NAME → CLIENT_ADMIN_CHAT_ID_<UPPER_CLIENT_NAME>
//   3. process.env.ADMIN_CHAT_ID
//   4. legacy hardcoded fallback (1409505520) for back-compat — logged as warning
//
// Usage:
//   const { getAdminChatId } = require('./admin-resolver');
//   sendMessage(getAdminChatId(), text);                  // current container's admin
//   sendMessage(getAdminChatId('fimmop'), text);          // specific tenant's admin
//   for (const id of getAllAdminChatIds()) { ... }        // broadcast system

'use strict';

const log = require('./logger.js');

const LEGACY_FALLBACK = '1409505520'; // Alexis's personal chat — last-resort safety net
let _legacyFallbackWarnedOnce = false;

function _envKeyFor(clientId) {
  return 'CLIENT_ADMIN_CHAT_ID_' + String(clientId).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function getAdminChatId(clientId) {
  // 1. explicit clientId
  if (clientId) {
    const v = process.env[_envKeyFor(clientId)];
    if (v) return v;
  }
  // 2. CLIENT_NAME injected by docker-compose
  const envClient = process.env.CLIENT_NAME;
  if (envClient && !clientId) {
    const v = process.env[_envKeyFor(envClient)];
    if (v) return v;
  }
  // 3. global ADMIN_CHAT_ID
  if (process.env.ADMIN_CHAT_ID) return process.env.ADMIN_CHAT_ID;
  // 4. legacy hardcoded — warn once per process so we know there's a config gap
  if (!_legacyFallbackWarnedOnce) {
    _legacyFallbackWarnedOnce = true;
    log.warn('admin-resolver', 'No ADMIN_CHAT_ID configured for tenant=' + (clientId || envClient || 'global') + ' — using legacy fallback. Configure ADMIN_CHAT_ID or ' + _envKeyFor(clientId || envClient || 'GLOBAL') + ' in env.');
  }
  return LEGACY_FALLBACK;
}

// Return all configured admin chat IDs (for system-wide broadcasts).
// Deduplicates so the same admin is not pinged twice if multiple tenants share one.
function getAllAdminChatIds() {
  const ids = new Set();
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLIENT_ADMIN_CHAT_ID_') && v) ids.add(v);
  }
  if (process.env.ADMIN_CHAT_ID) ids.add(process.env.ADMIN_CHAT_ID);
  if (ids.size === 0) ids.add(LEGACY_FALLBACK);
  return Array.from(ids);
}

// Reverse-lookup: given a chat ID, return the tenant name (or null if global / unknown).
// Used by routes that receive a chat ID and need to derive context.
function getClientFromAdminChatId(chatId) {
  if (!chatId) return null;
  const target = String(chatId);
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLIENT_ADMIN_CHAT_ID_') && String(v) === target) {
      return k.replace(/^CLIENT_ADMIN_CHAT_ID_/, '').toLowerCase();
    }
  }
  return null;
}

module.exports = {
  getAdminChatId,
  getAllAdminChatIds,
  getClientFromAdminChatId,
  LEGACY_FALLBACK,
};
