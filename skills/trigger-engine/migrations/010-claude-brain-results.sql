-- ───── CLAUDE BRAIN RESULTS ─────
-- Stockage versionné des sorties Opus par pipeline.
-- Régénérer un pitch produit une nouvelle version, on garde l'historique.

CREATE TABLE IF NOT EXISTS claude_brain_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  pipeline       TEXT NOT NULL,
  siren          TEXT,
  job_id         INTEGER,                   -- FK soft vers claude_brain_queue.id
  version        INTEGER NOT NULL DEFAULT 1,
  result_json    TEXT NOT NULL,             -- sortie parsée (qualification, email, brief markdown...)
  model          TEXT NOT NULL,             -- 'claude-opus-4-7' etc.
  tokens_input   INTEGER,
  tokens_output  INTEGER,
  tokens_cached  INTEGER,
  cost_eur       REAL,
  latency_ms     INTEGER,
  user_triggered TEXT,                      -- username si déclenché via dashboard
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbr_tenant_pipeline ON claude_brain_results(tenant_id, pipeline, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cbr_siren ON claude_brain_results(siren, pipeline, version DESC);
CREATE INDEX IF NOT EXISTS idx_cbr_job ON claude_brain_results(job_id);
