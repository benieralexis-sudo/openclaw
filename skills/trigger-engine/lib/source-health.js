'use strict';

const telegramAlert = require('./telegram-alert');

const SOURCE_THRESHOLDS_HOURS = {
  'bodacc': 12,
  'francetravail': 4,
  'joafe': 18,
  'rss-levees': 12,
  'news-buzz': 18,
  'google-trends': 30,
  'meta-ad-library': 30,
  'inpi': 30
};

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_health_alerts (
      source TEXT PRIMARY KEY,
      alerted_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function checkHealth(db, options = {}) {
  const log = options.log || console;
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.ADMIN_CHAT_ID || '1409505520';

  ensureTable(db);

  const sources = db.prepare(`
    SELECT source, last_run_at, events_last_run, errors_last_run, last_error, enabled,
           (julianday('now') - julianday(last_run_at)) * 24 as hours_since
    FROM ingestion_state
  `).all();

  const health = { ok: [], stale: [], error: [], alerted: 0 };
  const alertedCheck = db.prepare(`
    SELECT alerted_at, (julianday('now') - julianday(alerted_at)) * 24 as hours_since_alert
    FROM source_health_alerts WHERE source = ?
  `);
  const recordAlert = db.prepare(`
    INSERT OR REPLACE INTO source_health_alerts (source, alerted_at)
    VALUES (?, CURRENT_TIMESTAMP)
  `);

  for (const s of sources) {
    const threshold = SOURCE_THRESHOLDS_HOURS[s.source] || 24;
    const entry = { source: s.source, hours_since: s.hours_since, last_error: s.last_error };
    if (s.enabled === 0) {
      entry.state = 'disabled';
      health.ok.push(entry);
      continue;
    }
    if (s.hours_since == null || s.hours_since > threshold) {
      entry.state = 'stale';
      entry.threshold = threshold;
      health.stale.push(entry);
    } else if (s.errors_last_run > 0 && s.last_error) {
      entry.state = 'error';
      health.error.push(entry);
    } else {
      entry.state = 'ok';
      health.ok.push(entry);
    }
  }

  if (token && chatId) {
    for (const entry of [...health.stale, ...health.error]) {
      const existing = alertedCheck.get(entry.source);
      if (existing && existing.hours_since_alert < 12) continue;
      const msg = entry.state === 'stale'
        ? `⚠️ *Source silencieuse* : \`${entry.source}\`\nDernière ingestion : ${entry.hours_since?.toFixed(1) || '∞'}h (seuil ${entry.threshold}h)`
        : `⚠️ *Erreur ingestion* : \`${entry.source}\`\n${entry.last_error?.slice(0, 300) || 'erreur inconnue'}`;
      const r = await telegramAlert.sendTelegram(token, chatId, msg);
      if (r.ok) {
        recordAlert.run(entry.source);
        health.alerted += 1;
      }
    }
  }

  return health;
}

module.exports = { checkHealth };
