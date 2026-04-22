-- ═══════════════════════════════════════════════════════════════════
-- Migration 003 — Cache buzz médias (Google News RSS)
-- ═══════════════════════════════════════════════════════════════════
-- Cache les résultats de requêtes Google News par nom d'entreprise.
-- TTL : 24h (au-delà, re-query).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news_buzz_cache (
  normalized_name TEXT PRIMARY KEY,
  articles_count  INTEGER DEFAULT 0,
  articles_24h    INTEGER DEFAULT 0,
  articles_7d     INTEGER DEFAULT 0,
  articles_30d    INTEGER DEFAULT 0,
  top_articles    TEXT,             -- JSON array {title, link, pubDate, source}
  looked_up_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_news_buzz_24h ON news_buzz_cache(articles_24h DESC);
CREATE INDEX IF NOT EXISTS idx_news_buzz_lookup ON news_buzz_cache(looked_up_at);
