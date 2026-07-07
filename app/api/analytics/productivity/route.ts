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

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
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

    const details = await prisma.productionDetail.findMany({
      where: {
        ...(user.role === 'CEO'
          ? campaignId
            ? { campaignId }
            : {}
          : user.campaignId
            ? { campaignId: user.campaignId }
            : {}),
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      select: {
        agentId: true,
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        agent: { select: { id: true, name: true, seatNumber: true } },
        productionEntry: { select: { date: true } },
      },
    });

    const agentMap = new Map();

    details.forEach(d => {
      if (!agentMap.has(d.agentId)) {
        agentMap.set(d.agentId, {
          agentId: d.agentId,
          agentName: d.agent.name,
          seatNumber: d.agent.seatNumber,
          tasksCompleted: 0,
          transmittals: 0,
          approvals: 0,
          booked: 0,
          workedDates: new Set<string>(),
        });
      }
      const agent = agentMap.get(d.agentId);
      const transmittals = Number(d.transmittals || 0);
      const activations = Number(d.activations || 0);
      const approvals = Number(d.approvals || 0);
      const booked = Number(d.booked || 0);

      agent.tasksCompleted += transmittals + activations + approvals + booked;
      agent.transmittals += transmittals;
      agent.approvals += approvals;
      agent.booked += booked;
      agent.workedDates.add(toBusinessYmd(d.productionEntry.date));
    });

    const metrics = Array.from(agentMap.values()).map(a => {
      const daysWorked = a.workedDates.size;
      const avgQuality = percent(a.approvals, a.transmittals);
      // Calculate efficiency based on tasks per day
      const tasksPerDay = daysWorked > 0 ? a.tasksCompleted / daysWorked : 0;
      const efficiency = Math.min(100, (tasksPerDay / 20) * 100); // Assume 20 tasks per day is 100% efficiency

      return {
        agentId: a.agentId,
        agentName: a.agentName,
        seatNumber: a.seatNumber,
        tasksCompleted: a.tasksCompleted,
        avgTaskTime: a.tasksCompleted > 0 ? 480 / a.tasksCompleted : 0, // 480 mins in 8 hours
        efficiencyScore: Math.round(efficiency * 10) / 10,
        qualityScore: Math.round(avgQuality * 10) / 10,
        conversionScore: Math.round(percent(a.booked, a.transmittals) * 10) / 10,
        daysWorked,
        overtimeHours: Math.max(0, (a.tasksCompleted - daysWorked * 20) * 0.1), // Estimate overtime
      };
    });

    const summary = {
      avgEfficiency: metrics.length > 0 ? metrics.reduce((sum, m: any) => sum + m.efficiencyScore, 0) / metrics.length : 0,
      avgQuality: metrics.length > 0 ? metrics.reduce((sum, m: any) => sum + m.qualityScore, 0) / metrics.length : 0,
      avgTasksPerAgent: metrics.length > 0 ? metrics.reduce((sum, m: any) => sum + m.tasksCompleted, 0) / metrics.length : 0,
      topPerformer: metrics.length > 0 ? [...metrics].sort((a: any, b: any) => b.efficiencyScore - a.efficiencyScore)[0] : null,
    };

    return NextResponse.json({ metrics, summary });
  } catch (error) {
    console.error('Productivity API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
