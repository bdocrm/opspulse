import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const BUSINESS_TIME_ZONE = 'Asia/Manila';
const BUSINESS_TIME_ZONE_OFFSET = '+08:00';

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, '0')}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function previousMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function toBusinessYmd(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const yyyy = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const mm = parts.find((part) => part.type === 'month')?.value ?? '01';
  const dd = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${yyyy}-${mm}-${dd}`;
}

function groupDetailsByBusinessDate(details: Array<{
  transmittals: bigint;
  activations: bigint;
  approvals: bigint;
  booked: bigint;
  productionEntry: { date: Date };
}>) {
  const trendMap = new Map();

  details.forEach((detail) => {
    const dateKey = toBusinessYmd(detail.productionEntry.date);
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
    day.transmittals += Number(detail.transmittals || 0);
    day.activations += Number(detail.activations || 0);
    day.approvals += Number(detail.approvals || 0);
    day.booked += Number(detail.booked || 0);
  });

  return Array.from(trendMap.values()).sort((a: any, b: any) => a.date.localeCompare(b.date));
}

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
    const campaignId = searchParams.get('campaignId');

    const { start: startDate, end: endDate } = monthRange(year, month);
    const prev = previousMonth(year, month);
    const { start: prevStartDate, end: prevEndDate } = monthRange(prev.year, prev.month);

    const campaignWhere =
      user.role === 'CEO'
        ? campaignId
          ? { campaignId }
          : {}
        : user.campaignId
          ? { campaignId: user.campaignId }
          : {};

    const select = {
      transmittals: true,
      activations: true,
      approvals: true,
      booked: true,
      productionEntry: { select: { date: true } },
    };

    const [details, previousDetails] = await Promise.all([
      prisma.productionDetail.findMany({
        where: {
          ...campaignWhere,
          productionEntry: { date: { gte: startDate, lte: endDate } },
        },
        select,
      }),
      prisma.productionDetail.findMany({
        where: {
          ...campaignWhere,
          productionEntry: { date: { gte: prevStartDate, lte: prevEndDate } },
        },
        select,
      }),
    ]);

    const trends = groupDetailsByBusinessDate(details);
    const previousTrends = groupDetailsByBusinessDate(previousDetails);

    // Calculate statistics
    const totalTransmittals = trends.reduce((sum, t: any) => sum + t.transmittals, 0);
    const totalActivations = trends.reduce((sum, t: any) => sum + t.activations, 0);
    const totalApprovals = trends.reduce((sum, t: any) => sum + t.approvals, 0);
    const totalBooked = trends.reduce((sum, t: any) => sum + t.booked, 0);

    const avgDaily = trends.length > 0 ? Math.round((totalTransmittals + totalActivations + totalApprovals + totalBooked) / trends.length) : 0;
    const peakDay = trends.length > 0 ? Math.max(...trends.map((t: any) => t.transmittals + t.activations + t.approvals + t.booked)) : 0;

    return NextResponse.json({
      trends,
      previousTrends,
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
