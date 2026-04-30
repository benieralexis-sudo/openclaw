-- Migration RGPD opt-out (audit 30/04/2026)
-- Permet au IMAP poller de marquer auto les leads qui ont répondu "stop"
-- + bloquer leur inclusion dans bulk-send-email et le listing dashboard.

ALTER TABLE "Lead" ADD COLUMN "doNotContact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "doNotContactReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "doNotContactAt" TIMESTAMP(3);

-- Index partiel pour query "leads contactables" rapide (skip les opt-out)
CREATE INDEX "Lead_doNotContact_idx" ON "Lead" ("doNotContact")
  WHERE "deletedAt" IS NULL AND "doNotContact" = false;
