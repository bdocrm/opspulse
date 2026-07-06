import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Get current month range (like the CEO dashboard does)
    const startDate = new Date(currentYear, currentMonth - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    console.log(`📊 Data Flow Diagnostic for ${currentMonth}/${currentYear}`);
    console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // 1. Check all campaigns
    const campaigns = await prisma.campaign.findMany({
      select: { id: true, campaignName: true },
    });
    console.log(`\n✅ Total campaigns: ${campaigns.length}`);

    // 2. Check ProductionEntry records
    const allEntries = await prisma.productionEntry.findMany({
      select: {
        id: true,
        campaignId: true,
        date: true,
        createdAt: true,
      },
      orderBy: { date: "desc" },
      take: 20,
    });
    console.log(`\n✅ Recent ProductionEntry records (last 20):`);
    allEntries.forEach((e) => {
      console.log(
        `  - Campaign: ${e.campaignId}, Date: ${e.date.toISOString()}, Created: ${e.createdAt.toISOString()}`
      );
    });

    // 3. Check ProductionDetail records for current month
    const currentMonthDetails = await prisma.productionDetail.findMany({
      where: {
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      include: {
        agent: { select: { name: true } },
        productionEntry: { select: { date: true } },
      },
      take: 10,
    });
    console.log(
      `\n✅ ProductionDetail records for current month (${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}): ${currentMonthDetails.length}`
    );
    currentMonthDetails.forEach((d) => {
      console.log(
        `  - Agent: ${d.agent.name}, Volume: ${d.volume}, Date: ${d.productionEntry.date.toISOString()}`
      );
    });

    // 4. Check all ProductionDetail records (any date)
    const totalDetails = await prisma.productionDetail.count();
    console.log(`\n✅ Total ProductionDetail records (all dates): ${totalDetails}`);

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
    console.log(`\n✅ ProductionDetail breakdown by month:`);
    detailsByMonth.forEach((row) => {
      console.log(`  - ${row.year}/${row.month}: ${row.count} records`);
    });

    // 6. Check campaign data for first campaign
    if (campaigns.length > 0) {
      const firstCampaign = campaigns[0];
      const campaignDetails = await prisma.productionDetail.findMany({
        where: {
          campaignId: firstCampaign.id,
          productionEntry: { date: { gte: startDate, lte: endDate } },
        },
        select: { volume: true },
      });
      const totalVolume = campaignDetails.reduce((sum, d) => sum + Number(d.volume), 0);
      console.log(
        `\n✅ Campaign "${firstCampaign.campaignName}" (${firstCampaign.id}):`
      );
      console.log(`  - Records in current month: ${campaignDetails.length}`);
      console.log(`  - Total volume: ${totalVolume}`);
    }

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
