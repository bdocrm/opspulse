-- ============================================
-- CLEAN SLATE MIGRATION
-- Run this FIRST in Supabase SQL Editor
-- ============================================

-- Step 1: Delete all data first (clean slate)
DELETE FROM "DailySales";
DELETE FROM "User";
DELETE FROM "Campaign";

-- Step 2: Verify tables are empty
SELECT 'Cleanup complete. Tables cleared.' as status;
SELECT COUNT(*) as "User count" FROM "User";
SELECT COUNT(*) as "Campaign count" FROM "Campaign";
SELECT COUNT(*) as "DailySales count" FROM "DailySales";
