-- CreateTable
CREATE TABLE "CompanyHeadcountSnapshot" (
    "id" TEXT NOT NULL,
    "companySiret" TEXT NOT NULL,
    "tranche" TEXT,
    "effectifMin" INTEGER NOT NULL,
    "effectifMax" INTEGER,
    "source" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHeadcountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyHeadcountSnapshot_companySiret_snapshotAt_idx" ON "CompanyHeadcountSnapshot"("companySiret", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "CompanyHeadcountSnapshot_snapshotAt_idx" ON "CompanyHeadcountSnapshot"("snapshotAt");

