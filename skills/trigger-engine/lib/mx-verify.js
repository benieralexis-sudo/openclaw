'use strict';

const dns = require('node:dns').promises;
const path = require('node:path');
const fs = require('node:fs');

const MX_CACHE_TTL_DAYS = 30;

function ensureMxMigration(db) {
  try {
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '008-mx-cache.sql'), 'utf8'));
  } catch (e) {
    // ignore — migration might already be applied
  }
}

async function verifyDomain(domain, db, { log } = {}) {
  if (!domain) return { ok: false, reason: 'no-domain' };
  const clean = String(domain).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(clean)) {
    return { ok: false, reason: 'invalid-format' };
  }

  if (db) {
    ensureMxMigration(db);
    const cached = db.prepare(
      `SELECT has_mx, mx_records, checked_at,
              (julianday('now') - julianday(checked_at)) as age_days
       FROM mx_cache WHERE domain = ?`
    ).get(clean);
    if (cached && cached.age_days < MX_CACHE_TTL_DAYS) {
      return {
        ok: cached.has_mx === 1,
        reason: cached.has_mx === 1 ? 'cache-hit' : 'no-mx-cached',
        records: cached.mx_records ? JSON.parse(cached.mx_records) : null,
        cached: true
      };
    }
  }

  let records = null;
  let ok = false;
  let reason = '';
  try {
    records = await dns.resolveMx(clean);
    ok = Array.isArray(records) && records.length > 0;
    reason = ok ? 'mx-ok' : 'no-mx-records';
  } catch (err) {
    ok = false;
    reason = err.code || 'dns-error';
  }

  if (db) {
    try {
      db.prepare(`
        INSERT INTO mx_cache (domain, has_mx, mx_records, checked_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(domain) DO UPDATE SET
          has_mx = excluded.has_mx,
          mx_records = excluded.mx_records,
          checked_at = CURRENT_TIMESTAMP
      `).run(clean, ok ? 1 : 0, records ? JSON.stringify(records) : null);
    } catch (e) {
      log?.warn?.(`[mx-verify] cache write failed for ${clean}: ${e.message}`);
    }
  }

  return { ok, reason, records, cached: false };
}

module.exports = { verifyDomain };
