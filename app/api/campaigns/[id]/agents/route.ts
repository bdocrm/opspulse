import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface Params {
  id: string;
}

// GET: List agents for a specific campaign
export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    const campaignId = params.id;

    // Check if user has access to this campaign
    // CEO can see all, COLLECTOR/OM/AGENT can only see their own campaign
    if (user.role !== 'CEO' && user.campaignId !== campaignId) {
      return NextResponse.json(
        { message: 'Unauthorized to view this campaign' },
        { status: 403 }
      );
    }

    // Get all agents for the campaign, sorted by seat number
    const agents = await prisma.user.findMany({
      where: {
        campaignId,
        role: 'AGENT',
      },
      select: {
        id: true,
        name: true,
        email: true,
        seatNumber: true,
        monthlyTarget: true,
      },
      orderBy: {
        seatNumber: 'asc',
      },
    });

    return NextResponse.json(agents);
  } catch (error) {
    console.error('Error fetching campaign agents:', error);
    return NextResponse.json(
      { message: (error as Error).message || 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
