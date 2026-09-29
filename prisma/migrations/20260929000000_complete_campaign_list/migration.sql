-- Complete the supplied campaign list without renaming, updating, or deleting
-- any existing campaign. BO and CBC ACQUI are separate campaigns, as confirmed.
-- RBSC appears twice in the source list but is created only once.
-- No targets were supplied: new campaigns start with a zero monthly goal.
WITH requested("campaignName") AS (
  VALUES
    ('BPI PA OUTBOUND'),
    ('BPI PA INBOUND'),
    ('BPI PL'),
    ('BPI ONLINE'),
    ('BPI BL'),
    ('MB ACQ'),
    ('MB PL'),
    ('MB PA'),
    ('BDO SGM'),
    ('BDO ONLINE'),
    ('RBSC'),
    ('BDO CIE'),
    ('BDO SUPPLE'),
    ('BDO VC'),
    ('BDO NTH CARD'),
    ('CBC ACQUI'),
    ('CBC PA'),
    ('CBC HPL'),
    ('MEDICARD PPN'),
    ('MEDICARD DENTAL'),
    ('MEDICARD DOC CONCIERGE'),
    ('MEDICARD CLAIMS BACKFILL'),
    ('MEDICARD REIMBURSEMENT'),
    ('MEDICARD CLAIMS PAYMENT'),
    ('BO'),
    ('MEDICARD COLLECTION'),
    ('MEDICARD PRD'),
    ('BDO CCC'),
    ('CBC CCC'),
    ('AC MOBILITY'),
    ('GAOC'),
    ('BDO SUPPLE INVI')
), canonical AS (
  SELECT "campaignName",
    trim(regexp_replace(upper("campaignName"), '[^A-Z0-9]+', ' ', 'g')) AS "normalizedName"
  FROM requested
)
INSERT INTO "Campaign" (
  "id", "campaignName", "normalizedName", "isActive",
  "goalType", "monthlyGoal", "kpiMetric", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, canonical."campaignName", canonical."normalizedName", true,
  'sales', 0, 'transmittals', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM canonical
WHERE NOT EXISTS (
  SELECT 1 FROM "Campaign" existing
  WHERE existing."normalizedName" = canonical."normalizedName"
    OR trim(regexp_replace(upper(existing."campaignName"), '[^A-Z0-9]+', ' ', 'g')) = canonical."normalizedName"
)
ON CONFLICT ("normalizedName") DO NOTHING;
