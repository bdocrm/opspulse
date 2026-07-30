ALTER TABLE "ProductionMetricRecord"
  ADD COLUMN IF NOT EXISTS "cardLevel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "cardLevelLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "grandTotal" BIGINT;

DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportPeriodType_reportDate_key";
DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate_key";
DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate";
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportPeriodType_reportDate_cardLevel_key"
  ON "ProductionMetricRecord"("campaignId", "agentId", "metricType", "reportPeriodType", "reportDate", "cardLevel");

ALTER TABLE "ProductionDetail"
  ADD COLUMN IF NOT EXISTS "cardLevel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "cardLevelLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "cardLevelGrandTotal" BIGINT;

DROP INDEX IF EXISTS "ProductionDetail_productionEntryId_agentId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionDetail_productionEntryId_agentId_cardLevel_key"
  ON "ProductionDetail"("productionEntryId", "agentId", "cardLevel");
