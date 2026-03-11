import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeMTD,
  achievementPct,
  daysLapsed,
  runRate,
  rrAchievementPct,
  groupByWeek,
  WORKING_DAYS_DEFAULT,
  type KpiMetricKey,
} from "@/utils/kpi";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        dailySales: {
          where: { date: { gte: startDate, lte: endDate } },
          include: { user: { select: { id: true, name: true, seatNumber: true } } },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const metric = campaign.kpiMetric as KpiMetricKey;
    const rows = campaign.dailySales.map((s) => ({
      date: s.date.toISOString(),
      transmittals: Number(s.transmittals),
      activations: Number(s.activations),
      approvals: Number(s.approvals),
      booked: Number(s.booked),
      qualityRate: s.qualityRate,
      conversionRate: s.conversionRate,
    }));

    const mtd = computeMTD(rows, metric);
    const elapsed = daysLapsed(rows);
    const rr = runRate(mtd, elapsed, WORKING_DAYS_DEFAULT);
    const ach = achievementPct(mtd, campaign.monthlyGoal);
    const rrAch = rrAchievementPct(rr, campaign.monthlyGoal);

    // Weekly breakdown
    const weekMap = groupByWeek(rows, metric);
    const weeklyData = Object.entries(weekMap).map(([week, value]) => ({ week, value }));

    // Daily trend
    const dailyMap = new Map<string, number>();
    rows.forEach((r) => {
      const key = new Date(r.date).toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + ((r[metric] as number) ?? 0));
    });
    const dailyTrend = Array.from(dailyMap.entries())
      .sort()
      .map(([date, value]) => ({ date, value }));

    // Agent breakdown
    const agentMap = new Map<string, { name: string; seatNumber: number | null; values: number[] }>();
    campaign.dailySales.forEach((s) => {
      if (!agentMap.has(s.userId)) {
        agentMap.set(s.userId, {
          name: s.user.name,
          seatNumber: s.user.seatNumber,
          values: [],
        });
      }
      agentMap.get(s.userId)!.values.push(((s as any)[metric] as number) ?? 0);
    });

    const isRate = metric === "qualityRate" || metric === "conversionRate";
    const agentBreakdown = Array.from(agentMap.entries())
      .map(([userId, { name, seatNumber, values }]) => {
        const total = values.reduce((a, b) => a + b, 0);
        const agentMtd = isRate ? total / values.length : total;
        const agentRr = runRate(agentMtd, elapsed, WORKING_DAYS_DEFAULT);
        return {
          userId,
          name,
          seatNumber,
          mtd: Math.round(agentMtd),
          achievement: achievementPct(agentMtd, campaign.monthlyGoal),
          runRate: Math.round(agentRr),
        };
      })
      .sort((a, b) => b.mtd - a.mtd);

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        campaignName: campaign.campaignName,
        kpiMetric: campaign.kpiMetric,
      },
      kpis: {
        goal: campaign.monthlyGoal,
        mtd: Math.round(mtd),
        achievement: ach,
        runRate: Math.round(rr),
        rrAchievement: rrAch,
      },
      weeklyData,
      dailyTrend,
      agentBreakdown,
    });
  } catch (error) {
    console.error("Campaign detail API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { id } = params;

    const updateData: any = {};

    if (body.campaignName) updateData.campaignName = body.campaignName;
    if (body.goalType) updateData.goalType = body.goalType;
    if (body.monthlyGoal !== undefined) updateData.monthlyGoal = body.monthlyGoal;
    if (body.kpiMetric) updateData.kpiMetric = body.kpiMetric;

    const updated = await prisma.campaign.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update campaign error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { getServerSession } = await import("next-auth/next");
    const { authOptions } = await import("@/lib/auth");
    
    const session = await getServerSession(authOptions);

    // Only allow CEO to delete campaigns
    if (!session?.user || (session.user as any).role !== "CEO") {
      return NextResponse.json(
        { error: "Unauthorized: CEO access required" },
        { status: 403 }
      );
    }

    const campaignId = params.id;

    // Find the campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Delete related data first (cascade delete dependencies)
    await prisma.dailySales.deleteMany({
      where: { campaignId },
    });

    await prisma.productionDetail.deleteMany({
      where: {
        productionEntry: {
          campaignId,
        },
      },
    });

    await prisma.productionEntry.deleteMany({
      where: { campaignId },
    });

    await prisma.attendance.deleteMany({
      where: { campaignId },
    });

    // Unassign users from campaign
    await prisma.user.updateMany({
      where: { campaignId },
      data: { campaignId: null },
    });

    // Finally delete the campaign
    await prisma.campaign.delete({
      where: { id: campaignId },
    });

    return NextResponse.json(
      { message: "Campaign deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Delete campaign error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
