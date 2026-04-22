-- ═══════════════════════════════════════════════════════════════════
-- Migration 006 — Cache Google Trends
-- ═══════════════════════════════════════════════════════════════════
-- Cache les résultats de requêtes Google Trends par nom d'entreprise.
-- TTL : 24h. Les valeurs sont relatives (0-100).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trends_cache (
  normalized_name  TEXT PRIMARY KEY,
  max_7d           INTEGER DEFAULT 0,
  avg_7d           REAL DEFAULT 0,
  last_value       INTEGER DEFAULT 0,
  has_spike        INTEGER DEFAULT 0,       -- 1 si pic détecté dans les 2 derniers jours
  timeline         TEXT,                    -- JSON array des 8 derniers datapoints
  looked_up_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trends_spike ON trends_cache(has_spike) WHERE has_spike = 1;
CREATE INDEX IF NOT EXISTS idx_trends_lookup ON trends_cache(looked_up_at);
