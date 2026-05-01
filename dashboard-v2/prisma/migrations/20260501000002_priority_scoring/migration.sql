-- Chantier #1 — Priority Scoring Engine (01/05/2026)
-- 3 nouveaux champs pour réordonner le backlog commercial.
-- Voir lib/priority-scoring.ts pour la formule et les justifications.

ALTER TABLE "Trigger" ADD COLUMN "freshnessScore" INTEGER;
ALTER TABLE "Trigger" ADD COLUMN "multiSourceBoost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trigger" ADD COLUMN "priorityScore" INTEGER;

-- Index partiel pour le tri rapide du backlog dashboard.
-- Inclut clientId + deletedAt filter natif via WHERE.
CREATE INDEX "Trigger_priorityScore_idx" ON "Trigger" ("clientId", "priorityScore" DESC) WHERE "deletedAt" IS NULL;
