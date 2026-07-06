import { prisma } from '@/lib/prisma';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Ensures the per-month goal table exists, so the feature works on databases
 * where `prisma db push` for this model hasn't been run yet (matches the
 * existing raw-SQL approach used for workingDays / daysLapsed). Idempotent.
 */
export async function ensureCampaignGoalTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CampaignGoal" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "month" INTEGER NOT NULL,
      "year" INTEGER NOT NULL,
      "monthlyGoal" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "kpiMetric" TEXT NOT NULL DEFAULT 'transmittals',
      "workingDays" INTEGER NOT NULL DEFAULT 22,
      "daysLapsed" INTEGER NOT NULL DEFAULT 0,
      "deletedAt" TIMESTAMP(3),
      "deletedBy" TEXT,
      "restoredAt" TIMESTAMP(3),
      "restoredBy" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CampaignGoal_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CampaignGoal_campaignId_month_year_key"
      ON "CampaignGoal" ("campaignId", "month", "year");
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CampaignGoal"
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "deletedBy" TEXT,
      ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "restoredBy" TEXT,
      ADD COLUMN IF NOT EXISTS "supplementaryGoal" DOUBLE PRECISION NOT NULL DEFAULT 0;
  `);
}

/**
 * Validates / normalizes a month (1-12) and year, defaulting to the current
 * month when not provided.
 */
export function resolveMonthYear(monthRaw: unknown, yearRaw: unknown) {
  const now = new Date();
  const month = Number.isFinite(Number(monthRaw)) ? Number(monthRaw) : now.getMonth() + 1;
  const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : now.getFullYear();
  const valid = Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year);
  return { month, year, valid };
}
