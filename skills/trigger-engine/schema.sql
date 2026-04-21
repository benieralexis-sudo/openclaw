-- ═══════════════════════════════════════════════════════════════════
-- Trigger Engine FR — SQLite schema v1
-- ═══════════════════════════════════════════════════════════════════
-- Database: skills/trigger-engine/data/trigger-engine.db
-- Version:  1.0 (2026-04-22)
-- ═══════════════════════════════════════════════════════════════════

-- ───── COMPANIES (cache SIRENE + attributions) ─────
-- Toutes les entreprises FR détectées via événements, attribuées à un SIREN
CREATE TABLE IF NOT EXISTS companies (
  siren           TEXT PRIMARY KEY,       -- 9 chiffres SIREN (unique INSEE)
  raison_sociale  TEXT NOT NULL,
  nom_complet     TEXT,                   -- nom incluant sigle/enseigne si différent
  forme_juridique TEXT,                   -- ex: 'SAS', 'SARL'
  naf_code        TEXT,                   -- code APE/NAF
  naf_label       TEXT,
  effectif_min    INTEGER,                -- tranche effectif INSEE (min)
  effectif_max    INTEGER,                -- tranche effectif INSEE (max)
  departement     TEXT,                   -- code dept (2 chars)
  region          TEXT,                   -- code région
  date_creation   TEXT,                   -- ISO date
  date_cessation  TEXT,                   -- ISO date si radiée
  last_enriched_at TEXT,                  -- dernière enrich Pappers
  enriched_source TEXT,                   -- 'pappers' | 'sirene' | 'manual'
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_companies_naf ON companies(naf_code);
CREATE INDEX IF NOT EXISTS idx_companies_dept ON companies(departement);
CREATE INDEX IF NOT EXISTS idx_companies_effectif ON companies(effectif_min, effectif_max);

-- ───── EVENTS (signaux bruts détectés) ─────
-- Tous les événements capturés par les sources FR, attribués à un SIREN
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,          -- 'bodacc' | 'inpi' | 'joafe' | 'francetravail' | 'rodz' | 'theirstack' | 'trigify' | 'apify' | 'maddyness'
  event_type      TEXT NOT NULL,          -- ex: 'funding', 'hiring_tech', 'marque_deposee', 'new_cto', 'company_creation'
  siren           TEXT,                   -- attribution SIRENE (NULL si non-attribué)
  attribution_confidence REAL,            -- 0.0-1.0 (1.0 = certain via API officielle)
  raw_data        TEXT NOT NULL,          -- JSON source originale
  normalized      TEXT,                   -- JSON donnée normalisée
  event_date      TEXT NOT NULL,          -- ISO date de l'événement réel
  captured_at     TEXT DEFAULT CURRENT_TIMESTAMP, -- quand le bot l'a capturé
  processed_at    TEXT,                   -- quand pattern matching a tourné dessus
  FOREIGN KEY (siren) REFERENCES companies(siren) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_siren ON events(siren);
CREATE INDEX IF NOT EXISTS idx_events_source_type ON events(source, event_type);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_captured ON events(captured_at);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(processed_at) WHERE processed_at IS NULL;

-- ───── PATTERNS (catalogue de patterns définis) ─────
-- Définition des patterns (chargée depuis YAML au démarrage)
CREATE TABLE IF NOT EXISTS patterns (
  id              TEXT PRIMARY KEY,       -- ex: 'scale-up-tech', 'post-levee'
  name            TEXT NOT NULL,
  description     TEXT,
  verticaux       TEXT,                   -- JSON array des verticaux visés (ex: ["qa", "cyber"])
  definition      TEXT NOT NULL,          -- JSON: signaux requis + poids + fenêtre
  pitch_angle     TEXT,                   -- template angle de pitch
  min_score       REAL DEFAULT 7.0,       -- seuil de score pour rouge
  enabled         INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ───── PATTERNS_MATCHED (matches détectés) ─────
-- Chaque fois qu'un pattern matche sur une entreprise = une ligne ici
CREATE TABLE IF NOT EXISTS patterns_matched (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  siren           TEXT NOT NULL,
  pattern_id      TEXT NOT NULL,
  score           REAL NOT NULL,          -- 0.0-10.0
  signals         TEXT NOT NULL,          -- JSON array des events déclencheurs
  window_start    TEXT NOT NULL,          -- ISO date début fenêtre
  window_end      TEXT NOT NULL,          -- ISO date fin fenêtre
  matched_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT,                   -- fenêtre glissante 30j (auto-cleanup)
  FOREIGN KEY (siren) REFERENCES companies(siren) ON DELETE CASCADE,
  FOREIGN KEY (pattern_id) REFERENCES patterns(id)
);

CREATE INDEX IF NOT EXISTS idx_matched_siren ON patterns_matched(siren);
CREATE INDEX IF NOT EXISTS idx_matched_pattern ON patterns_matched(pattern_id);
CREATE INDEX IF NOT EXISTS idx_matched_score ON patterns_matched(score DESC);
-- Regular index on expires_at (can't use partial with CURRENT_TIMESTAMP — non-deterministic)
CREATE INDEX IF NOT EXISTS idx_matched_expires ON patterns_matched(expires_at);

-- ───── CLIENTS (clients de l'agence iFIND) ─────
-- Chaque client iFIND qui a un abonnement Trigger Engine actif
CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY,       -- slug ex: 'acme-qa'
  name            TEXT NOT NULL,
  industry        TEXT,                   -- secteur du client (pour ICP matching)
  icp             TEXT NOT NULL,          -- JSON: critères ICP (NAF, taille, région...)
  patterns        TEXT,                   -- JSON array: patterns activés (ou null = tous)
  min_score       REAL DEFAULT 7.0,       -- seuil de score perso du client
  monthly_lead_cap INTEGER DEFAULT 500,   -- plafond mensuel leads livrés
  status          TEXT DEFAULT 'active',  -- 'active' | 'paused' | 'churned'
  smartlead_campaign_id TEXT,             -- ID campagne Smartlead pour push
  folk_workspace_id TEXT,                 -- ID workspace Folk pour sync
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ───── CLIENT_LEADS (leads livrés aux clients) ─────
-- Association pattern matched × client (après filtrage ICP)
CREATE TABLE IF NOT EXISTS client_leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       TEXT NOT NULL,
  siren           TEXT NOT NULL,
  pattern_matched_id INTEGER NOT NULL,    -- FK vers patterns_matched
  score           REAL NOT NULL,
  priority        TEXT,                   -- 'red' | 'orange' | 'yellow'
  decision_maker_email TEXT,
  decision_maker_name  TEXT,
  decision_maker_linkedin TEXT,
  generated_email_body TEXT,              -- email IA généré
  status          TEXT DEFAULT 'new',     -- 'new' | 'sent' | 'replied_positive' | 'replied_negative' | 'booked' | 'attended' | 'closed' | 'discarded'
  sent_at         TEXT,
  replied_at      TEXT,
  booked_at       TEXT,
  attended_at     TEXT,
  smartlead_lead_id TEXT,                 -- ID du lead côté Smartlead
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (siren) REFERENCES companies(siren) ON DELETE CASCADE,
  FOREIGN KEY (pattern_matched_id) REFERENCES patterns_matched(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leads_client ON client_leads(client_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON client_leads(client_id, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_siren ON client_leads(siren);

-- ───── INGESTION_STATE (tracking des pollings) ─────
-- Suit l'état des ingesteurs pour ne pas rescanner les mêmes événements
CREATE TABLE IF NOT EXISTS ingestion_state (
  source          TEXT PRIMARY KEY,
  last_run_at     TEXT,
  last_event_id   TEXT,                   -- ID ou timestamp du dernier event ingéré
  events_last_run INTEGER DEFAULT 0,
  errors_last_run INTEGER DEFAULT 0,
  last_error      TEXT,
  enabled         INTEGER DEFAULT 1
);

-- ───── METRICS (télémétrie basique) ─────
CREATE TABLE IF NOT EXISTS metrics_daily (
  date            TEXT PRIMARY KEY,       -- 'YYYY-MM-DD'
  events_captured INTEGER DEFAULT 0,
  events_attributed INTEGER DEFAULT 0,
  patterns_matched INTEGER DEFAULT 0,
  leads_generated INTEGER DEFAULT 0,
  leads_delivered INTEGER DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS (auto-update updated_at)
-- ═══════════════════════════════════════════════════════════════════

CREATE TRIGGER IF NOT EXISTS trg_companies_updated
  AFTER UPDATE ON companies
  BEGIN
    UPDATE companies SET updated_at = CURRENT_TIMESTAMP WHERE siren = NEW.siren;
  END;

CREATE TRIGGER IF NOT EXISTS trg_clients_updated
  AFTER UPDATE ON clients
  BEGIN
    UPDATE clients SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS trg_patterns_updated
  AFTER UPDATE ON patterns
  BEGIN
    UPDATE patterns SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS trg_leads_updated
  AFTER UPDATE ON client_leads
  BEGIN
    UPDATE client_leads SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;
