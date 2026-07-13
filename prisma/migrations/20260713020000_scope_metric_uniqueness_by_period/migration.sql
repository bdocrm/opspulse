DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate_key";

CREATE UNIQUE INDEX "ProductionMetricRecord_campaignId_agentId_metricType_reportPeriodType_reportDate_key"
ON "ProductionMetricRecord"("campaignId", "agentId", "metricType", "reportPeriodType", "reportDate");
