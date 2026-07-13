ALTER TABLE "ProductionEntry"
  ADD COLUMN IF NOT EXISTS "reportPeriodType" TEXT NOT NULL DEFAULT 'daily';

CREATE TABLE IF NOT EXISTS "ProductionMetricRecord" (
  "id" TEXT NOT NULL,
  "productionEntryId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "reportPeriodType" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "reportMonth" INTEGER,
  "reportYear" INTEGER NOT NULL,
  "metricType" TEXT NOT NULL,
  "count" BIGINT,
  "volume" BIGINT,
  "goal" DOUBLE PRECISION,
  "actual" DOUBLE PRECISION,
  "achievement" DOUBLE PRECISION,
  "sourceFile" TEXT NOT NULL,
  "sourceSheet" TEXT NOT NULL,
  "sourceRow" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionMetricRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionMetricRecord_productionEntryId_fkey" FOREIGN KEY ("productionEntryId") REFERENCES "ProductionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductionMetricRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductionMetricRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate_key" ON "ProductionMetricRecord"("campaignId", "agentId", "metricType", "reportDate");
CREATE INDEX IF NOT EXISTS "ProductionMetricRecord_productionEntryId_idx" ON "ProductionMetricRecord"("productionEntryId");
CREATE INDEX IF NOT EXISTS "ProductionMetricRecord_campaignId_reportYear_reportMonth_idx" ON "ProductionMetricRecord"("campaignId", "reportYear", "reportMonth");
CREATE INDEX IF NOT EXISTS "ProductionMetricRecord_agentId_idx" ON "ProductionMetricRecord"("agentId");
