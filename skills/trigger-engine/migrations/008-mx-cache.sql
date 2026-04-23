-- ───── MX CACHE (DNS MX verification pour emails guessed-domain) ─────
-- Évite les bounces en vérifiant que le domaine a bien un enregistrement MX valide
-- avant de valider un email pattern-guess. Cache 30 jours (les domaines changent peu).

CREATE TABLE IF NOT EXISTS mx_cache (
  domain          TEXT PRIMARY KEY,
  has_mx          INTEGER NOT NULL,         -- 0 | 1
  mx_records      TEXT,                     -- JSON array { exchange, priority }
  checked_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mx_cache_checked ON mx_cache(checked_at);
