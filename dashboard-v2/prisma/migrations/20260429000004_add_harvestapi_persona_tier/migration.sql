-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "harvestapiAttemptedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "personaTier" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "personaSource" TEXT;

-- Index pour filtrage dashboard "tier ≤ 2" et dedup retry HarvestAPI
CREATE INDEX "Lead_personaTier_idx" ON "Lead"("personaTier");
CREATE INDEX "Lead_harvestapiAttemptedAt_idx" ON "Lead"("harvestapiAttemptedAt");
