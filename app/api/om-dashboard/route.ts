import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import {
  computeMTD,
  achievementPct,
  daysLapsed,
  runRate,
  rrAchievementPct,
  groupByWeek,
  WORKING_DAYS_DEFAULT,
  type KpiMetricKey,
} from '@/utils/kpi';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== 'OM') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaignId');
    const now = new Date();
    const year = parseInt(searchParams.get('year') ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get('month') ?? String(now.getMonth() + 1));

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Fetch campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId || user.campaignId || '' },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            seatNumber: true,
            monthlyTarget: true,
          },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Fetch production data for all agents in this campaign
    const productionData = await prisma.productionDetail.findMany({
      where: {
        productionEntry: {
          campaignId: campaign.id,
          date: { gte: startDate, lte: endDate },
        },
      },
      select: {
        id: true,
        agentId: true,
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        qualityRate: true,
        conversionRate: true,
        volume: true,
        transaction: true,
        agent: {
          select: { id: true, name: true, seatNumber: true },
        },
        productionEntry: {
          select: { date: true },
        },
      },
    });

    const metric = campaign.kpiMetric as KpiMetricKey;

    // Group data by agent
    const agentDataMap = new Map<
      string,
      Array<{
        date: Date;
        transmittals: number;
        activations: number;
        approvals: number;
        booked: number;
        qualityRate: number | null;
        conversionRate: number | null;
        volume: number;
        transaction: number;
      }>
    >();

    productionData.forEach((pd) => {
      if (!agentDataMap.has(pd.agentId)) {
        agentDataMap.set(pd.agentId, []);
      }
      agentDataMap.get(pd.agentId)!.push({
        date: pd.productionEntry.date,
        transmittals: Number(pd.transmittals),
        activations: Number(pd.activations),
        approvals: Number(pd.approvals),
        booked: Number(pd.booked),
        qualityRate: pd.qualityRate,
        conversionRate: pd.conversionRate,
        volume: Number(pd.volume),
        transaction: Number(pd.transaction),
      });
    });

    // Calculate agent-level metrics
    const agents = campaign.users.map((user) => {
      const agentData = agentDataMap.get(user.id) || [];
      const metricValues = agentData.map((d) => (d[metric] as number) || 0);
      const mtd = metricValues.reduce((a, b) => a + b, 0);
      const elapsed = new Set(agentData.map((d) => d.date.toISOString().split('T')[0])).size;
      
      // Use agent's monthly target if available, otherwise campaign goal
      const goal = user.monthlyTarget || campaign.monthlyGoal;
      const rr = runRate(mtd, elapsed || 1, WORKING_DAYS_DEFAULT);
      const ach = achievementPct(mtd, goal);
      const rrAch = rrAchievementPct(rr, goal);

      // Weekly breakdown
      const weekMap = groupByWeek(
        agentData.map((d) => ({
          date: d.date.toISOString(),
          transmittals: d.transmittals,
          activations: d.activations,
          approvals: d.approvals,
          booked: d.booked,
          qualityRate: 0,
          conversionRate: 0,
          volume: d.volume || 0,
          transaction: d.transaction || 0,
        })),
        metric
      );

      return {
        agentId: user.id,
        agentName: user.name,
        seatNumber: user.seatNumber,
        weekly: weekMap,
        mtd: Math.round(mtd),
        achievement: Math.round(ach),
        runRate: Math.round(rr),
        rrAchievement: Math.round(rrAch),
        workingDays: WORKING_DAYS_DEFAULT,
        daysLapsed: elapsed,
      };
    });

    return NextResponse.json({
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      goal: campaign.monthlyGoal,
      kpiMetric: campaign.kpiMetric,
      goalType: campaign.goalType,
      agents,
    });
  } catch (error) {
    console.error('OM Dashboard error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
