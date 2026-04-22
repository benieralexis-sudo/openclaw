-- ═══════════════════════════════════════════════════════════════════
-- Migration 007 — Cache Meta Ad Library API
-- ═══════════════════════════════════════════════════════════════════
-- Cache les résultats de requêtes Ad Library par nom d'entreprise.
-- TTL : 24h (au-delà, re-query).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meta_ads_cache (
  cache_key  TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_fetched ON meta_ads_cache(fetched_at);
