-- ═══════════════════════════════════════════════════════════════════
-- Migration 004 — Dedup patterns_matched + UNIQUE constraint
-- ═══════════════════════════════════════════════════════════════════
-- Supprime les duplicates (siren, pattern_id) en gardant le plus récent,
-- puis crée un UNIQUE INDEX pour empêcher les futurs doublons.
-- Le processor passe en UPSERT ON CONFLICT pour mettre à jour au lieu
-- d'insérer.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Dédoublonner en gardant pour chaque (siren, pattern_id) la ligne avec
--    le max(score) + max(matched_at) (= le match le plus pertinent le plus récent)
DELETE FROM patterns_matched
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, siren, pattern_id, score, matched_at,
           ROW_NUMBER() OVER (PARTITION BY siren, pattern_id ORDER BY score DESC, matched_at DESC, id DESC) as rn
    FROM patterns_matched
  )
  WHERE rn = 1
);

-- 2. UNIQUE INDEX sur (siren, pattern_id) — bloque les insertions duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_matched_unique_siren_pattern
  ON patterns_matched(siren, pattern_id);
