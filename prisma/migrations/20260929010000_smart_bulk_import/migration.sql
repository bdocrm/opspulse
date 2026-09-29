-- AlterTable
ALTER TABLE "ProductionMonitoring" ADD COLUMN     "availability" JSONB,
ADD COLUMN     "calculatedValues" JSONB,
ADD COLUMN     "metricConfigSnapshot" JSONB,
ADD COLUMN     "reportStatus" TEXT,
ADD COLUMN     "rrAchievement" DOUBLE PRECISION,
ADD COLUMN     "seat" DOUBLE PRECISION,
ADD COLUMN     "sourceDateText" TEXT,
ADD COLUMN     "sourceValues" JSONB;

-- AlterTable
ALTER TABLE "ProductionImport" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "conflictCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "engine" TEXT,
ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "fileType" TEXT,
ADD COLUMN     "inspection" JSONB,
ADD COLUMN     "invalidCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "originalFile" BYTEA,
ADD COLUMN     "pendingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previewHash" TEXT,
ADD COLUMN     "reviewOptions" JSONB;

-- CreateTable
CREATE TABLE "CampaignMetricConfig" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "goalType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "aggregationMethod" TEXT NOT NULL,
    "goalDirection" TEXT NOT NULL DEFAULT 'HIGHER',
    "decimalPrecision" INTEGER NOT NULL DEFAULT 2,
    "tolerance" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "isPercentage" BOOLEAN NOT NULL DEFAULT false,
    "isCurrency" BOOLEAN NOT NULL DEFAULT false,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMetricConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionImportRawRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "processingStatus" TEXT NOT NULL DEFAULT 'CAPTURED',
    "validationIssues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionImportRawRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMetricConfig_campaignId_goalType_key" ON "CampaignMetricConfig"("campaignId", "goalType");

-- CreateIndex
CREATE INDEX "ProductionImportRawRow_importId_processingStatus_idx" ON "ProductionImportRawRow"("importId", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionImportRawRow_importId_sourceSheet_sourceRow_key" ON "ProductionImportRawRow"("importId", "sourceSheet", "sourceRow");

-- CreateIndex
CREATE INDEX "ProductionImport_fileHash_status_idx" ON "ProductionImport"("fileHash", "status");

-- AddForeignKey
ALTER TABLE "CampaignMetricConfig" ADD CONSTRAINT "CampaignMetricConfig_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionImportRawRow" ADD CONSTRAINT "ProductionImportRawRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ProductionImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

