import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureCampaignGoalTable } from '@/lib/campaign-goals';

// GET /api/goals/saved — list every saved per-month goal configuration.
// CEO sees all campaigns; OM sees only their own campaign.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (!['CEO', 'OM'].includes(user?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensureCampaignGoalTable();

    const rows =
      user.role === 'OM'
        ? await prisma.$queryRaw<any[]>`
            SELECT g."campaignId", c."campaignName", g."month", g."year",
                   g."monthlyGoal", g."kpiMetric", g."workingDays", g."daysLapsed", g."updatedAt"
            FROM "CampaignGoal" g
            JOIN "Campaign" c ON c.id = g."campaignId"
            WHERE g."campaignId" = ${user.campaignId}
            ORDER BY c."campaignName" ASC, g."year" DESC, g."month" DESC
          `
        : await prisma.$queryRaw<any[]>`
            SELECT g."campaignId", c."campaignName", g."month", g."year",
                   g."monthlyGoal", g."kpiMetric", g."workingDays", g."daysLapsed", g."updatedAt"
            FROM "CampaignGoal" g
            JOIN "Campaign" c ON c.id = g."campaignId"
            ORDER BY c."campaignName" ASC, g."year" DESC, g."month" DESC
          `;

    const saved = rows.map((r) => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      month: Number(r.month),
      year: Number(r.year),
      monthlyGoal: Number(r.monthlyGoal),
      kpiMetric: r.kpiMetric,
      workingDays: Number(r.workingDays),
      daysLapsed: Number(r.daysLapsed),
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json(saved);
  } catch (error) {
    console.error('Saved goals GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
