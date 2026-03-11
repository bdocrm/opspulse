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

    const sales = await prisma.dailySales.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
      include: {
        user: { select: { id: true, name: true, seatNumber: true } },
      },
    });

    const agentMap = new Map();

    sales.forEach(s => {
      if (!agentMap.has(s.userId)) {
        agentMap.set(s.userId, {
          agentId: s.userId,
          agentName: s.user.name,
          seatNumber: s.user.seatNumber,
          tasksCompleted: 0,
          totalQuality: 0,
          totalConversion: 0,
          daysWorked: 0,
          qualityCount: 0,
          conversionCount: 0,
        });
      }
      const agent = agentMap.get(s.userId);
      agent.tasksCompleted += Number(s.transmittals) + Number(s.activations) + Number(s.approvals) + Number(s.booked);
      if (s.qualityRate) {
        agent.totalQuality += s.qualityRate;
        agent.qualityCount += 1;
      }
      if (s.conversionRate) {
        agent.totalConversion += s.conversionRate;
        agent.conversionCount += 1;
      }
      agent.daysWorked += 1;
    });

    const metrics = Array.from(agentMap.values()).map(a => {
      const avgQuality = a.qualityCount > 0 ? a.totalQuality / a.qualityCount : 0;
      const avgConversion = a.conversionCount > 0 ? a.totalConversion / a.conversionCount : 0;
      // Calculate efficiency based on tasks per day
      const tasksPerDay = a.daysWorked > 0 ? a.tasksCompleted / a.daysWorked : 0;
      const efficiency = Math.min(100, (tasksPerDay / 20) * 100); // Assume 20 tasks per day is 100% efficiency

      return {
        agentId: a.agentId,
        agentName: a.agentName,
        seatNumber: a.seatNumber,
        tasksCompleted: a.tasksCompleted,
        avgTaskTime: a.tasksCompleted > 0 ? 480 / a.tasksCompleted : 0, // 480 mins in 8 hours
        efficiencyScore: Math.round(efficiency * 10) / 10,
        qualityScore: Math.round(avgQuality * 10) / 10,
        daysWorked: a.daysWorked,
        overtimeHours: Math.max(0, (a.tasksCompleted - a.daysWorked * 20) * 0.1), // Estimate overtime
      };
    });

    const summary = {
      avgEfficiency: metrics.length > 0 ? metrics.reduce((sum, m: any) => sum + m.efficiencyScore, 0) / metrics.length : 0,
      avgQuality: metrics.length > 0 ? metrics.reduce((sum, m: any) => sum + m.qualityScore, 0) / metrics.length : 0,
      avgTasksPerAgent: metrics.length > 0 ? metrics.reduce((sum, m: any) => sum + m.tasksCompleted, 0) / metrics.length : 0,
      topPerformer: metrics.length > 0 ? metrics.sort((a: any, b: any) => b.efficiencyScore - a.efficiencyScore)[0] : null,
    };

    return NextResponse.json({ metrics, summary });
  } catch (error) {
    console.error('Productivity API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}