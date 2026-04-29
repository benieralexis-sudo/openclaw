-- Multi-source emails (Q3 audit qualité, 29/04/2026)
-- Stocke chaque source séparément + score de confiance pour identifier
-- les emails validés par 2+ sources concordantes.

ALTER TABLE "Lead"
  ADD COLUMN "emailRodz" TEXT,
  ADD COLUMN "emailDropcontact" TEXT,
  ADD COLUMN "emailConfidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailSourceCount" INTEGER NOT NULL DEFAULT 0;

-- Index pour tri dashboard ?orderBy=emailConfidence DESC
CREATE INDEX "Lead_emailConfidence_idx" ON "Lead"("emailConfidence" DESC);
