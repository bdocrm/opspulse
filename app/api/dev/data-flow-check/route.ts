import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Get current month range (like the CEO dashboard does)
    const startDate = new Date(currentYear, currentMonth - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    // 1. Check all campaigns
    const campaigns = await prisma.campaign.findMany({
      select: { id: true },
    });
    // 2. Check ProductionEntry records
    const allEntries = await prisma.productionEntry.findMany({
      select: {
        id: true,
      },
      orderBy: { date: "desc" },
      take: 20,
    });
    // 3. Check ProductionDetail records for current month
    const currentMonthDetails = await prisma.productionDetail.findMany({
      where: {
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      select: { id: true },
      take: 10,
    });
    // 4. Check all ProductionDetail records (any date)
    const totalDetails = await prisma.productionDetail.count();
    // 5. Breakdown by month
    const detailsByMonth = await prisma.$queryRaw<
      Array<{ year: number; month: number; count: bigint }>
    >`
      SELECT
        EXTRACT(YEAR FROM "productionEntry"."date")::int as year,
        EXTRACT(MONTH FROM "productionEntry"."date")::int as month,
        COUNT(*)::bigint as count
      FROM "ProductionDetail"
      JOIN "ProductionEntry" ON "ProductionDetail"."productionEntryId" = "ProductionEntry"."id"
      GROUP BY year, month
      ORDER BY year DESC, month DESC
    `;
    return NextResponse.json({
      success: true,
      diagnosticTime: new Date().toISOString(),
      currentMonth: `${currentYear}-${String(currentMonth).padStart(2, "0")}`,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary: {
        totalCampaigns: campaigns.length,
        totalProductionEntries: allEntries.length,
        totalProductionDetails: totalDetails,
        currentMonthDetails: currentMonthDetails.length,
        detailsByMonth: detailsByMonth.map((row) => ({
          year: row.year,
          month: row.month,
          count: Number(row.count),
        })),
      },
    });
  } catch (error) {
    console.error("❌ Data flow check error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
