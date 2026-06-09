import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (!['CEO', 'OM'].includes(user?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const campaignFilter = user.role === 'OM' ? { id: user.campaignId } : {};

    // Fetch campaigns via ORM to get the users relation
    const campaignsWithUsers = await prisma.campaign.findMany({
      where: campaignFilter,
      include: {
        users: {
          where: { role: 'AGENT' },
          select: { id: true, name: true, seatNumber: true, monthlyTarget: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch workingDays / daysLapsed via raw SQL (not yet in the generated client)
    const campaignIds = campaignsWithUsers.map((c) => c.id);
    let rawExtras: { id: string; workingDays: number; daysLapsed: number }[] = [];
    if (campaignIds.length > 0) {
      rawExtras = await prisma.$queryRaw<any[]>`
        SELECT id, "workingDays", "daysLapsed"
        FROM "Campaign"
        WHERE id = ANY(${campaignIds}::text[])
      `;
    }

    const extrasById = Object.fromEntries(rawExtras.map((r) => [r.id, r]));

    const merged = campaignsWithUsers.map((c) => ({
      ...c,
      monthlyGoal: Number(c.monthlyGoal),
      workingDays: Number(extrasById[c.id]?.workingDays ?? 22),
      daysLapsed: Number(extrasById[c.id]?.daysLapsed ?? 0),
    }));

    return NextResponse.json(merged);
  } catch (error) {
    console.error('Goals GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (!['CEO', 'OM'].includes(user?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { campaignId, monthlyGoal, kpiMetric, workingDays, daysLapsed } = await req.json();

    if (!campaignId || monthlyGoal === undefined) {
      return NextResponse.json(
        { error: 'Missing campaignId or monthlyGoal' },
        { status: 400 }
      );
    }

    if (user.role === 'OM' && user.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Update base fields (always supported by the Prisma client)
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        monthlyGoal: Number(monthlyGoal),
        ...(kpiMetric !== undefined && { kpiMetric }),
      },
    });

    // Update workingDays / daysLapsed via raw SQL so this works even when
    // `prisma generate` hasn't been re-run after the schema migration.
    const wDays = workingDays !== undefined ? Number(workingDays) : 22;
    const dLapsed = daysLapsed !== undefined ? Number(daysLapsed) : 0;
    await prisma.$executeRaw`
      UPDATE "Campaign"
      SET "workingDays" = ${wDays}, "daysLapsed" = ${dLapsed}
      WHERE id = ${campaignId}
    `;

    // Return the updated row via raw query so both old and new fields are present
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, "campaignName", "goalType", "monthlyGoal", "kpiMetric",
             "workingDays", "daysLapsed", "createdAt"
      FROM "Campaign"
      WHERE id = ${campaignId}
    `;

    return NextResponse.json(rows[0] ?? {});
  } catch (error) {
    console.error('Goals PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
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
