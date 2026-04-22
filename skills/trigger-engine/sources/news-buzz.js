// ═══════════════════════════════════════════════════════════════════
// News Buzz Enricher — Google News RSS (gratuit, pas d'auth)
// ═══════════════════════════════════════════════════════════════════
// Détecte le buzz médias autour d'une entreprise FR via Google News.
// Signal : nombre d'articles parus dans les 24h / 7j / 30j.
//
// Usage:
//   const { getBuzzSignal } = require('./sources/news-buzz');
//   const buzz = await getBuzzSignal('Axomove', db);
//   // { articles_24h, articles_7d, articles_30d, top_articles }
//
// Cache DB 24h (migration 003). Throttle 1 req/sec.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { XMLParser } = require('fast-xml-parser');

const NEWS_URL = 'https://news.google.com/rss/search';
const USER_AGENT = 'Mozilla/5.0 iFIND-TriggerEngine/1.0';
const CACHE_TTL_MS = 24 * 3600 * 1000; // 24h

let _lastRequestAt = 0;
const MIN_INTERVAL_MS = 1000;

const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });

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

function cleanText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v.__cdata) return v.__cdata;
  return String(v);
}

function parseArticles(xml) {
  try {
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item || [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map(it => {
      const title = cleanText(it.title);
      const link = cleanText(it.link);
      const pubDate = it.pubDate ? new Date(it.pubDate) : null;
      const source = cleanText(it.source?.['#text'] || it.source) || '';
      return { title, link, pubDate: pubDate && !isNaN(pubDate) ? pubDate.toISOString() : null, source };
    });
  } catch {
    return [];
  }
}

function classifyByAge(articles) {
  const now = Date.now();
  const _24h = articles.filter(a => a.pubDate && (now - new Date(a.pubDate).getTime()) < 24 * 3600 * 1000);
  const _7d = articles.filter(a => a.pubDate && (now - new Date(a.pubDate).getTime()) < 7 * 24 * 3600 * 1000);
  const _30d = articles.filter(a => a.pubDate && (now - new Date(a.pubDate).getTime()) < 30 * 24 * 3600 * 1000);
  return {
    articles_count: articles.length,
    articles_24h: _24h.length,
    articles_7d: _7d.length,
    articles_30d: _30d.length,
    top_articles: articles.slice(0, 5)
  };
}

/**
 * Cherche le buzz médias d'une entreprise via Google News RSS.
 * Résultat caché en DB pour 24h.
 * @param {string} nom
 * @param {DatabaseSync} db
 * @param {object} [opts] - { log, skipCache }
 * @returns {{articles_count, articles_24h, articles_7d, articles_30d, top_articles}|null}
 */
async function getBuzzSignal(nom, db, opts = {}) {
  if (!nom || !db) return null;
  const key = normalizeName(nom);
  if (!key) return null;
  const log = opts.log;

  // Cache hit si <24h
  if (!opts.skipCache) {
    const cached = db.prepare('SELECT * FROM news_buzz_cache WHERE normalized_name = ?').get(key);
    if (cached) {
      const age = Date.now() - new Date(cached.looked_up_at + 'Z').getTime();
      if (age < CACHE_TTL_MS) {
        return {
          articles_count: cached.articles_count,
          articles_24h: cached.articles_24h,
          articles_7d: cached.articles_7d,
          articles_30d: cached.articles_30d,
          top_articles: JSON.parse(cached.top_articles || '[]')
        };
      }
    }
  }

  await throttle();
  const url = `${NEWS_URL}?q=${encodeURIComponent('"' + nom + '"')}&hl=fr&gl=FR&ceid=FR:fr`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      log?.warn?.(`[news-buzz] HTTP ${res.status} for "${nom}"`);
      return null;
    }
    const xml = await res.text();
    const articles = parseArticles(xml);
    const stats = classifyByAge(articles);

    db.prepare(`
      INSERT INTO news_buzz_cache (normalized_name, articles_count, articles_24h, articles_7d, articles_30d, top_articles, looked_up_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(normalized_name) DO UPDATE SET
        articles_count = excluded.articles_count,
        articles_24h = excluded.articles_24h,
        articles_7d = excluded.articles_7d,
        articles_30d = excluded.articles_30d,
        top_articles = excluded.top_articles,
        looked_up_at = CURRENT_TIMESTAMP
    `).run(key, stats.articles_count, stats.articles_24h, stats.articles_7d, stats.articles_30d, JSON.stringify(stats.top_articles));

    log?.debug?.(`[news-buzz] ${nom}: ${stats.articles_24h}×24h, ${stats.articles_7d}×7d, ${stats.articles_30d}×30d`);
    return stats;
  } catch (err) {
    log?.warn?.(`[news-buzz] fetch error for "${nom}": ${err.message}`);
    return null;
  }
}

/**
 * Ingester standard : pour chaque company matchée récemment sans buzz cache,
 * query Google News et insère des events "media_buzz" si volume significatif.
 *
 * Seuil : 3+ articles sur 7 jours = signal buzz suffisant pour pattern.
 */
async function ingest({ lastEventId, log, storage } = {}) {
  const db = storage?.db;
  if (!db) {
    log?.warn?.('[news-buzz] no storage, skipping');
    return { events: [] };
  }

  // Prend les companies avec au moins 1 match actif, non buzz-checked depuis 24h
  const candidates = db.prepare(`
    SELECT DISTINCT c.siren, c.raison_sociale
    FROM companies c
    INNER JOIN patterns_matched pm ON pm.siren = c.siren
      AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
    LEFT JOIN news_buzz_cache n ON n.normalized_name = LOWER(c.raison_sociale)
    WHERE c.raison_sociale IS NOT NULL AND LENGTH(c.raison_sociale) > 3
      AND (n.looked_up_at IS NULL
           OR (julianday('now') - julianday(n.looked_up_at)) * 86400 > 86400)
    ORDER BY c.raison_sociale
    LIMIT 20
  `).all();

  const events = [];
  let buzzed = 0;

  for (const c of candidates) {
    const buzz = await getBuzzSignal(c.raison_sociale, db, { log });
    if (!buzz) continue;
    if (buzz.articles_7d >= 3) {
      buzzed += 1;
      events.push({
        source: 'news-buzz',
        event_type: 'media_buzz',
        siren: c.siren,
        attribution_confidence: 0.75,
        raw_data: {
          company_name: c.raison_sociale,
          articles_24h: buzz.articles_24h,
          articles_7d: buzz.articles_7d,
          articles_30d: buzz.articles_30d,
          top: buzz.top_articles
        },
        normalized: {
          company_name: c.raison_sociale,
          articles_7d: buzz.articles_7d,
          top_titles: (buzz.top_articles || []).slice(0, 3).map(a => a.title)
        },
        event_date: new Date().toISOString().slice(0, 10)
      });
    }
  }

  log?.info?.(`[news-buzz] ${candidates.length} candidates checked, ${buzzed} with buzz ≥ 3 articles/7d`);
  return { events, nextState: { last_event_id: new Date().toISOString() } };
}

module.exports = {
  ingest,
  getBuzzSignal,
  normalizeName
};
