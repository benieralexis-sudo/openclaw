-- Migration : Trigger.declarativePainScannedAt (audit 30/04/2026)
-- Sécurise la réactivation de declarative-pain.ts qui brûlait $18/$29 Apify
-- Permet dedup TTL 14j : on ne re-scrape pas une boîte avant 2 semaines.

ALTER TABLE "Trigger" ADD COLUMN "declarativePainScannedAt" TIMESTAMP(3);

-- Index partiel pour query "boîtes à scanner" rapide
CREATE INDEX "Trigger_declarativePainScannedAt_idx" ON "Trigger" ("declarativePainScannedAt")
  WHERE "deletedAt" IS NULL;
