-- ───── CLAUDE BRAIN QUEUE ─────
-- File d'attente persistante pour les jobs Opus (qualify, pitch, brief, discover).
-- Idempotence via idempotency_key = sha256(tenant+siren+pipeline+data_version).
-- Un même job ne peut être enqueue deux fois dans les 7 jours.

CREATE TABLE IF NOT EXISTS claude_brain_queue (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        TEXT NOT NULL,
  pipeline         TEXT NOT NULL,           -- 'qualify' | 'pitch' | 'brief' | 'discover' | 'gate_validate'
  siren            TEXT,                    -- nullable pour pipelines non-lead (discover)
  payload          TEXT,                    -- JSON optionnel
  idempotency_key  TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'claimed' | 'completed' | 'failed' | 'dead'
  priority         INTEGER DEFAULT 5,       -- 1 (haute) à 10 (basse)
  worker_id        TEXT,                    -- id du worker qui a claim le job
  claimed_at       TEXT,
  completed_at     TEXT,
  failed_at        TEXT,
  error            TEXT,
  retry_count      INTEGER DEFAULT 0,
  max_retries      INTEGER DEFAULT 3,
  scheduled_at     TEXT DEFAULT CURRENT_TIMESTAMP, -- backoff exponentiel sur retry
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbq_pending ON claude_brain_queue(status, priority, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cbq_tenant ON claude_brain_queue(tenant_id, pipeline);
CREATE INDEX IF NOT EXISTS idx_cbq_siren ON claude_brain_queue(siren);
