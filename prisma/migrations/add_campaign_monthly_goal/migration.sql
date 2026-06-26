-- Per-(campaign, month, year) goal configuration
CREATE TABLE IF NOT EXISTS "CampaignGoal" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "monthlyGoal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "kpiMetric" TEXT NOT NULL DEFAULT 'transmittals',
  "workingDays" INTEGER NOT NULL DEFAULT 22,
  "daysLapsed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignGoal_campaignId_month_year_key"
  ON "CampaignGoal" ("campaignId", "month", "year");

CREATE INDEX IF NOT EXISTS "CampaignGoal_campaignId_idx"
  ON "CampaignGoal" ("campaignId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CampaignGoal_campaignId_fkey'
  ) THEN
    ALTER TABLE "CampaignGoal"
      ADD CONSTRAINT "CampaignGoal_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
