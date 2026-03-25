import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { computeMTD, runRate, achievementPct, rrAchievementPct, daysLapsed, WORKING_DAYS_DEFAULT } from '@/utils/kpi';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== 'CEO') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('id');
    const year = parseInt(searchParams.get('year') ?? new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

    // Date range for the selected month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    let where: any = { date: { gte: startDate, lte: endDate } };
    if (agentId) {
      where.userId = agentId;
    }

    const sales = await prisma.dailySales.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, seatNumber: true, monthlyTarget: true } },
        campaign: { select: { id: true, campaignName: true, kpiMetric: true, monthlyGoal: true } },
      },
    });

    // Group by agent
    const agentMap = new Map();

    sales.forEach((s) => {
      const agentId = s.userId;
      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, {
          id: s.userId,
          name: s.user.name,
          seatNumber: s.user.seatNumber,
          monthlyTarget: s.user.monthlyTarget,
          campaigns: new Map(),
          totalTransmittals: 0,
          totalActivations: 0,
          totalApprovals: 0,
          totalBooked: 0,
          totalQualityRate: 0,
          totalConversionRate: 0,
          daysCount: 0,
        });
      }
      const agent = agentMap.get(agentId);
      agent.totalTransmittals += Number(s.transmittals);
      agent.totalActivations += Number(s.activations);
      agent.totalApprovals += Number(s.approvals);
      agent.totalBooked += Number(s.booked);
      if (s.qualityRate) agent.totalQualityRate += s.qualityRate;
      if (s.conversionRate) agent.totalConversionRate += s.conversionRate;
      agent.daysCount += 1;

      // Per campaign
      const campId = s.campaignId;
      if (!agent.campaigns.has(campId)) {
        agent.campaigns.set(campId, {
          id: s.campaign.id,
          name: s.campaign.campaignName,
          kpiMetric: s.campaign.kpiMetric,
          monthlyGoal: s.campaign.monthlyGoal,
          transmittals: 0,
          activations: 0,
          approvals: 0,
          booked: 0,
          qualityRate: 0,
          conversionRate: 0,
          days: 0,
        });
      }
      const camp = agent.campaigns.get(campId);
      camp.transmittals += Number(s.transmittals);
      camp.activations += Number(s.activations);
      camp.approvals += Number(s.approvals);
      camp.booked += Number(s.booked);
      if (s.qualityRate) camp.qualityRate += s.qualityRate;
      if (s.conversionRate) camp.conversionRate += s.conversionRate;
      camp.days += 1;
    });

    // Compute summaries
    const agents = Array.from(agentMap.values()).map((agent: any) => {
      const campaigns = Array.from(agent.campaigns.values()).map((camp: any) => {
        const metric = camp.kpiMetric as any;
        const rows = sales.filter(s => s.userId === agent.id && s.campaignId === camp.id).map(s => ({
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
        const ach = achievementPct(mtd, camp.monthlyGoal);
        const rrAch = rrAchievementPct(rr, camp.monthlyGoal);
        const avgQuality = camp.days > 0 ? camp.qualityRate / camp.days : 0;
        const avgConversion = camp.days > 0 ? camp.conversionRate / camp.days : 0;

        return {
          id: camp.id,
          name: camp.name,
          kpiMetric: camp.kpiMetric,
          monthlyGoal: camp.monthlyGoal,
          mtd,
          runRate: rr,
          achievement: ach,
          rrAchievement: rrAch,
          avgQualityRate: avgQuality,
          avgConversionRate: avgConversion,
          totalTransmittals: camp.transmittals,
          totalActivations: camp.activations,
          totalApprovals: camp.approvals,
          totalBooked: camp.booked,
        };
      });

      const avgQuality = agent.daysCount > 0 ? agent.totalQualityRate / agent.daysCount : 0;
      const avgConversion = agent.daysCount > 0 ? agent.totalConversionRate / agent.daysCount : 0;

      return {
        id: agent.id,
        name: agent.name,
        seatNumber: agent.seatNumber,
        monthlyTarget: agent.monthlyTarget,
        campaigns,
        totalTransmittals: agent.totalTransmittals,
        totalActivations: agent.totalActivations,
        totalApprovals: agent.totalApprovals,
        totalBooked: agent.totalBooked,
        avgQualityRate: avgQuality,
        avgConversionRate: avgConversion,
        daysWorked: agent.daysCount,
      };
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Agent summary error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}