import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface Params {
  id: string;
}

// DELETE: Remove an agent
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== 'COLLECTOR') {
      return NextResponse.json(
        { message: 'Only collectors can delete agents' },
        { status: 403 }
      );
    }

    const agentId = params.id;

    // Get agent to verify it belongs to collector's campaign
    const agent = await prisma.user.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return NextResponse.json({ message: 'Agent not found' }, { status: 404 });
    }

    if (agent.campaignId !== user.campaignId) {
      return NextResponse.json(
        { message: 'Cannot delete agents from other campaigns' },
        { status: 403 }
      );
    }

    // Delete agent's sales data first
    await prisma.dailySales.deleteMany({
      where: { userId: agentId },
    });

    // Delete agent
    const deletedAgent = await prisma.user.delete({
      where: { id: agentId },
    });

    return NextResponse.json(deletedAgent);
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      { message: (error as Error).message || 'Failed to delete agent' },
      { status: 500 }
    );
  }
}
