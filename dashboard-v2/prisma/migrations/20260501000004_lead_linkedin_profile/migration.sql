-- Chantier #2a — Enrichisseur LinkedIn Profile (01/05/2026)
-- Stocke le profil LinkedIn complet récupéré via HarvestAPI Profile mode Full.
-- Données nécessaires pour le scoring fit dynamique 2b (durée poste, parcours,
-- backgrounds ESN/SaaS/Startup).
ALTER TABLE "Lead" ADD COLUMN "linkedinProfileJson" JSONB;
ALTER TABLE "Lead" ADD COLUMN "linkedinProfileEnrichedAt" TIMESTAMP(3);
