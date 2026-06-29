-- Multi-campaign assignment: explicit many-to-many join between User and Campaign.
-- The legacy User.campaignId column is kept as the "primary" campaign for
-- backward compatibility; this table holds the full set of assigned campaigns.

CREATE TABLE IF NOT EXISTS "UserCampaign" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserCampaign_pkey" PRIMARY KEY ("id")
);

-- No duplicate assignments per (user, campaign).
CREATE UNIQUE INDEX IF NOT EXISTS "UserCampaign_userId_campaignId_key"
  ON "UserCampaign" ("userId", "campaignId");

CREATE INDEX IF NOT EXISTS "UserCampaign_userId_idx"
  ON "UserCampaign" ("userId");

CREATE INDEX IF NOT EXISTS "UserCampaign_campaignId_idx"
  ON "UserCampaign" ("campaignId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'UserCampaign_userId_fkey'
  ) THEN
    ALTER TABLE "UserCampaign"
      ADD CONSTRAINT "UserCampaign_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'UserCampaign_campaignId_fkey'
  ) THEN
    ALTER TABLE "UserCampaign"
      ADD CONSTRAINT "UserCampaign_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: every existing user with a primary campaign gets a matching
-- assignment row. ON CONFLICT keeps the operation idempotent.
INSERT INTO "UserCampaign" ("id", "userId", "campaignId", "createdAt")
SELECT gen_random_uuid()::text, "id", "campaignId", CURRENT_TIMESTAMP
FROM "User"
WHERE "campaignId" IS NOT NULL
ON CONFLICT ("userId", "campaignId") DO NOTHING;
