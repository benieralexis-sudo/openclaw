-- ═══════════════════════════════════════════════════════════════════
-- Migration 005 — Table leads_contacts (décideurs + emails)
-- ═══════════════════════════════════════════════════════════════════
-- Stocke les dirigeants identifiés par SIREN + emails proposés/vérifiés.
-- Un SIREN peut avoir plusieurs dirigeants (ex: SAS avec 2 dirigeants).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leads_contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  siren           TEXT NOT NULL,
  prenom          TEXT,
  nom             TEXT,
  fonction        TEXT,                -- ex: 'Président', 'Gérant', 'Directeur général'
  annee_naissance INTEGER,
  dirigeant_type  TEXT,                -- 'personne physique' | 'personne morale'
  domain_web      TEXT,                -- domaine site web de l'entreprise (ex: axomove.com)
  email           TEXT,                -- email proposé ou vérifié
  email_source    TEXT,                -- 'dropcontact' | 'pattern-guess' | 'manual'
  email_confidence REAL,               -- 0.0-1.0
  linkedin_url    TEXT,
  phone           TEXT,
  source          TEXT DEFAULT 'annuaire-entreprises',
  discovered_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (siren) REFERENCES companies(siren) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leads_contacts_siren ON leads_contacts(siren);
CREATE INDEX IF NOT EXISTS idx_leads_contacts_email ON leads_contacts(email) WHERE email IS NOT NULL;

-- UNIQUE pour éviter doublons sur le même dirigeant
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_contacts_unique
  ON leads_contacts(siren, COALESCE(prenom, ''), COALESCE(nom, ''));
