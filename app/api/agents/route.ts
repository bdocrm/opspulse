import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  achievementPct,
  runRate,
  rrAchievementPct,
  WORKING_DAYS_DEFAULT,
} from "@/utils/kpi";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    const campaignId = searchParams.get("campaignId");

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const where: any = { date: { gte: startDate, lte: endDate } };
    if (campaignId) where.campaignId = campaignId;

    const users = await prisma.user.findMany({
      where: { role: "AGENT" },
      select: { id: true, name: true, seatNumber: true },
    });

    const sales = await prisma.dailySales.findMany({
      where,
      include: { campaign: true },
    });

    // Unique dates for days lapsed
    const uniqueDates = new Set(sales.map((s) => s.date.toISOString().slice(0, 10)));
    const elapsed = uniqueDates.size;

    // Per-agent aggregation
    const agentMap = new Map<
      string,
      { mtd: number; goal: number; count: number }
    >();

    sales.forEach((s) => {
      const metric = s.campaign.kpiMetric;
      const val = Number((s as any)[metric] ?? 0);
      const existing = agentMap.get(s.userId) ?? { mtd: 0, goal: 0, count: 0 };
      existing.mtd += val;
      existing.goal = s.campaign.monthlyGoal; // simplified: use last campaign goal
      existing.count += 1;
      agentMap.set(s.userId, existing);
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const agents = Array.from(agentMap.entries())
      .map(([userId, { mtd, goal }]) => {
        const user = userMap.get(userId);
        const rr = runRate(mtd, elapsed, WORKING_DAYS_DEFAULT);
        const ach = achievementPct(mtd, goal);
        const rrAch = rrAchievementPct(rr, goal);
        return {
          userId,
          name: user?.name ?? "Unknown",
          seatNumber: user?.seatNumber ?? null,
          mtd: Math.round(mtd),
          achievement: ach,
          runRate: Math.round(rr),
          rrAchievement: rrAch,
        };
      })
      .sort((a, b) => b.mtd - a.mtd);

    const leaderboard = agents.slice(0, 10).map((a) => ({
      name: a.name,
      value: a.mtd,
    }));

    const topAgent = agents[0] ?? { name: "-", mtd: 0, achievement: 0 };
    const avgMTD = agents.length > 0 ? agents.reduce((a, c) => a + c.mtd, 0) / agents.length : 0;
    const avgAchievement =
      agents.length > 0 ? agents.reduce((a, c) => a + c.achievement, 0) / agents.length : 0;

    // Daily trend all agents
    const dailyMap = new Map<string, number>();
    sales.forEach((s) => {
      const key = s.date.toISOString().slice(0, 10);
      const sum = Number(s.transmittals) + Number(s.activations) + Number(s.approvals) + Number(s.booked);
      dailyMap.set(
        key,
        (dailyMap.get(key) ?? 0) + sum
      );
    });
    const dailyTrend = Array.from(dailyMap.entries())
      .sort()
      .map(([date, value]) => ({ date, value }));

    return NextResponse.json({
      agents,
      leaderboard,
      topAgent,
      totalAgents: agents.length,
      avgMTD: Math.round(avgMTD),
      avgAchievement,
      dailyTrend,
    });
  } catch (error) {
    console.error("Agents API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
