-- Phase 3 audit qualité (29/04/2026)
-- Q7 dataQuality + Q8 bounce tracking

ALTER TABLE "Lead"
  ADD COLUMN "bouncedAt" TIMESTAMP(3),
  ADD COLUMN "bouncedFromEmail" TEXT,
  ADD COLUMN "dataQuality" INTEGER NOT NULL DEFAULT 0;

-- Index pour tri dashboard ?orderBy=dataQuality DESC
CREATE INDEX "Lead_dataQuality_idx" ON "Lead"("dataQuality" DESC);
-- Index sur bouncedFromEmail pour exclusion rapide dans le waterfall
CREATE INDEX "Lead_bouncedFromEmail_idx" ON "Lead"("bouncedFromEmail");
