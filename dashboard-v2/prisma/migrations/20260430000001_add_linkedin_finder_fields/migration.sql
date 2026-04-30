-- Migration : étage 3-bis LinkedIn finder cascade (30/04/2026)
-- Ajoute le tracking de la cascade Rodz → HarvestAPI Profile Search → Google CSE
-- pour les leads avec persona mais sans linkedinUrl.

ALTER TABLE "Lead" ADD COLUMN "linkedinFinderAttemptedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "linkedinSource" TEXT;

-- Index partiel pour query "leads à enrichir" rapide
CREATE INDEX "Lead_linkedinFinder_idx" ON "Lead" ("linkedinFinderAttemptedAt")
  WHERE "deletedAt" IS NULL AND "linkedinUrl" IS NULL;
