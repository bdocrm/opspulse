-- Some deployments created the original normalized-metric index manually
-- without Prisma's "_key" suffix. It omits Card Level and would collapse
-- FIRST_CARD and BUNDLE_CARD for the same agent/month.
DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate_key";
DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate";
