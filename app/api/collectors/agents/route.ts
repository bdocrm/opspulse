import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';

// POST: Create a new agent for collector's campaign
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== 'COLLECTOR') {
      return NextResponse.json(
        { message: 'Only collectors can add agents' },
        { status: 403 }
      );
    }

    const { name, seatNumber, campaignId } = await request.json();

    // Verify collector belongs to this campaign
    if (campaignId !== user.campaignId) {
      return NextResponse.json(
        { message: 'Cannot add agents to other campaigns' },
        { status: 403 }
      );
    }

    // Verify seat number is not already taken
    const existingAgent = await prisma.user.findFirst({
      where: {
        campaignId,
        seatNumber: parseInt(seatNumber),
        role: 'AGENT',
      },
    });

    if (existingAgent) {
      return NextResponse.json(
        { message: 'Seat number already taken in this campaign' },
        { status: 400 }
      );
    }

    // Generate unique email for agent (system-generated, not for login)
    const timestamp = Date.now();
    const agentEmail = `agent-s${seatNumber}-${campaignId.slice(0, 8)}-${timestamp}@opspulse.local`;

    // Check if email already exists (edge case)
    const existingEmail = await prisma.user.findUnique({
      where: { email: agentEmail },
    });

    if (existingEmail) {
      return NextResponse.json(
        { message: 'Agent with this identifier already exists. Please try again.' },
        { status: 400 }
      );
    }

    // Create agent user
    const agent = await prisma.user.create({
      data: {
        id: uuidv4(),
        name,
        email: agentEmail,
        password: 'system-agent', // Agents don't login via password
        role: 'AGENT',
        campaignId,
        seatNumber: parseInt(seatNumber),
      },
    });

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      { message: (error as Error).message || 'Failed to create agent' },
      { status: 500 }
    );
  }
}
