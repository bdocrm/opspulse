import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can set agent targets' }, { status: 403 });
    }

    const campaignId = params.campaignId;
    const body = await req.json();
    const { target, targetSupplementary, mbLevel, disbursedTxnTarget, disbursedVolTarget, grossTurnInsTxnTarget, grossTurnInsVolTarget } = body;

    const hasMbPl =
      mbLevel !== undefined || disbursedTxnTarget !== undefined || disbursedVolTarget !== undefined ||
      grossTurnInsTxnTarget !== undefined || grossTurnInsVolTarget !== undefined;

    if (!hasMbPl && (typeof target !== 'number' || target < 0)) {
      return NextResponse.json({ error: 'Invalid target value' }, { status: 400 });
    }
    const suppTarget =
      targetSupplementary !== undefined && targetSupplementary !== null
        ? Number(targetSupplementary) || 0
        : undefined;
    const num = (v: any) => (v !== undefined && v !== null ? Number(v) || 0 : undefined);

    // Verify the collector has access to this campaign
    const collectorAccess = await prisma.userCampaign.findFirst({
      where: { userId: user.id, campaignId },
    });

    if (!collectorAccess) {
      return NextResponse.json({ error: 'You do not have access to this campaign' }, { status: 403 });
    }

    // Update all agents in the campaign (+ ACQ supplementary / MB PL goals)
    const result = await prisma.user.updateMany({
      where: { campaignId, role: 'AGENT' },
      data: {
        ...(typeof target === 'number' && target >= 0 && !hasMbPl && { monthlyTarget: target }),
        ...(suppTarget !== undefined && { monthlyTargetSupplementary: suppTarget }),
        ...(mbLevel !== undefined && { mbLevel: mbLevel || null }),
        ...(num(disbursedTxnTarget) !== undefined && { disbursedTxnTarget: num(disbursedTxnTarget) }),
        ...(num(disbursedVolTarget) !== undefined && { disbursedVolTarget: num(disbursedVolTarget) }),
        ...(num(grossTurnInsTxnTarget) !== undefined && { grossTurnInsTxnTarget: num(grossTurnInsTxnTarget) }),
        ...(num(grossTurnInsVolTarget) !== undefined && { grossTurnInsVolTarget: num(grossTurnInsVolTarget) }),
      },
    });

    return NextResponse.json({
      message: `Updated target for ${result.count} agent(s)`,
      updatedCount: result.count,
    });
  } catch (error) {
    console.error('Error setting agent targets:', error);
    return NextResponse.json(
      { error: 'Failed to set agent targets' },
      { status: 500 }
    );
  }
}
