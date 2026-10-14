-- Additive: no production or historical rows are removed.
ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS "parentImportId" TEXT;
ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS "reconciliation" JSONB;
CREATE INDEX IF NOT EXISTS "ProductionImport_parentImportId_idx" ON "ProductionImport"("parentImportId");
ALTER TABLE "ProductionImport" ADD CONSTRAINT "ProductionImport_parentImportId_fkey"
  FOREIGN KEY ("parentImportId") REFERENCES "ProductionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignMetricConfig" ADD COLUMN IF NOT EXISTS "calculationRules" JSONB;
ALTER TABLE "ProductionMonitoring" ADD COLUMN IF NOT EXISTS "sourceProvenance" JSONB;
-- Explicitly retain existing reviewed calculation behavior. New configurations
-- default to NULL, so no new KPI is recalculated merely from a suggested unit.
UPDATE "CampaignMetricConfig" SET "calculationRules" = jsonb_build_object(
  'weeklySemantics', CASE WHEN "calculationMethod" = 'SUM' THEN 'INCREMENTAL'
    WHEN "calculationMethod" = 'AVERAGE' THEN 'OBSERVATIONS' ELSE 'UNKNOWN' END,
  'achievement', "calculationMethod" <> 'CUSTOM',
  'runRate', "calculationMethod" = 'SUM' AND "unitType" IN ('COUNT', 'CURRENCY', 'CUSTOM')
) WHERE "calculationRules" IS NULL;
CREATE TABLE "ImportMappingTemplate" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id"),
  "name" TEXT NOT NULL, "version" INTEGER NOT NULL, "signature" TEXT NOT NULL,
  "options" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ImportMappingTemplate_ownerId_name_version_key" ON "ImportMappingTemplate"("ownerId", "name", "version");
CREATE INDEX "ImportMappingTemplate_ownerId_createdAt_idx" ON "ImportMappingTemplate"("ownerId", "createdAt");
