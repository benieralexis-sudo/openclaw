-- Migration manuelle 04/05/2026 — C14 UNIQUE INDEX partiel Lead actifs
--
-- Empêche les doublons SIRET sur les leads ACTIFS (deletedAt IS NULL).
-- Permet les Lead.deletedAt NOT NULL en doublon (historique archivages
-- successifs sur la même boîte).
--
-- Bug source : 9 paires de doublons constatés audit failure modes 04/05
-- (ALTEN×2, Capgemini×2, Kicklox×2, Insitoo×2, EPSYL×2, INFORMATIS×2,
-- PIXID/Pixid, ViaXoft/Viaxoft, SOLUTEC/Solutec). Quand 2 triggers de
-- sources différentes (TheirStack + Apify) tombent sur même boîte, la
-- dedup côté Lead n'existait pas → 2 Leads séparés créés.
--
-- Note : PARTIAL UNIQUE n'est pas supporté par @@unique de Prisma, d'où
-- migration manuelle. Documenté en commentaire dans schema.prisma.
--
-- Application en prod : déjà exécuté 04/05 via psql après soft-delete des
-- 9 doublons existants.

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_clientId_companySiret_active_unique"
  ON "Lead" ("clientId", "companySiret")
  WHERE "deletedAt" IS NULL AND "companySiret" IS NOT NULL;
