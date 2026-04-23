-- ───── EXTEND CLIENTS — Claude Brain config + commercial scope ─────

-- Config JSON Claude Brain par tenant (pipelines activables, budget, voice, seuils...)
ALTER TABLE clients ADD COLUMN claude_brain_config TEXT;
-- Structure JSON attendue :
-- {
--   "enabled": true,
--   "pipelines": ["qualify", "pitch", "brief", "discover"],
--   "monthly_budget_eur": 300,
--   "hard_cap_eur": 500,
--   "voice_template": "Direct, tech-first, pas corporate",
--   "icp_nuance": "Éviter mairies/assoc même si NAF passe",
--   "pitch_language": "vous",
--   "model_preference": "opus",
--   "auto_send_threshold_opus": 8.5,
--   "auto_send_threshold_email_confidence": 0.85,
--   "auto_send_enabled": false
-- }

-- Score Opus stocké au niveau client_leads (persisté pour la gate)
ALTER TABLE client_leads ADD COLUMN opus_score REAL;
ALTER TABLE client_leads ADD COLUMN opus_qualified_at TEXT;
ALTER TABLE client_leads ADD COLUMN opus_result_id INTEGER;  -- FK soft vers claude_brain_results.id
