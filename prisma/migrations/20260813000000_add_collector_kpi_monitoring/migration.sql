-- Additive KPI monitoring tables. Existing production/import tables are left unchanged.
CREATE TABLE "KpiImportBatch" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successfulRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateMode" TEXT NOT NULL DEFAULT 'SKIP',
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KpiImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectorKpiRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "periodDate" TIMESTAMP(3) NOT NULL,
    "tenure" TEXT,
    "actualQa" DOUBLE PRECISION,
    "actualAht" DOUBLE PRECISION,
    "actualAdherence" DOUBLE PRECISION,
    "actualCm" DOUBLE PRECISION,
    "actualCd" DOUBLE PRECISION,
    "goalQa" DOUBLE PRECISION,
    "goalAht" DOUBLE PRECISION,
    "goalAdherence" DOUBLE PRECISION,
    "goalCm" DOUBLE PRECISION,
    "goalCd" DOUBLE PRECISION,
    "achievementQa" DOUBLE PRECISION,
    "achievementAht" DOUBLE PRECISION,
    "achievementAdherence" DOUBLE PRECISION,
    "achievementCm" DOUBLE PRECISION,
    "achievementCd" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "importBatchId" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollectorKpiRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KpiImportIssue" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER,
    "employeeName" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KpiImportIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KpiImportEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "recordId" TEXT,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "reason" TEXT,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KpiImportEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectorKpiRecord_employeeId_campaignId_year_month_key" ON "CollectorKpiRecord"("employeeId", "campaignId", "year", "month");
CREATE INDEX "CollectorKpiRecord_campaignId_year_month_idx" ON "CollectorKpiRecord"("campaignId", "year", "month");
CREATE INDEX "CollectorKpiRecord_employeeId_periodDate_idx" ON "CollectorKpiRecord"("employeeId", "periodDate");
CREATE INDEX "CollectorKpiRecord_importBatchId_idx" ON "CollectorKpiRecord"("importBatchId");
CREATE INDEX "KpiImportBatch_campaignId_createdAt_idx" ON "KpiImportBatch"("campaignId", "createdAt");
CREATE INDEX "KpiImportBatch_uploadedById_createdAt_idx" ON "KpiImportBatch"("uploadedById", "createdAt");
CREATE INDEX "KpiImportIssue_batchId_idx" ON "KpiImportIssue"("batchId");
CREATE INDEX "KpiImportEvent_batchId_idx" ON "KpiImportEvent"("batchId");
CREATE INDEX "KpiImportEvent_recordId_idx" ON "KpiImportEvent"("recordId");
CREATE INDEX "KpiImportEvent_employeeId_createdAt_idx" ON "KpiImportEvent"("employeeId", "createdAt");

ALTER TABLE "KpiImportBatch" ADD CONSTRAINT "KpiImportBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KpiImportBatch" ADD CONSTRAINT "KpiImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectorKpiRecord" ADD CONSTRAINT "CollectorKpiRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectorKpiRecord" ADD CONSTRAINT "CollectorKpiRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectorKpiRecord" ADD CONSTRAINT "CollectorKpiRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "KpiImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KpiImportIssue" ADD CONSTRAINT "KpiImportIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "KpiImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiImportEvent" ADD CONSTRAINT "KpiImportEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "KpiImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiImportEvent" ADD CONSTRAINT "KpiImportEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "CollectorKpiRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
