// ═══════════════════════════════════════════════════════════════════
// Google Trends Enricher — détection pics de recherche (FR)
// ═══════════════════════════════════════════════════════════════════
// Utilise la lib google-trends-api (installée dans skills/trigger-engine/lib).
//
// Signal détecté :
//   - Pic de recherche récent (valeur > avg × 2 sur les 2 derniers jours)
//   - Valeur absolue élevée (> 80) = activité de recherche soutenue
//
// Cache DB 24h (migration 006). Throttle 2s/req (Google bloque vite).
// Retry avec backoff car Google Trends renvoie parfois des 429 transients.
//
// Use case : complémentaire à News (Trends = intention utilisateur,
// News = buzz médias). Un pic Trends après une levée = signal d'attention.
// ═══════════════════════════════════════════════════════════════════

'use strict';

let trendsApi = null;
try {
  trendsApi = require('../lib/node_modules/google-trends-api');
} catch (e) {
  console.warn('[google-trends] google-trends-api not installed:', e.message);
}

const CACHE_TTL_MS = 24 * 3600 * 1000; // 24h
const MIN_INTERVAL_MS = 2000; // Google Trends throttle strict

let _lastRequestAt = 0;

function normalizeName(nom) {
  if (!nom) return '';
  return nom.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

async function throttle() {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  _lastRequestAt = Date.now();
}

/**
 * Détecte un pic de recherche dans les 2 derniers jours :
 * - last_value > avg × 2 (sur les jours précédents)
 * - et last_value > 30 (seuil minimum pour que le signal soit significatif)
 */
function detectSpike(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 3) return false;
  const values = timeline.map(d => (d.value?.[0] || 0));
  const last = values[values.length - 1];
  const last2 = values[values.length - 2];
  const prev = values.slice(0, -2);
  const avgPrev = prev.length > 0 ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
  const maxRecent = Math.max(last, last2);
  // Pic = recherche récente > 2x la moyenne précédente, avec floor de 30
  if (maxRecent > 30 && avgPrev > 0 && maxRecent > avgPrev * 2) return true;
  if (maxRecent >= 80 && avgPrev < 30) return true; // pic brutal depuis silence
  return false;
}

/**
 * Fetch + parse Google Trends pour un nom d'entreprise.
 */
async function fetchTrendsRaw(keyword, log) {
  if (!trendsApi) return null;
  await throttle();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * attempt));
    try {
      const raw = await trendsApi.interestOverTime({
        keyword,
        startTime: new Date(Date.now() - 7 * 24 * 3600 * 1000),
        geo: 'FR',
        hl: 'fr-FR'
      });
      const parsed = JSON.parse(raw);
      return parsed?.default?.timelineData || null;
    } catch (err) {
      log?.debug?.(`[google-trends] retry ${attempt + 1} for "${keyword}": ${err.message?.slice(0, 100)}`);
    }
  }
  return null;
}

/**
 * Fonction principale : retourne le signal trends d'une entreprise.
 * Cache 24h en DB.
 * @param {string} nom
 * @param {DatabaseSync} db
 * @param {object} [opts]
 * @returns {{max_7d, avg_7d, last_value, has_spike, timeline}|null}
 */
async function getTrendsSignal(nom, db, opts = {}) {
  if (!nom || !db) return null;
  const key = normalizeName(nom);
  if (!key || key.length < 3) return null;
  const log = opts.log;

  if (!opts.skipCache) {
    const cached = db.prepare('SELECT * FROM trends_cache WHERE normalized_name = ?').get(key);
    if (cached) {
      const age = Date.now() - new Date(cached.looked_up_at + 'Z').getTime();
      if (age < CACHE_TTL_MS) {
        return {
          max_7d: cached.max_7d,
          avg_7d: cached.avg_7d,
          last_value: cached.last_value,
          has_spike: !!cached.has_spike,
          timeline: JSON.parse(cached.timeline || '[]')
        };
      }
    }
  }

  const timeline = await fetchTrendsRaw(nom, log);
  if (!timeline) {
    // Cache négatif pour éviter retry hot loop
    db.prepare(`
      INSERT INTO trends_cache (normalized_name, max_7d, avg_7d, last_value, has_spike, timeline, looked_up_at)
      VALUES (?, 0, 0, 0, 0, '[]', CURRENT_TIMESTAMP)
      ON CONFLICT(normalized_name) DO UPDATE SET looked_up_at = CURRENT_TIMESTAMP
    `).run(key);
    return null;
  }

  const values = timeline.map(d => (d.value?.[0] || 0));
  const max_7d = Math.max(...values, 0);
  const avg_7d = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const last_value = values[values.length - 1] || 0;
  const has_spike = detectSpike(timeline) ? 1 : 0;

  db.prepare(`
    INSERT INTO trends_cache (normalized_name, max_7d, avg_7d, last_value, has_spike, timeline, looked_up_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(normalized_name) DO UPDATE SET
      max_7d = excluded.max_7d,
      avg_7d = excluded.avg_7d,
      last_value = excluded.last_value,
      has_spike = excluded.has_spike,
      timeline = excluded.timeline,
      looked_up_at = CURRENT_TIMESTAMP
  `).run(key, max_7d, avg_7d, last_value, has_spike, JSON.stringify(timeline));

  log?.debug?.(`[google-trends] ${nom}: last=${last_value}, avg=${avg_7d.toFixed(1)}, spike=${!!has_spike}`);

  return { max_7d, avg_7d, last_value, has_spike: !!has_spike, timeline };
}

/**
 * Ingester : check les matches actifs, génère events search_spike si pic détecté.
 */
async function ingest({ log, storage } = {}) {
  const db = storage?.db;
  if (!db) {
    log?.warn?.('[google-trends] no storage');
    return { events: [] };
  }

  const candidates = db.prepare(`
    SELECT DISTINCT c.siren, c.raison_sociale
    FROM companies c
    INNER JOIN patterns_matched pm ON pm.siren = c.siren
      AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
    LEFT JOIN trends_cache t ON t.normalized_name = LOWER(c.raison_sociale)
    WHERE c.raison_sociale IS NOT NULL AND LENGTH(c.raison_sociale) >= 3
      AND (t.looked_up_at IS NULL
           OR (julianday('now') - julianday(t.looked_up_at)) * 86400000 > ${CACHE_TTL_MS})
    ORDER BY (SELECT MAX(score) FROM patterns_matched WHERE siren = c.siren) DESC
    LIMIT 15
  `).all();

  const events = [];
  let spiked = 0;

  for (const c of candidates) {
    const signal = await getTrendsSignal(c.raison_sociale, db, { log });
    if (!signal) continue;
    if (signal.has_spike) {
      spiked += 1;
      events.push({
        source: 'google-trends',
        event_type: 'search_spike',
        siren: c.siren,
        attribution_confidence: 0.7,
        raw_data: {
          company_name: c.raison_sociale,
          max_7d: signal.max_7d,
          avg_7d: signal.avg_7d,
          last_value: signal.last_value
        },
        normalized: {
          company_name: c.raison_sociale,
          max_7d: signal.max_7d,
          avg_7d: Math.round(signal.avg_7d * 10) / 10,
          last_value: signal.last_value
        },
        event_date: new Date().toISOString().slice(0, 10)
      });
    }
  }

  log?.info?.(`[google-trends] ${candidates.length} checked, ${spiked} with search spike`);
  return { events, nextState: { last_event_id: new Date().toISOString() } };
}

module.exports = {
  ingest,
  getTrendsSignal,
  detectSpike,
  normalizeName
};
