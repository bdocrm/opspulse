-- ============================================
-- Migration: Campaign-Based Access Control
-- Run this entire script in Supabase SQL Editor
-- ============================================

-- Step 1: Drop old constraints if they exist
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_campaignId_fkey";
DROP INDEX IF EXISTS "User_campaignId_idx";

-- Step 2: Create new Role enum type (if it doesn't exist)
DO $$ BEGIN
    CREATE TYPE "Role_new" AS ENUM ('CEO', 'COLLECTOR', 'OM', 'AGENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Step 3: Add campaignId column to User table (if not exists)
DO $$ BEGIN
    ALTER TABLE "User" ADD COLUMN "campaignId" text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Step 4: Add present/absent columns to DailySales (if not exists)
DO $$ BEGIN
    ALTER TABLE "DailySales" ADD COLUMN "present" boolean NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "DailySales" ADD COLUMN "absent" boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Step 5: Update Role enum (this requires converting the column)
-- First, create temporary column with new enum type
DO $$ BEGIN
    ALTER TABLE "User" ADD COLUMN "role_new" "Role_new";
EXCEPTION WHEN duplicate_column THEN null;
END $$;

UPDATE "User" SET "role_new" = CASE 
    WHEN role::text = 'ADMIN' THEN 'CEO'::"Role_new"
    WHEN role::text = 'MANAGER' THEN 'OM'::"Role_new"
    WHEN role::text = 'AGENT' THEN 'AGENT'::"Role_new"
    ELSE 'AGENT'::"Role_new"
END
WHERE "role_new" IS NULL;

-- Then drop old column and rename new one (if role still exists)
DO $$ BEGIN
    ALTER TABLE "User" DROP COLUMN role;
    ALTER TABLE "User" RENAME COLUMN role_new TO role;
EXCEPTION WHEN undefined_column THEN
    -- Role column already converted
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'role_new') THEN
        ALTER TABLE "User" DROP COLUMN role_new CASCADE;
    END IF;
END $$;

-- Ensure role column exists and is correct type
DO $$ BEGIN
    ALTER TABLE "User" ADD COLUMN role "Role" NOT NULL DEFAULT 'AGENT'::"Role";
EXCEPTION WHEN duplicate_column THEN
    -- Column already exists, just ensure it's the right type
    ALTER TABLE "User" ALTER COLUMN role SET NOT NULL;
END $$;

-- Step 6: Drop old Role enum if it exists
DO $$ BEGIN
    DROP TYPE "Role" CASCADE;
EXCEPTION WHEN undefined_object THEN null;
END $$;

-- Step 7: Rename new enum back to original name (if needed)
DO $$ BEGIN
    ALTER TYPE "Role_new" RENAME TO "Role";
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Step 8: Add foreign key constraint for campaignId
DO $$ BEGIN
    ALTER TABLE "User" ADD CONSTRAINT "User_campaignId_fkey" 
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Step 9: Add index on campaignId
DO $$ BEGIN
    CREATE INDEX "User_campaignId_idx" ON "User"("campaignId");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Step 10: Restore email unique constraint
DO $$ BEGIN
    ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE (email);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Verification queries (run after migration to verify)
SELECT '✅ Migration Complete!' as status;
SELECT enum_range(NULL::"Role") AS role_values;
SELECT COUNT(*) as "User count" FROM "User";
SELECT COUNT(*) as "Campaign count" FROM "Campaign";
