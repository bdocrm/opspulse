import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

    // Read from ProductionDetail (the source the collector data-entry and bulk
    // import write to), grouped by the parent ProductionEntry date. CEO sees
    // every campaign; OM is scoped to their own campaign.
    const details = await prisma.productionDetail.findMany({
      where: {
        ...(user.role !== 'CEO' && user.campaignId ? { campaignId: user.campaignId } : {}),
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      include: { productionEntry: { select: { date: true } } },
    });

    // Group by date
    const trendMap = new Map();
    details.forEach(d => {
      const dateKey = d.productionEntry.date.toISOString().split('T')[0];
      if (!trendMap.has(dateKey)) {
        trendMap.set(dateKey, {
          date: dateKey,
          transmittals: 0,
          activations: 0,
          approvals: 0,
          booked: 0,
        });
      }
      const day = trendMap.get(dateKey);
      day.transmittals += Number(d.transmittals);
      day.activations += Number(d.activations);
      day.approvals += Number(d.approvals);
      day.booked += Number(d.booked);
    });

    const trends = Array.from(trendMap.values());

    // Calculate statistics
    const totalTransmittals = trends.reduce((sum, t: any) => sum + t.transmittals, 0);
    const totalActivations = trends.reduce((sum, t: any) => sum + t.activations, 0);
    const totalApprovals = trends.reduce((sum, t: any) => sum + t.approvals, 0);
    const totalBooked = trends.reduce((sum, t: any) => sum + t.booked, 0);

    const avgDaily = trends.length > 0 ? Math.round((totalTransmittals + totalActivations + totalApprovals + totalBooked) / trends.length) : 0;
    const peakDay = trends.length > 0 ? Math.max(...trends.map((t: any) => t.transmittals + t.activations + t.approvals + t.booked)) : 0;

    return NextResponse.json({
      trends,
      stats: {
        totalMetric: totalTransmittals + totalActivations + totalApprovals + totalBooked,
        avgDaily,
        peakDay,
        growthRate: 0,
      },
    });
  } catch (error) {
    console.error('Trends API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}