CREATE TABLE IF NOT EXISTS "DashboardImportBatch" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "importMode" TEXT NOT NULL,
  "duplicateMode" TEXT NOT NULL,
  "reportPeriodType" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "workbookYear" INTEGER,
  "totalWorksheets" INTEGER NOT NULL DEFAULT 0,
  "supportedSheets" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "importedById" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "DashboardImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DashboardImportRecord" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "worksheetSource" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "recordKind" TEXT NOT NULL,
  "monitoringType" TEXT,
  "entityName" TEXT NOT NULL DEFAULT '',
  "level" TEXT,
  "category" TEXT NOT NULL DEFAULT '',
  "product" TEXT NOT NULL DEFAULT '',
  "metric" TEXT NOT NULL,
  "month" INTEGER,
  "year" INTEGER NOT NULL,
  "reportPeriodType" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "target" DOUBLE PRECISION,
  "actual" DOUBLE PRECISION,
  "achievement" DOUBLE PRECISION,
  "numericValue" DOUBLE PRECISION,
  "declaredSeat" DOUBLE PRECISION,
  "actualHeadCount" DOUBLE PRECISION,
  "remark" TEXT,
  "sourceFile" TEXT NOT NULL,
  "importedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardImportRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DashboardImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DashboardImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DashboardImportIssue" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "worksheetSource" TEXT NOT NULL,
  "sourceRow" INTEGER,
  "message" TEXT NOT NULL,
  "rawValue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardImportIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DashboardImportIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DashboardImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardImportRecord_natural_key" ON "DashboardImportRecord"("campaignId", "worksheetSource", "recordKind", "entityName", "category", "product", "metric", "year", "month", "reportPeriodType");
CREATE INDEX IF NOT EXISTS "DashboardImportBatch_campaignId_reportDate_idx" ON "DashboardImportBatch"("campaignId", "reportDate");
CREATE INDEX IF NOT EXISTS "DashboardImportBatch_importedById_createdAt_idx" ON "DashboardImportBatch"("importedById", "createdAt");
CREATE INDEX IF NOT EXISTS "DashboardImportRecord_campaignId_year_month_idx" ON "DashboardImportRecord"("campaignId", "year", "month");
CREATE INDEX IF NOT EXISTS "DashboardImportRecord_entityName_idx" ON "DashboardImportRecord"("entityName");
CREATE INDEX IF NOT EXISTS "DashboardImportRecord_batchId_idx" ON "DashboardImportRecord"("batchId");
CREATE INDEX IF NOT EXISTS "DashboardImportIssue_batchId_idx" ON "DashboardImportIssue"("batchId");
