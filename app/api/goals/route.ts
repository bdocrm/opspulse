import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (!['CEO', 'OM'].includes(user?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If OM, only get their campaign. If CEO, get all
    const where = user.role === 'OM' ? { id: user.campaignId } : {};

    const campaigns = await prisma.campaign.findMany({
      where,
      include: {
        users: {
          select: {
            id: true,
            name: true,
            seatNumber: true,
            monthlyTarget: true,
          },
        },
      },
    });

    return NextResponse.json(campaigns);
  } catch (error) {
    console.error('Goals GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (!['CEO', 'OM'].includes(user?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { campaignId, monthlyGoal, kpiMetric } = await req.json();

    if (!campaignId || monthlyGoal === undefined) {
      return NextResponse.json(
        { error: 'Missing campaignId or monthlyGoal' },
        { status: 400 }
      );
    }

    // Check if OM is allowed to edit this campaign
    if (user.role === 'OM' && user.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        monthlyGoal: Number(monthlyGoal),
        ...(kpiMetric && { kpiMetric }),
      },
    });

    return NextResponse.json(campaign);
  } catch (error) {
    console.error('Goals PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'CEO') {
      return NextResponse.json({ error: 'Only CEO can edit agent targets' }, { status: 403 });
    }

    const { userId, monthlyTarget } = await req.json();

    if (!userId || monthlyTarget === undefined) {
      return NextResponse.json(
        { error: 'Missing userId or monthlyTarget' },
        { status: 400 }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { monthlyTarget: Number(monthlyTarget) },
      select: { id: true, name: true, monthlyTarget: true },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Agent target PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
