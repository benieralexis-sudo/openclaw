-- ═══════════════════════════════════════════════════════════════════
-- Migration 002 — Cache pour SIRENE lookups
-- ═══════════════════════════════════════════════════════════════════
-- Évite de re-requêter l'API SIRENE pour des noms déjà résolus.
-- La clé est le nom normalisé (minuscules, sans accents ni ponctuation).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS siren_lookup_cache (
  normalized_name TEXT PRIMARY KEY,      -- nom normalisé (lowercase, no accents)
  siren           TEXT,                  -- vrai SIREN INSEE si trouvé, NULL sinon
  nom_complet     TEXT,
  naf_code        TEXT,
  effectif        INTEGER,
  departement     TEXT,
  lookup_source   TEXT DEFAULT 'api-gouv-recherche',
  found           INTEGER DEFAULT 0,     -- 1 si trouvé, 0 si recherche sans résultat
  looked_up_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_siren_lookup_siren ON siren_lookup_cache(siren) WHERE siren IS NOT NULL;
