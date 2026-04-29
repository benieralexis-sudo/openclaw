-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "fullenrichAttemptedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "emailFullenrich" TEXT;
ALTER TABLE "Lead" ADD COLUMN "phoneFullenrich" TEXT;

-- Index pour dedup et cooldown 30j
CREATE INDEX "Lead_fullenrichAttemptedAt_idx" ON "Lead"("fullenrichAttemptedAt");
