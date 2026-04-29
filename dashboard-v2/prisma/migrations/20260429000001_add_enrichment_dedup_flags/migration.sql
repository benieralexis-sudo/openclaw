-- Audit waterfall enrichissement (29/04/2026) : ajout de flags "attemptedAt"
-- pour empêcher la re-soumission perpétuelle des leads "no result" à chaque
-- cron run-pollers (4×/jour). Économie estimée : ~840 crédits Dropcontact/mois.

-- Trigger : Pappers dirigeants tentés (récursion holdings comprise)
ALTER TABLE "Trigger"
  ADD COLUMN "pappersDirigeantsAttemptedAt" TIMESTAMP(3);

-- Lead : Dropcontact + Rodz + Kaspr "attemptedAt" séparé de "enrichedAt"
ALTER TABLE "Lead"
  ADD COLUMN "kasprAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "dropcontactAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "rodzAttemptedAt" TIMESTAMP(3);

-- Indexes pour les queries de filtrage `OR: [null, lt(threshold)]`
CREATE INDEX "Trigger_pappersDirigeantsAttemptedAt_idx"
  ON "Trigger"("pappersDirigeantsAttemptedAt");
CREATE INDEX "Lead_dropcontactAttemptedAt_idx"
  ON "Lead"("dropcontactAttemptedAt");
CREATE INDEX "Lead_rodzAttemptedAt_idx"
  ON "Lead"("rodzAttemptedAt");
CREATE INDEX "Lead_kasprAttemptedAt_idx"
  ON "Lead"("kasprAttemptedAt");
