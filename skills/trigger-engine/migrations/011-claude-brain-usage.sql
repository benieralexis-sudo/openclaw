-- ───── CLAUDE BRAIN USAGE ─────
-- Tracking granulaire coûts Opus par tenant pour budget + alertes.
-- Une ligne par appel API Anthropic.

CREATE TABLE IF NOT EXISTS claude_brain_usage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  pipeline       TEXT NOT NULL,
  siren          TEXT,
  tokens_input   INTEGER NOT NULL,
  tokens_output  INTEGER NOT NULL,
  tokens_cached  INTEGER DEFAULT 0,
  cost_eur       REAL NOT NULL,
  model          TEXT NOT NULL,
  success        INTEGER DEFAULT 1,         -- 0 si l'appel a échoué mais a consommé des tokens
  month_key      TEXT NOT NULL,             -- 'YYYY-MM' pour agrégation rapide
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbu_tenant_month ON claude_brain_usage(tenant_id, month_key);
CREATE INDEX IF NOT EXISTS idx_cbu_created ON claude_brain_usage(created_at DESC);

-- Table alert state pour dedup soft/hard limit
CREATE TABLE IF NOT EXISTS claude_brain_budget_alerts (
  tenant_id      TEXT NOT NULL,
  month_key      TEXT NOT NULL,
  level          TEXT NOT NULL,             -- 'soft' | 'hard'
  alerted_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, month_key, level)
);
