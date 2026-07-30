ALTER TABLE "ProductionMetricRecord"
  ADD COLUMN IF NOT EXISTS "sourceNickname" TEXT,
  ADD COLUMN IF NOT EXISTS "finalTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "firstPeriodTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "secondPeriodTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "workbookGrandTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "ranking" INTEGER,
  ADD COLUMN IF NOT EXISTS "monthValues" JSONB;

ALTER TABLE "ProductionDetail"
  ADD COLUMN IF NOT EXISTS "sourceNickname" TEXT,
  ADD COLUMN IF NOT EXISTS "cardLevelFinalTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "cardLevelFirstPeriodTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "cardLevelSecondPeriodTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "cardLevelWorkbookGrandTotal" BIGINT,
  ADD COLUMN IF NOT EXISTS "cardLevelRanking" INTEGER,
  ADD COLUMN IF NOT EXISTS "cardLevelMonthValues" JSONB;
