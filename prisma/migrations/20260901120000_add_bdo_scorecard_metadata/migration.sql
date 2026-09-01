-- Preserve CI SCORECARD hire dates and source statuses without coercing them to zero.
ALTER TABLE "DashboardImportRecord"
  ADD COLUMN IF NOT EXISTS "dateHired" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dataStatus" TEXT;
