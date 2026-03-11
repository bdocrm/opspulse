import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { computeMTD, runRate, achievementPct, rrAchievementPct, daysLapsed, WORKING_DAYS_DEFAULT } from '@/utils/kpi';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role === 'AGENT' || user.role === 'COLLECTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get('year') ?? new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const campaigns = await prisma.campaign.findMany({
      include: {
        dailySales: {
          where: { date: { gte: startDate, lte: endDate } },
        },
        users: true,
      },
    });

    const campaignReports = campaigns.map(c => {
      const metric = c.kpiMetric as any;
      const rows = c.dailySales.map(s => ({
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
      const ach = achievementPct(mtd, c.monthlyGoal);
      const rrAch = rrAchievementPct(rr, c.monthlyGoal);

      // Calculate average quality
      const qualityValues = c.dailySales
        .filter(s => s.qualityRate !== null)
        .map(s => s.qualityRate as number);
      const avgQuality = qualityValues.length > 0 
        ? qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length
        : 0;

      // Calculate average conversion
      const conversionValues = c.dailySales
        .filter(s => s.conversionRate !== null)
        .map(s => s.conversionRate as number);
      const avgConversion = conversionValues.length > 0 
        ? conversionValues.reduce((a, b) => a + b, 0) / conversionValues.length
        : 0;

      // Determine status
      let status: 'on-track' | 'at-risk' | 'exceeding' = 'on-track';
      if (ach >= 100) status = 'exceeding';
      else if (ach < 75 && elapsed > 10) status = 'at-risk';

      return {
        id: c.id,
        name: c.campaignName,
        kpiMetric: c.kpiMetric,
        monthlyGoal: c.monthlyGoal,
        mtd: Math.round(mtd),
        achievement: ach,
        runRate: Math.round(rr),
        rrAchievement: rrAch,
        agentCount: c.users.length,
        avgQuality,
        avgConversion,
        status,
      };
    });

    const onTrack = campaignReports.filter(c => c.status === 'on-track').length;
    const atRisk = campaignReports.filter(c => c.status === 'at-risk').length;
    const exceeding = campaignReports.filter(c => c.status === 'exceeding').length;
    const avgAchievement = campaignReports.length > 0 
      ? campaignReports.reduce((sum, c) => sum + c.achievement, 0) / campaignReports.length
      : 0;

    return NextResponse.json({
      campaigns: campaignReports,
      summary: {
        totalCampaigns: campaignReports.length,
        onTrack,
        atRisk,
        exceeding,
        avgAchievement,
      },
    });
  } catch (error) {
    console.error('Campaign reports API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}