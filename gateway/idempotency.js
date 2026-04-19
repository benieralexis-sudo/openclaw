// Phase A6 — Webhook idempotency
// Persists a Map<eventId, expiresAtMs> to disk so duplicate webhook deliveries
// (network retries from Instantly/Pharow/Rodz/Clay) are processed exactly once.
//
// Use:
//   const idem = require('./idempotency').forSource('instantly');
//   if (idem.isSeen(id)) { return res.writeHead(200).end('{"ok":true,"duplicate":true}'); }
//   await processEvent(...);
//   idem.markSeen(id);
//
// Storage: /data/webhooks/idempotency-<source>.json (env IDEMPOTENCY_DIR override)
// TTL: 24h default. Auto-cleanup on every save.

'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger.js');

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SAVE_INTERVAL_MS = 30 * 1000; // flush every 30s
const STORAGE_DIR = process.env.IDEMPOTENCY_DIR
  || (process.env.AUTOMAILER_DATA_DIR ? path.join(process.env.AUTOMAILER_DATA_DIR, 'webhooks') : '/data/webhooks');

const stores = new Map(); // source name → Store instance

class Store {
  constructor(source) {
    this.source = source;
    this.file = path.join(STORAGE_DIR, `idempotency-${source}.json`);
    this.entries = new Map(); // eventId → expiresAtMs
    this.dirty = false;
    this._load();
    this._scheduleSave();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const now = Date.now();
      for (const [id, exp] of Object.entries(raw)) {
        if (exp > now) this.entries.set(id, exp);
      }
      log.info('idempotency', `[${this.source}] loaded ${this.entries.size} entries`);
    } catch (e) {
      log.warn('idempotency', `[${this.source}] load failed: ${e.message}`);
    }
  }

  _scheduleSave() {
    setInterval(() => { if (this.dirty) this._save(); }, SAVE_INTERVAL_MS).unref();
    process.on('beforeExit', () => { if (this.dirty) this._save(); });
  }

  _save() {
    try {
      if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
      // Cleanup expired before writing
      const now = Date.now();
      for (const [id, exp] of this.entries) {
        if (exp <= now) this.entries.delete(id);
      }
      const obj = Object.fromEntries(this.entries);
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      log.warn('idempotency', `[${this.source}] save failed: ${e.message}`);
    }
  }

  isSeen(eventId) {
    if (!eventId) return false;
    const exp = this.entries.get(eventId);
    if (!exp) return false;
    if (exp <= Date.now()) {
      this.entries.delete(eventId);
      this.dirty = true;
      return false;
    }
    return true;
  }

  markSeen(eventId, ttlMs = TTL_MS) {
    if (!eventId) return;
    this.entries.set(eventId, Date.now() + ttlMs);
    this.dirty = true;
  }

  size() { return this.entries.size; }
}

function forSource(source) {
  if (!stores.has(source)) stores.set(source, new Store(source));
  return stores.get(source);
}

// Helper: compute a stable event ID from arbitrary payload fields.
// Prefer explicit IDs (event_id, signal_id, lead.id) over content hash.
function computeEventId(payload, fields = []) {
  for (const f of fields) {
    const v = f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), payload);
    if (v != null && v !== '') return String(v);
  }
  // Fallback: SHA-256 of full payload
  try {
    const crypto = require('crypto');
    return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

module.exports = { forSource, computeEventId, TTL_MS };
