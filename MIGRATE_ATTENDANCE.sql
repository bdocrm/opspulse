-- =====================================================
-- MIGRATION: Add Attendance Table
-- Run this in Supabase SQL Editor
-- =====================================================

-- Create attendance status enum
DO $$ BEGIN
    CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'HALFDAY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create Attendance table
CREATE TABLE IF NOT EXISTS "Attendance" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "agentId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "remarks" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint (one attendance record per agent per day)
DO $$ BEGIN
    ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_agentId_date_key" UNIQUE ("agentId", "date");
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "Attendance_agentId_idx" ON "Attendance"("agentId");
CREATE INDEX IF NOT EXISTS "Attendance_campaignId_idx" ON "Attendance"("campaignId");
CREATE INDEX IF NOT EXISTS "Attendance_date_idx" ON "Attendance"("date");
CREATE INDEX IF NOT EXISTS "Attendance_status_idx" ON "Attendance"("status");

-- =====================================================
-- USEFUL QUERIES FOR REPORTS
-- =====================================================

-- Get working days for an agent in a month
-- SELECT COUNT(*) as working_days 
-- FROM "Attendance" 
-- WHERE "agentId" = 'agent-id-here' 
--   AND "status" = 'PRESENT' 
--   AND "date" >= '2026-03-01' 
--   AND "date" < '2026-04-01';

-- Get attendance summary for a campaign on a specific date
-- SELECT 
--     "status", 
--     COUNT(*) as count 
-- FROM "Attendance" 
-- WHERE "campaignId" = 'campaign-id-here' 
--   AND DATE("date") = '2026-03-06'
-- GROUP BY "status";

-- Get days lapsed (total days with attendance records) for a campaign
-- SELECT COUNT(DISTINCT DATE("date")) as days_lapsed
-- FROM "Attendance"
-- WHERE "campaignId" = 'campaign-id-here'
--   AND "date" >= '2026-03-01'
--   AND "date" < '2026-04-01';

-- =====================================================
-- VERIFICATION
-- =====================================================
-- Run this to verify the table was created:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'Attendance';
