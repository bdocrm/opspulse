import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureCampaignGoalTable } from '@/lib/campaign-goals';

type GoalKey = {
  campaignId: string;
  month: number;
  year: number;
};

function actorLabel(user: any) {
  return user?.name || user?.email || user?.role || 'Unknown user';
}

function normalizeItems(items: unknown): GoalKey[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item: any) => ({
      campaignId: String(item?.campaignId || ''),
      month: Number(item?.month),
      year: Number(item?.year),
    }))
    .filter((item) => item.campaignId && Number.isInteger(item.month) && Number.isInteger(item.year));
}

async function assertCanManageGoals() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const user = session.user as any;
  if (!['CEO', 'OM'].includes(user?.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user };
}

async function applyToGoalKeys(
  items: GoalKey[],
  user: any,
  mode: 'soft-delete' | 'restore' | 'permanent-delete'
) {
  const scopedItems = user.role === 'OM' ? items.filter((item) => item.campaignId === user.campaignId) : items;
  if (scopedItems.length === 0) return 0;

  let count = 0;
  const actor = actorLabel(user);

  for (const item of scopedItems) {
    if (mode === 'soft-delete') {
      const result = await prisma.$executeRaw`
        UPDATE "CampaignGoal"
        SET "deletedAt" = CURRENT_TIMESTAMP,
            "deletedBy" = ${actor},
            "restoredAt" = NULL,
            "restoredBy" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "campaignId" = ${item.campaignId}
          AND "month" = ${item.month}
          AND "year" = ${item.year}
          AND "deletedAt" IS NULL
      `;
      count += Number(result);
    } else if (mode === 'restore') {
      const result = await prisma.$executeRaw`
        UPDATE "CampaignGoal"
        SET "deletedAt" = NULL,
            "restoredAt" = CURRENT_TIMESTAMP,
            "restoredBy" = ${actor},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "campaignId" = ${item.campaignId}
          AND "month" = ${item.month}
          AND "year" = ${item.year}
          AND "deletedAt" IS NOT NULL
      `;
      count += Number(result);
    } else {
      const result = await prisma.$executeRaw`
        DELETE FROM "CampaignGoal"
        WHERE "campaignId" = ${item.campaignId}
          AND "month" = ${item.month}
          AND "year" = ${item.year}
          AND "deletedAt" IS NOT NULL
      `;
      count += Number(result);
    }
  }

  return count;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await assertCanManageGoals();
    if (auth.error) return auth.error;
    const user = auth.user;
    const { searchParams } = new URL(req.url);
    const trash = searchParams.get('trash') === '1';

    await ensureCampaignGoalTable();

    const rows =
      user.role === 'OM'
        ? await prisma.$queryRaw<any[]>`
            SELECT g."campaignId", c."campaignName", g."month", g."year",
                   g."monthlyGoal", g."kpiMetric", g."workingDays", g."daysLapsed", g."updatedAt",
                   g."deletedAt", g."deletedBy", g."restoredAt", g."restoredBy"
            FROM "CampaignGoal" g
            JOIN "Campaign" c ON c.id = g."campaignId"
            WHERE g."campaignId" = ${user.campaignId}
              AND ${trash} = (g."deletedAt" IS NOT NULL)
            ORDER BY c."campaignName" ASC, g."year" DESC, g."month" DESC
          `
        : await prisma.$queryRaw<any[]>`
            SELECT g."campaignId", c."campaignName", g."month", g."year",
                   g."monthlyGoal", g."kpiMetric", g."workingDays", g."daysLapsed", g."updatedAt",
                   g."deletedAt", g."deletedBy", g."restoredAt", g."restoredBy"
            FROM "CampaignGoal" g
            JOIN "Campaign" c ON c.id = g."campaignId"
            WHERE ${trash} = (g."deletedAt" IS NOT NULL)
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
      deletedAt: r.deletedAt,
      deletedBy: r.deletedBy,
      restoredAt: r.restoredAt,
      restoredBy: r.restoredBy,
    }));

    return NextResponse.json(saved);
  } catch (error) {
    console.error('Saved goals GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await assertCanManageGoals();
    if (auth.error) return auth.error;
    const { user } = auth;
    const body = await req.json();
    const items = normalizeItems(body.items);
    if (items.length === 0) {
      return NextResponse.json({ error: 'No goal rows selected' }, { status: 400 });
    }

    await ensureCampaignGoalTable();
    const mode = body.permanent ? 'permanent-delete' : 'soft-delete';
    const count = await applyToGoalKeys(items, user, mode);
    return NextResponse.json({ count });
  } catch (error) {
    console.error('Saved goals DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await assertCanManageGoals();
    if (auth.error) return auth.error;
    const { user } = auth;
    const body = await req.json();
    const items = normalizeItems(body.items);
    if (items.length === 0) {
      return NextResponse.json({ error: 'No goal rows selected' }, { status: 400 });
    }

    await ensureCampaignGoalTable();
    const count = await applyToGoalKeys(items, user, 'restore');
    return NextResponse.json({ count });
  } catch (error) {
    console.error('Saved goals PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
