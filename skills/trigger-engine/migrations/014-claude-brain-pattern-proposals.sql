-- ───── CLAUDE BRAIN PATTERN PROPOSALS ─────
-- Propositions de nouveaux patterns découverts par Opus (pipeline discover).
-- Toujours validation humaine obligatoire avant ajout au catalogue actif.

CREATE TABLE IF NOT EXISTS claude_brain_pattern_proposals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        TEXT,              -- nullable : proposition globale possible
  proposal_json    TEXT NOT NULL,     -- JSON complet : id, name, description, rationale, technical_definition, expected_precision_pct, expected_recall_pct, confidence_proposition
  pattern_id       TEXT NOT NULL,     -- id proposé pour le pattern (ex: 'post-levee-cto-turned-ceo')
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  reviewed_by      TEXT,              -- username admin qui a validé/rejeté
  reviewed_at      TEXT,
  review_note      TEXT,
  discover_run_id  TEXT,              -- identifiant batch de run discover
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbpp_status ON claude_brain_pattern_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cbpp_pattern ON claude_brain_pattern_proposals(pattern_id);
