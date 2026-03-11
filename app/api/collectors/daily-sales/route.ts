import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';

interface DailySalesData {
  date: string; // YYYY-MM-DD
  entries: Array<{
    agentId: string;
    transmittals?: number;
    activations?: number;
    approvals?: number;
    booked?: number;
    qualityRate?: number;
    conversionRate?: number;
    present: boolean;
    absent: boolean;
  }>;
}

// POST: Submit daily sales data for agents (COLLECTOR only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== 'COLLECTOR') {
      return NextResponse.json(
        { message: 'Only collectors can submit daily data' },
        { status: 403 }
      );
    }

    const { date, entries }: DailySalesData = await request.json();

    // Validate date format
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { message: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json({ message: 'Invalid date' }, { status: 400 });
    }

    // Create daily sales records for each agent entry
    const createdSales = [];

    for (const entry of entries) {
      // Verify agent belongs to collector's campaign
      const agent = await prisma.user.findUnique({
        where: { id: entry.agentId },
      });

      if (!agent || agent.campaignId !== user.campaignId || agent.role !== 'AGENT') {
        return NextResponse.json(
          { message: `Agent ${entry.agentId} not found in your campaign` },
          { status: 400 }
        );
      }

      // Delete existing record for this date/agent if any
      await prisma.dailySales.deleteMany({
        where: {
          userId: entry.agentId,
          campaignId: user.campaignId,
          date: parsedDate,
        },
      });

      // Create new daily sales record
      const sale = await prisma.dailySales.create({
        data: {
          id: uuidv4(),
          userId: entry.agentId,
          campaignId: user.campaignId,
          date: parsedDate,
          transmittals: entry.transmittals || 0,
          activations: entry.activations || 0,
          approvals: entry.approvals || 0,
          booked: entry.booked || 0,
          qualityRate: entry.qualityRate || null,
          conversionRate: entry.conversionRate || null,
          present: entry.present,
          absent: entry.absent,
        },
      });

      createdSales.push(sale);
    }

    return NextResponse.json(
      {
        message: `Successfully submitted daily data for ${createdSales.length} agents`,
        data: createdSales,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error submitting daily sales data:', error);
    return NextResponse.json(
      { message: (error as Error).message || 'Failed to submit daily data' },
      { status: 500 }
    );
  }
}
