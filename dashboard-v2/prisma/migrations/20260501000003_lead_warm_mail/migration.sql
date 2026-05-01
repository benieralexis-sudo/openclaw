-- Chantier #3 — Copy Engine unifié (01/05/2026)
-- Ajoute warmMail (mail post-LinkedIn) qui manquait.
-- Ajoute copyGeneratedAt comme timestamp unifié pour les 4 contextes
-- (cold/warm/linkedin-dm/call-brief) générés via /api/leads/[id]/copy.
ALTER TABLE "Lead" ADD COLUMN "warmMailJson" JSONB;
ALTER TABLE "Lead" ADD COLUMN "warmMailGeneratedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "copyGeneratedAt" TIMESTAMP(3);
