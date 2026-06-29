import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can delete campaign data' }, { status: 403 });
    }

    const campaignId = params.campaignId;

    // Verify the collector has access to this campaign
    const collectorAccess = await prisma.userCampaign.findFirst({
      where: { userId: user.id, campaignId },
    });

    if (!collectorAccess) {
      return NextResponse.json({ error: 'You do not have access to this campaign' }, { status: 403 });
    }

    // Delete all production entries and their details for this campaign
    const deletedDetails = await prisma.productionDetail.deleteMany({
      where: { campaignId },
    });

    const deletedEntries = await prisma.productionEntry.deleteMany({
      where: { campaignId },
    });

    return NextResponse.json({
      message: `Deleted ${deletedEntries.count} production entries and ${deletedDetails.count} production details`,
      deletedEntries: deletedEntries.count,
      deletedDetails: deletedDetails.count,
    });
  } catch (error) {
    console.error('Error deleting campaign data:', error);
    return NextResponse.json(
      { error: 'Failed to delete campaign data' },
      { status: 500 }
    );
  }
}
