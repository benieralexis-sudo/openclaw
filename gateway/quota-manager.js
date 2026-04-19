// Phase B5 — Per-tenant API quota tracking and enforcement.
//
// Without this, one tenant burning Claude tokens or Pharow credits
// silently drains shared quota until other tenants get rate-limited at
// the API edge with no warning. Quota-manager fails fast LOCALLY before
// hitting the API, with a clear error including current usage.
//
// Storage: JSON file at /data/quotas/usage-<period>.json (per period bucket).
// Periods: daily (rolls at 00:00 UTC), monthly (rolls 1st of month).
// Atomic writes via .tmp+rename to survive crashes.
//
// Usage:
//   const q = require('./quota-manager').forCurrentTenant();
//   q.check('claude:tokens_daily', 1500);   // throws QuotaExceeded if would exceed
//   ...call API...
//   q.increment('claude:tokens_daily', actualTokensUsed);
//
// Quota limits configured via env: QUOTA_<RESOURCE>=<value> (e.g.
// QUOTA_CLAUDE_TOKENS_DAILY=200000). Per-tenant overrides via
// QUOTA_<RESOURCE>_<TENANT>=<value> (e.g. QUOTA_CLAUDE_TOKENS_DAILY_FIMMOP).

'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger.js');

const STORAGE_DIR = process.env.QUOTA_DIR
  || (process.env.AUTOMAILER_DATA_DIR ? path.join(process.env.AUTOMAILER_DATA_DIR, 'quotas') : '/data/quotas');
const SAVE_INTERVAL_MS = 30 * 1000;

// Resource periods — drives storage bucket and rollover behavior.
const PERIODS = {
  daily: () => new Date().toISOString().slice(0, 10),       // YYYY-MM-DD UTC
  monthly: () => new Date().toISOString().slice(0, 7),      // YYYY-MM UTC
  hourly: () => new Date().toISOString().slice(0, 13),       // YYYY-MM-DDTHH
};

// Default limits — can be overridden via env. 0 means unlimited (no enforcement).
// Sized for a 5-client cap on the existing infra (cf. phase-a/b roadmap).
const DEFAULT_LIMITS = {
  'claude:tokens_daily': 500000,        // 500k tokens/day/tenant — generous, won't bite for normal use
  'claude:requests_daily': 10000,
  'openai:tokens_daily': 200000,
  'openai:requests_daily': 5000,
  'pharow:profiles_monthly': 100000,    // Pharow Essentiel = 10M total / shared across tenants
  'rodz:signals_daily': 500,
  'dropcontact:credits_monthly': 1000,
  'resend:emails_daily': 5000,
};

class QuotaStore {
  constructor() {
    this.entries = new Map(); // `${period}:${resource}:${tenant}` → count
    this.dirty = false;
    this.tenant = process.env.CLIENT_NAME || 'global';
    this._load();
    this._scheduleSave();
  }

  _periodFor(resource) {
    if (resource.endsWith('_daily')) return PERIODS.daily();
    if (resource.endsWith('_monthly')) return PERIODS.monthly();
    if (resource.endsWith('_hourly')) return PERIODS.hourly();
    return PERIODS.daily(); // default
  }

  _file() {
    return path.join(STORAGE_DIR, 'usage.json');
  }

  _load() {
    try {
      if (!fs.existsSync(this._file())) return;
      const raw = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const [k, v] of Object.entries(raw)) this.entries.set(k, Number(v) || 0);
      log.info('quota-manager', `loaded ${this.entries.size} entries (tenant=${this.tenant})`);
    } catch (e) {
      log.warn('quota-manager', `load failed: ${e.message}`);
    }
  }

  _scheduleSave() {
    setInterval(() => { if (this.dirty) this._save(); }, SAVE_INTERVAL_MS).unref();
    process.on('beforeExit', () => { if (this.dirty) this._save(); });
  }

  _save() {
    try {
      if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
      // GC: drop entries older than 90 days to keep file small
      const cutoffDay = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); })();
      for (const k of this.entries.keys()) {
        const period = k.split(':')[0];
        if (/^\d{4}-\d{2}-\d{2}/.test(period) && period < cutoffDay) this.entries.delete(k);
      }
      const obj = Object.fromEntries(this.entries);
      const tmp = this._file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, this._file());
      this.dirty = false;
    } catch (e) {
      log.warn('quota-manager', `save failed: ${e.message}`);
    }
  }

  _key(resource, tenant) {
    return `${this._periodFor(resource)}:${resource}:${tenant || this.tenant}`;
  }

  _limit(resource, tenant) {
    const t = (tenant || this.tenant || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const r = resource.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    // tenant-specific override first
    if (t) {
      const v = process.env[`QUOTA_${r}_${t}`];
      if (v != null && v !== '') return Number(v);
    }
    // global override
    const v = process.env[`QUOTA_${r}`];
    if (v != null && v !== '') return Number(v);
    // built-in default
    return DEFAULT_LIMITS[resource] != null ? DEFAULT_LIMITS[resource] : 0;
  }

  // Check quota WITHOUT mutating. Throws QuotaExceededError if exceeding.
  // amount = the units this call is about to consume (default 1).
  check(resource, amount = 1, tenant = null) {
    const limit = this._limit(resource, tenant);
    if (!limit) return; // 0 = unlimited
    const current = this.entries.get(this._key(resource, tenant)) || 0;
    if (current + amount > limit) {
      const err = new Error(`Quota exceeded: ${resource} (current=${current}, limit=${limit}, requested=${amount}, tenant=${tenant || this.tenant})`);
      err.code = 'QUOTA_EXCEEDED';
      err.resource = resource;
      err.current = current;
      err.limit = limit;
      throw err;
    }
  }

  // Atomic check+increment for the common case "I'm about to consume N units".
  // Returns the new running total.
  consume(resource, amount = 1, tenant = null) {
    this.check(resource, amount, tenant);
    return this.increment(resource, amount, tenant);
  }

  increment(resource, amount = 1, tenant = null) {
    const k = this._key(resource, tenant);
    const next = (this.entries.get(k) || 0) + amount;
    this.entries.set(k, next);
    this.dirty = true;
    return next;
  }

  usage(resource, tenant = null) {
    return this.entries.get(this._key(resource, tenant)) || 0;
  }

  remaining(resource, tenant = null) {
    const limit = this._limit(resource, tenant);
    if (!limit) return Infinity;
    return Math.max(0, limit - this.usage(resource, tenant));
  }

  // Snapshot of current tenant's usage across all known resources.
  snapshot(tenant = null) {
    const t = tenant || this.tenant;
    const result = {};
    for (const resource of Object.keys(DEFAULT_LIMITS)) {
      const used = this.usage(resource, t);
      const limit = this._limit(resource, t);
      result[resource] = {
        used,
        limit: limit || null,
        percent: limit ? Math.round((used / limit) * 100) : null,
      };
    }
    return result;
  }
}

// Singleton — one store per process (= per container = per tenant)
let _instance = null;
function forCurrentTenant() {
  if (!_instance) _instance = new QuotaStore();
  return _instance;
}

// Reset singleton for tests
function _resetForTests() {
  _instance = null;
}

module.exports = { forCurrentTenant, _resetForTests, DEFAULT_LIMITS };
