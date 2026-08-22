import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can delete agents' }, { status: 403 });
    }

    const campaignId = params.campaignId;

    // Verify the collector has access to this campaign
    const collectorAccess = await prisma.userCampaign.findFirst({
      where: { userId: user.id, campaignId },
    });

    if (!collectorAccess) {
      return NextResponse.json({ error: 'You do not have access to this campaign' }, { status: 403 });
    }

    // Get all agents in this campaign
    const agents = await prisma.user.findMany({
      where: { campaignId, role: 'AGENT' },
      select: { id: true },
    });

    const agentIds = agents.map(a => a.id);

    if (agentIds.length === 0) {
      return NextResponse.json({
        message: 'No agents to delete',
        deletedCount: 0,
      });
    }

    // Delete all production details for these agents
    const deletedDetails = await prisma.productionDetail.deleteMany({
      where: { agentId: { in: agentIds } },
    });

    // Delete all agents
    const deletedAgents = await prisma.user.deleteMany({
      where: { id: { in: agentIds } },
    });

    return NextResponse.json({
      message: `Deleted ${deletedAgents.count} agent(s)`,
      deletedCount: deletedAgents.count,
      deletedDetails: deletedDetails.count,
    });
  } catch (error) {
    console.error('Error deleting agents:', error);
    return NextResponse.json(
      { error: 'Failed to delete agents' },
      { status: 500 }
    );
  }
}
