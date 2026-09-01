-- BPI imports treat the sheet named exactly "YTD Performance" as excluded.
-- Remove legacy normalized rows from that sheet while preserving BDO rows and
-- every other BPI sheet, including "PL YTD Productivity".
WITH removed_by_batch AS (
  SELECT record."batchId", COUNT(*)::int AS removed_count
  FROM "DashboardImportRecord" AS record
  JOIN "Campaign" AS campaign ON record."campaignId" = campaign.id
  WHERE UPPER(TRIM(campaign."campaignName")) LIKE 'BPI%'
    AND LOWER(TRIM(record."worksheetSource")) = 'ytd performance'
  GROUP BY record."batchId"
), deleted AS (
  DELETE FROM "DashboardImportRecord" AS record
  USING "Campaign" AS campaign
  WHERE record."campaignId" = campaign.id
    AND UPPER(TRIM(campaign."campaignName")) LIKE 'BPI%'
    AND LOWER(TRIM(record."worksheetSource")) = 'ytd performance'
  RETURNING record."batchId"
)
UPDATE "DashboardImportBatch" AS batch
SET "insertedCount" = GREATEST(0, batch."insertedCount" - removed.removed_count)
FROM removed_by_batch AS removed
WHERE batch.id = removed."batchId"
  AND EXISTS (SELECT 1 FROM deleted WHERE deleted."batchId" = batch.id);

CREATE INDEX IF NOT EXISTS "DashboardImportRecord_campaignId_year_month_metric_idx"
  ON "DashboardImportRecord"("campaignId", "year", "month", "metric");

CREATE INDEX IF NOT EXISTS "DashboardImportRecord_batchId_monitoringType_idx"
  ON "DashboardImportRecord"("batchId", "monitoringType");
