// ═══════════════════════════════════════════════════════════════════
// Meta Ad Library enricher — détection ad spend actif sur FB/IG
// ═══════════════════════════════════════════════════════════════════
// Source: Graph API /ads_archive (gratuit, imposé par DSA)
// Requires: META_AD_LIBRARY_TOKEN dans .env + vérif identité facebook.com/ID
//
// Signal: entreprise FR avec >= 1 pub active = budget marketing actif = signal scaling
//
// Usage enricher (comme news-buzz):
//   const { getAdSpendSignal } = require('./sources/meta-ad-library');
//   const signal = await getAdSpendSignal('Axomove', db);
//   // { active_ads_count, platforms, top_ads }
//
// Cache DB 24h (migration 007). Throttle 1.1s/req.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const API_BASE = 'https://graph.facebook.com/v19.0/ads_archive';
const CACHE_TTL_MS = 24 * 3600 * 1000;
const MIN_INTERVAL_MS = 1100;

let _lastRequestAt = 0;

async function throttle() {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  _lastRequestAt = Date.now();
}

function normalizeName(nom) {
  if (!nom) return '';
  return nom.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function readCache(db, key) {
  try {
    const row = db.prepare('SELECT data, fetched_at FROM meta_ads_cache WHERE cache_key = ?').get(key);
    if (!row) return null;
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (age > CACHE_TTL_MS) return null;
    return JSON.parse(row.data);
  } catch { return null; }
}

function writeCache(db, key, data) {
  try {
    db.prepare(`INSERT INTO meta_ads_cache (cache_key, data, fetched_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET data=excluded.data, fetched_at=CURRENT_TIMESTAMP`)
      .run(key, JSON.stringify(data));
  } catch {}
}

/**
 * Récupère les pubs actives FR d'une entreprise via son nom.
 * Retourne null si pas de token ou permission refusée.
 */
async function getAdSpendSignal(companyName, db, { log } = {}) {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) return null;

  const key = normalizeName(companyName);
  if (!key) return null;

  const cached = readCache(db, key);
  if (cached) return cached;

  await throttle();

  const url = new URL(API_BASE);
  url.searchParams.set('search_terms', companyName);
  url.searchParams.set('ad_reached_countries', '["FR"]');
  url.searchParams.set('ad_active_status', 'ACTIVE');
  url.searchParams.set('fields', 'id,page_name,page_id,ad_creation_time,ad_delivery_start_time,publisher_platforms');
  url.searchParams.set('limit', '25');
  url.searchParams.set('access_token', token);

  let res;
  try {
    res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  } catch (err) {
    log?.warn?.('[meta-ad-library] fetch error:', err.message);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Code 2332004 = identity verification required, wait silently
    if (body.includes('2332004') || body.includes('App role required')) {
      log?.warn?.('[meta-ad-library] identity verification pending at facebook.com/ID');
      return null;
    }
    log?.warn?.('[meta-ad-library] http', res.status, body.slice(0, 200));
    return null;
  }

  const json = await res.json().catch(() => null);
  if (!json?.data) return null;

  const ads = json.data;
  const platforms = new Set();
  for (const ad of ads) {
    if (Array.isArray(ad.publisher_platforms)) ad.publisher_platforms.forEach(p => platforms.add(p));
  }

  const signal = {
    active_ads_count: ads.length,
    platforms: Array.from(platforms),
    page_name: ads[0]?.page_name || null,
    page_id: ads[0]?.page_id || null,
    top_ads: ads.slice(0, 5).map(a => ({
      id: a.id,
      created: a.ad_creation_time,
      started: a.ad_delivery_start_time
    }))
  };

  writeCache(db, key, signal);
  return signal;
}

/**
 * Ingester batch : check les matches actifs sans ad-spend signal récent.
 * Crée events `ad_spend_detected` pour companies avec >= 3 pubs actives.
 */
async function ingest({ lastEventId, log, handler } = {}) {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) {
    log?.info?.('[meta-ad-library] no token, skip');
    return { events: [], nextState: { last_event_id: lastEventId, last_error: 'no-token' } };
  }

  const db = handler?.storage?.db;
  if (!db) return { events: [], nextState: { last_event_id: lastEventId, last_error: 'no-db' } };

  // Prend les matches actifs dont le nom est connu (pas de FT/ASS pseudo-sirens)
  const candidates = db.prepare(`
    SELECT DISTINCT c.siren, c.raison_sociale
    FROM patterns_matched pm
    JOIN companies c ON c.siren = pm.siren
    WHERE c.siren NOT LIKE 'FT%' AND c.siren NOT LIKE 'ASS%'
      AND c.raison_sociale IS NOT NULL
    ORDER BY pm.score DESC
    LIMIT 50
  `).all();

  const events = [];
  let checked = 0;
  let withAds = 0;

  for (const c of candidates) {
    const signal = await getAdSpendSignal(c.raison_sociale, db, { log });
    checked++;
    if (!signal) continue;
    if (signal.active_ads_count >= 3) {
      withAds++;
      events.push({
        source: 'meta-ad-library',
        source_event_id: `meta_${c.siren}_${Date.now()}`,
        event_type: 'ad_spend_detected',
        event_date: new Date().toISOString(),
        siren: c.siren,
        raw_company_name: c.raison_sociale,
        raw_data: {
          active_ads: signal.active_ads_count,
          platforms: signal.platforms,
          page_name: signal.page_name
        },
        confidence: 0.85
      });
    }
  }

  log?.info?.(`[meta-ad-library] checked ${checked} candidates, ${withAds} with active ads`);

  return {
    events,
    nextState: { last_event_id: lastEventId, last_run_at: new Date().toISOString() }
  };
}

module.exports = { ingest, getAdSpendSignal };
