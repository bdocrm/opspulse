-- Additive Production Monitoring schema. Operations Manager data is
-- intentionally absent from every table in this migration.
ALTER TABLE "Campaign"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "normalizedName" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Campaign"
SET "normalizedName" = trim(regexp_replace(upper("campaignName"), '[^A-Z0-9]+', ' ', 'g'));

CREATE UNIQUE INDEX "Campaign_normalizedName_key" ON "Campaign"("normalizedName");

CREATE TABLE "BusinessUnit" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "businessUnitName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignAlias" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessUnitAlias" (
    "id" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessUnitAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionMonitoring" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "reportYear" INTEGER NOT NULL,
    "reportMonth" INTEGER NOT NULL,
    "reportPeriod" TIMESTAMP(3) NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricUnit" TEXT,
    "target" DOUBLE PRECISION,
    "week1" DOUBLE PRECISION,
    "week2" DOUBLE PRECISION,
    "week3" DOUBLE PRECISION,
    "week4" DOUBLE PRECISION,
    "week5" DOUBLE PRECISION,
    "mtd" DOUBLE PRECISION,
    "achievement" DOUBLE PRECISION,
    "runRate" DOUBLE PRECISION,
    "workingDays" INTEGER,
    "daysLapse" INTEGER,
    "dateUpdated" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL DEFAULT 'EXCEL',
    "sourceFile" TEXT,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionMonitoring_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "reportingPeriods" JSONB NOT NULL,
    "recordsDetected" INTEGER NOT NULL DEFAULT 0,
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ProductionImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionImportIssue" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "level" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionImportIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionMonitoringAudit" (
    "id" TEXT NOT NULL,
    "productionMonitoringId" TEXT NOT NULL,
    "fieldChanged" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionMonitoringAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionMetricTypeConfig" (
    "metricType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "defaultUnit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionMetricTypeConfig_pkey" PRIMARY KEY ("metricType")
);

CREATE INDEX "BusinessUnit_campaignId_isActive_idx" ON "BusinessUnit"("campaignId", "isActive");
CREATE UNIQUE INDEX "BusinessUnit_campaignId_normalizedName_key" ON "BusinessUnit"("campaignId", "normalizedName");
CREATE UNIQUE INDEX "CampaignAlias_normalizedAlias_key" ON "CampaignAlias"("normalizedAlias");
CREATE INDEX "CampaignAlias_campaignId_idx" ON "CampaignAlias"("campaignId");
CREATE INDEX "BusinessUnitAlias_businessUnitId_idx" ON "BusinessUnitAlias"("businessUnitId");
CREATE UNIQUE INDEX "BusinessUnitAlias_campaignId_normalizedAlias_key" ON "BusinessUnitAlias"("campaignId", "normalizedAlias");
CREATE INDEX "ProductionMonitoring_campaignId_reportYear_reportMonth_idx" ON "ProductionMonitoring"("campaignId", "reportYear", "reportMonth");
CREATE INDEX "ProductionMonitoring_businessUnitId_reportYear_reportMonth_idx" ON "ProductionMonitoring"("businessUnitId", "reportYear", "reportMonth");
CREATE INDEX "ProductionMonitoring_metricType_idx" ON "ProductionMonitoring"("metricType");
CREATE INDEX "ProductionMonitoring_dateUpdated_idx" ON "ProductionMonitoring"("dateUpdated");
CREATE UNIQUE INDEX "ProductionMonitoring_campaignId_businessUnitId_reportYear_r_key" ON "ProductionMonitoring"("campaignId", "businessUnitId", "reportYear", "reportMonth", "metricType");
CREATE INDEX "ProductionImport_importedById_createdAt_idx" ON "ProductionImport"("importedById", "createdAt");
CREATE INDEX "ProductionImport_status_createdAt_idx" ON "ProductionImport"("status", "createdAt");
CREATE INDEX "ProductionImportIssue_importId_level_idx" ON "ProductionImportIssue"("importId", "level");
CREATE INDEX "ProductionMonitoringAudit_productionMonitoringId_createdAt_idx" ON "ProductionMonitoringAudit"("productionMonitoringId", "createdAt");
CREATE INDEX "ProductionMonitoringAudit_changedById_createdAt_idx" ON "ProductionMonitoringAudit"("changedById", "createdAt");

ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignAlias" ADD CONSTRAINT "CampaignAlias_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessUnitAlias" ADD CONSTRAINT "BusinessUnitAlias_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoring" ADD CONSTRAINT "ProductionMonitoring_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoring" ADD CONSTRAINT "ProductionMonitoring_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionImport" ADD CONSTRAINT "ProductionImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionImportIssue" ADD CONSTRAINT "ProductionImportIssue_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ProductionImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoringAudit" ADD CONSTRAINT "ProductionMonitoringAudit_record_fkey" FOREIGN KEY ("productionMonitoringId") REFERENCES "ProductionMonitoring"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionMonitoringAudit" ADD CONSTRAINT "ProductionMonitoringAudit_changedBy_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ProductionMetricTypeConfig" ("metricType", "label", "defaultUnit") VALUES
('percentage', 'Percentage', '%'),
('volume', 'Volume', 'Units'),
('count', 'Count', 'Items'),
('currency', 'Currency', 'PHP'),
('ratio', 'Ratio', NULL),
('custom', 'Custom', NULL);
