import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeMTD,
  achievementPct,
  daysLapsed,
  runRate,
  rrAchievementPct,
  WORKING_DAYS_DEFAULT,
  type KpiMetricKey,
} from "@/utils/kpi";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") ?? "monthly";

    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));

    // Date range for the selected month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const campaigns = await prisma.campaign.findMany({
      include: {
        dailySales: {
          where: { date: { gte: startDate, lte: endDate } },
        },
      },
    });

    // Campaign-level KPIs
    const campaignTable = campaigns.map((c) => {
      const metric = c.kpiMetric as KpiMetricKey;
      const rows = c.dailySales.map((s) => ({
        date: s.date.toISOString(),
        transmittals: Number(s.transmittals),
        activations: Number(s.activations),
        approvals: Number(s.approvals),
        booked: Number(s.booked),
        qualityRate: s.qualityRate,
        conversionRate: s.conversionRate,
        volume: Number(s.volume),
        transaction: Number(s.transaction),
      }));
      const mtd = computeMTD(rows, metric);
      const elapsed = daysLapsed(rows);
      const rr = runRate(mtd, elapsed, WORKING_DAYS_DEFAULT);
      const ach = achievementPct(mtd, c.monthlyGoal);
      const rrAch = rrAchievementPct(rr, c.monthlyGoal);

      return {
        id: c.id,
        campaignName: c.campaignName,
        kpiMetric: c.kpiMetric,
        goal: c.monthlyGoal,
        mtd: Math.round(mtd),
        achievement: ach,
        runRate: Math.round(rr),
        rrAchievement: rrAch,
      };
    });

    // Aggregated KPIs
    const totalMTD = campaignTable.reduce((a, c) => a + c.mtd, 0);
    const avgAchievement =
      campaignTable.length > 0
        ? campaignTable.reduce((a, c) => a + c.achievement, 0) / campaignTable.length
        : 0;
    const avgRunRate =
      campaignTable.length > 0
        ? campaignTable.reduce((a, c) => a + c.runRate, 0) / campaignTable.length
        : 0;
    const avgRRAchievement =
      campaignTable.length > 0
        ? campaignTable.reduce((a, c) => a + c.rrAchievement, 0) / campaignTable.length
        : 0;

    // Bar chart data
    const campaignsChart = campaignTable.map((c) => ({
      name: c.campaignName,
      achievement: c.achievement,
    }));

    // Daily trend (aggregate all campaigns per date)
    const allSales = await prisma.dailySales.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });

    const dailyMap = new Map<string, number>();
    allSales.forEach((s) => {
      const key = s.date.toISOString().slice(0, 10);
      const sum = Number(s.transmittals) + Number(s.activations) + Number(s.approvals) + Number(s.booked);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + sum);
    });
    const dailyTrend = Array.from(dailyMap.entries()).map(([date, value]) => ({ date, value }));

    // Distribution (pie)
    const distribution = campaignTable.map((c) => ({
      name: c.campaignName,
      value: c.mtd,
    }));

    // Leaderboard (top agents)
    const agentSales = await prisma.dailySales.groupBy({
      by: ["userId"],
      where: { date: { gte: startDate, lte: endDate } },
      _sum: { transmittals: true, activations: true, approvals: true, booked: true },
    });

    const users = await prisma.user.findMany({
      where: { role: "AGENT" },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    const leaderboard = agentSales
      .map((a) => ({
        name: userMap.get(a.userId) ?? "Unknown",
        value:
          Number(a._sum.transmittals ?? 0) +
          Number(a._sum.activations ?? 0) +
          Number(a._sum.approvals ?? 0) +
          Number(a._sum.booked ?? 0),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return NextResponse.json({
      kpis: { totalMTD, avgAchievement, avgRunRate, avgRRAchievement },
      campaigns: campaignsChart,
      campaignTable,
      dailyTrend,
      distribution,
      leaderboard,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
