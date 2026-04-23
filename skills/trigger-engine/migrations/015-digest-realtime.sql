-- ───── DIGEST SENDS — tracking envois digest quotidiens ─────
CREATE TABLE IF NOT EXISTS digest_sends (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  date            TEXT NOT NULL,           -- 'YYYY-MM-DD' (Europe/Paris)
  email           TEXT NOT NULL,
  leads_count     INTEGER DEFAULT 0,
  red_count       INTEGER DEFAULT 0,
  sent_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  status          TEXT DEFAULT 'sent',     -- 'sent' | 'failed' | 'skipped'
  error           TEXT,
  UNIQUE(tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_digest_sends_date ON digest_sends(date DESC);
CREATE INDEX IF NOT EXISTS idx_digest_sends_tenant ON digest_sends(tenant_id, date DESC);

-- ───── REALTIME ALERTS — tracking alertes score ≥ 9 ─────
CREATE TABLE IF NOT EXISTS realtime_alerts_sent (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  siren           TEXT NOT NULL,
  opus_score      REAL,
  email           TEXT,
  sent_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  status          TEXT DEFAULT 'sent',
  error           TEXT
);

-- Dedup 24h via unique constraint + check dans code
CREATE INDEX IF NOT EXISTS idx_realtime_dedup ON realtime_alerts_sent(tenant_id, siren, sent_at DESC);
