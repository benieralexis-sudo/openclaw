-- Chantier #2b — Persona Fit Scoring (01/05/2026)
-- Score composite 0-100 indiquant la pertinence d'un lead pour l'ICP du client.
-- Basé sur : tier persona, tenure poste actuel, backgrounds (ESN/SaaS/Startup),
-- fit taille entreprise.
ALTER TABLE "Lead" ADD COLUMN "fitScore" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "fitScoreBreakdown" JSONB;
ALTER TABLE "Lead" ADD COLUMN "fitScoreComputedAt" TIMESTAMP(3);
CREATE INDEX "Lead_fitScore_idx" ON "Lead" ("clientId", "fitScore" DESC) WHERE "deletedAt" IS NULL AND "fitScore" IS NOT NULL;
