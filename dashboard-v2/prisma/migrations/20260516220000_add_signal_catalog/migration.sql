-- CreateEnum
CREATE TYPE "SignalCategory" AS ENUM ('PILLAR', 'BOOSTER', 'CONTEXTUAL');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('ACTIVE', 'BETA', 'DEPRECATED');

-- CreateTable
CREATE TABLE "SignalCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" "SignalCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceCodes" TEXT[],
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" "SignalStatus" NOT NULL DEFAULT 'ACTIVE',
    "predictivityPct" INTEGER,
    "implemented" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSignalConfig" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isPillar" BOOLEAN NOT NULL DEFAULT false,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSignalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignalCatalog_code_key" ON "SignalCatalog"("code");

-- CreateIndex
CREATE INDEX "SignalCatalog_category_idx" ON "SignalCatalog"("category");

-- CreateIndex
CREATE INDEX "SignalCatalog_status_idx" ON "SignalCatalog"("status");

-- CreateIndex
CREATE INDEX "SignalCatalog_implemented_idx" ON "SignalCatalog"("implemented");

-- CreateIndex
CREATE INDEX "ClientSignalConfig_clientId_enabled_idx" ON "ClientSignalConfig"("clientId", "enabled");

-- CreateIndex
CREATE INDEX "ClientSignalConfig_clientId_isPillar_idx" ON "ClientSignalConfig"("clientId", "isPillar");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSignalConfig_clientId_signalId_key" ON "ClientSignalConfig"("clientId", "signalId");

-- AddForeignKey
ALTER TABLE "ClientSignalConfig" ADD CONSTRAINT "ClientSignalConfig_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSignalConfig" ADD CONSTRAINT "ClientSignalConfig_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "SignalCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

