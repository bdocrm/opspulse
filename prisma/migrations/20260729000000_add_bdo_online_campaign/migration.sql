-- Make BDO Online available anywhere campaigns are selected, including Bulk Import.
-- The name check keeps this data migration safe to rerun.
INSERT INTO "Campaign" (
  "id",
  "campaignName",
  "goalType",
  "monthlyGoal",
  "kpiMetric",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  'BDO Online',
  'sales',
  500,
  'transmittals',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "Campaign"
  WHERE LOWER(TRIM("campaignName")) = LOWER('BDO Online')
);
