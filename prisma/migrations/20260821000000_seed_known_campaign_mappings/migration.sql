-- Seed backend-owned, account-scoped rules only when the canonical OpsView
-- campaign already exists. Existing manual mappings are never overwritten.
WITH rules("sourceAccount", "normalizedSourceAccount", "sourceCampaign", "normalizedSourceCampaign", "targetNormalized") AS (
  VALUES
    ('BLUE 123', 'BLUE 123', 'SGM', 'SGM', 'BDO SGM'),
    ('BLUE 123', 'BLUE 123', 'ONLINE', 'ONLINE', 'BDO ONLINE'),
    ('XSELL', 'XSELL', 'NTH CARD', 'NTH CARD', 'BDO NTH CARD'),
    ('XSELL', 'XSELL', 'VIRTUAL', 'VIRTUAL', 'BDO VC'),
    ('XSELL', 'XSELL', 'SUPPLE INVI', 'SUPPLE INVI', 'BDO SUPPLE'),
    ('GAOC', 'GAOC', 'GAOC', 'GAOC', 'GAOC'),
    ('ACMOBILITY', 'ACMOBILITY', 'AC MOBILITY', 'AC MOBILITY', 'AC MOBILITY'),
    ('RBSCXSLGFI', 'RBSCXSLGFI', 'BANKARD', 'BANKARD', 'RBSC BANKARD')
), creator AS (
  SELECT "id" FROM "User" WHERE "role" = 'CEO' ORDER BY "createdAt", "id" LIMIT 1
), inserted AS (
  INSERT INTO "CampaignMapping" (
    "id", "sourceAccount", "normalizedSourceAccount", "sourceCampaign", "normalizedSourceCampaign",
    "sourceSystem", "opsviewCampaignId", "status", "mappingType", "createdById", "updatedById",
    "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text, rules."sourceAccount", rules."normalizedSourceAccount",
    rules."sourceCampaign", rules."normalizedSourceCampaign", 'PRODUCTION_MONITORING',
    campaign."id", 'ACTIVE', 'SYSTEM_RULE', creator."id", creator."id",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM rules
  CROSS JOIN creator
  JOIN "Campaign" campaign ON campaign."isActive" = true
    AND COALESCE(campaign."normalizedName", trim(regexp_replace(upper(campaign."campaignName"), '[^A-Z0-9]+', ' ', 'g'))) = rules."targetNormalized"
  ON CONFLICT ("sourceSystem", "normalizedSourceAccount", "normalizedSourceCampaign") DO NOTHING
  RETURNING "id", "opsviewCampaignId", "createdById", "sourceAccount", "sourceCampaign"
)
INSERT INTO "CampaignMappingAudit" (
  "id", "mappingId", "action", "newCampaignId", "changedById", "details", "createdAt"
)
SELECT
  gen_random_uuid()::text, inserted."id", 'CREATED', inserted."opsviewCampaignId", inserted."createdById",
  jsonb_build_object(
    'sourceAccount', inserted."sourceAccount",
    'sourceCampaign', inserted."sourceCampaign",
    'creationMethod', 'SYSTEM_RULE_SEED'
  ),
  CURRENT_TIMESTAMP
FROM inserted;
