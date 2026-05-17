-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "signalCode" TEXT;

-- CreateIndex
CREATE INDEX "Trigger_signalCode_idx" ON "Trigger"("signalCode");

-- CreateIndex
CREATE INDEX "Trigger_clientId_signalCode_capturedAt_idx" ON "Trigger"("clientId", "signalCode", "capturedAt" DESC);
