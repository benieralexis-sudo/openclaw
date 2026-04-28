-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('EMAIL_SENT', 'EMAIL_REPLY', 'EMAIL_OPEN', 'EMAIL_CLICK', 'EMAIL_BOUNCE', 'LINKEDIN_DM_SENT', 'LINKEDIN_DM_REPLY', 'LINKEDIN_VIEW_PROFILE', 'LINKEDIN_CONNECT', 'CALL_OUTBOUND', 'CALL_INBOUND', 'VOICEMAIL_LEFT', 'MEETING_BOOKED', 'MEETING_HELD', 'MEETING_NO_SHOW', 'NOTE', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('AUTO', 'WEBHOOK', 'MANUAL', 'GMAIL_API');

-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "source" "ActivitySource" NOT NULL,
    "direction" "ActivityDirection" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "emailActivityId" TEXT,
    "emailEventId" TEXT,
    "opportunityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_occurredAt_idx" ON "LeadActivity"("leadId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "LeadActivity_clientId_type_occurredAt_idx" ON "LeadActivity"("clientId", "type", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "LeadActivity_userId_occurredAt_idx" ON "LeadActivity"("userId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

