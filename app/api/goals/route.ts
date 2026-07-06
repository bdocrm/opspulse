import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCampaignAgents, isAgentInCampaign } from '@/lib/campaign-agents';
import { MONTH_NAMES, ensureCampaignGoalTable, resolveMonthYear } from '@/lib/campaign-goals';
import { achievementPct, computeMTD, runRate, rrAchievementPct, daysLapsed as computeDaysLapsed } from '@/utils/kpi';

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

    // Month / year to load goal configuration for (defaults to current month).
    const { searchParams } = new URL(req.url);
    const { month, year } = resolveMonthYear(searchParams.get('month'), searchParams.get('year'));

    await ensureCampaignGoalTable();

    const campaignFilter = user.role === 'OM' ? { id: user.campaignId } : {};

    // Fetch campaigns via ORM
    const campaignRows = await prisma.campaign.findMany({
      where: campaignFilter,
      orderBy: { createdAt: 'desc' },
    });

    // Resolve each campaign's agents through the SHARED assignment source so the
    // "Agent Targets" list matches the Collector Dashboard exactly (same query,
    // filtered by campaign id, same ordering).
    const campaignsWithUsers = await Promise.all(
      campaignRows.map(async (c) => ({
        ...c,
        users: (await getCampaignAgents(c.id)).map((a) => ({
          id: a.id,
          name: a.name,
          seatNumber: a.seatNumber,
          monthlyTarget: a.monthlyTarget,
        })),
      }))
    );

    const campaignIds = campaignsWithUsers.map((c) => c.id);

    // Fetch legacy workingDays / daysLapsed via raw SQL (not yet in the
    // generated client) — used as the fallback when no per-month row exists.
    let rawExtras: { id: string; workingDays: number; daysLapsed: number }[] = [];
    // Fetch the per-month goal configuration for the requested month/year.
    let monthlyRows: any[] = [];
    if (campaignIds.length > 0) {
      rawExtras = await prisma.$queryRaw<any[]>`
        SELECT id, "workingDays", "daysLapsed"
        FROM "Campaign"
        WHERE id = ANY(${campaignIds}::text[])
      `;
      monthlyRows = await prisma.$queryRaw<any[]>`
        SELECT "campaignId", "monthlyGoal", "supplementaryGoal", "kpiMetric", "workingDays", "daysLapsed", "updatedAt"
        FROM "CampaignGoal"
        WHERE "campaignId" = ANY(${campaignIds}::text[])
          AND "month" = ${month} AND "year" = ${year}
          AND "deletedAt" IS NULL
      `;
    }

    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);
    const dailySales =
      campaignIds.length > 0
        ? await prisma.dailySales.findMany({
            where: {
              campaignId: { in: campaignIds },
              date: { gte: startDate, lte: endDate },
            },
            orderBy: { date: 'asc' },
          })
        : [];

    const salesByCampaign = dailySales.reduce((acc, row) => {
      if (!acc[row.campaignId]) acc[row.campaignId] = [];
      acc[row.campaignId].push(row);
      return acc;
    }, {} as Record<string, typeof dailySales>);

    const extrasById = Object.fromEntries(rawExtras.map((r) => [r.id, r]));
    const monthlyById = Object.fromEntries(monthlyRows.map((r) => [r.campaignId, r]));

    const merged = campaignsWithUsers.map((c) => {
      const m = monthlyById[c.id];
      // Per-month config takes precedence; otherwise fall back to the campaign's
      // legacy values so existing (pre-month) data keeps showing unchanged.
      const monthlyGoal = Number(m ? m.monthlyGoal : c.monthlyGoal);
      const supplementaryGoal = Number(m ? m.supplementaryGoal : (c as any).supplementaryGoal ?? 0);
      const kpiMetric = (m ? m.kpiMetric : c.kpiMetric) as any;
      const workingDays = Number(m ? m.workingDays : extrasById[c.id]?.workingDays ?? 22);
      const configuredDaysLapsed = Number(m ? m.daysLapsed : extrasById[c.id]?.daysLapsed ?? 0);
      const rows = (salesByCampaign[c.id] || []).map((s) => ({
        date: s.date,
        transmittals: Number(s.transmittals),
        activations: Number(s.activations),
        approvals: Number(s.approvals),
        booked: Number(s.booked),
        qualityRate: s.qualityRate,
        conversionRate: s.conversionRate,
        volume: Number(s.volume),
        transaction: Number(s.transaction),
      }));
      const mtd = computeMTD(rows, kpiMetric);
      const bookedVolume = rows.reduce((sum, row) => sum + row.volume, 0);
      const elapsed = configuredDaysLapsed > 0 ? configuredDaysLapsed : computeDaysLapsed(rows);
      const rr = runRate(mtd, elapsed, workingDays);

      return {
        ...c,
        month,
        year,
        hasMonthlyConfig: Boolean(m),
        monthlyGoal,
        supplementaryGoal,
        kpiMetric,
        workingDays,
        daysLapsed: configuredDaysLapsed,
        mtd,
        bookedVolume,
        achievement: achievementPct(mtd, monthlyGoal),
        runRate: rr,
        rrAchievement: rrAchievementPct(rr, monthlyGoal),
        updatedAt: m?.updatedAt ?? c.createdAt,
      };
    });

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

    const { campaignId, monthlyGoal, supplementaryGoal, kpiMetric, workingDays, daysLapsed, month: monthRaw, year: yearRaw } = await req.json();

    if (!campaignId || monthlyGoal === undefined) {
      return NextResponse.json(
        { error: 'Missing campaignId or monthlyGoal' },
        { status: 400 }
      );
    }

    // A month must always be selected.
    if (monthRaw === undefined || monthRaw === null || monthRaw === '') {
      return NextResponse.json(
        { error: 'Please select a month before saving.' },
        { status: 400 }
      );
    }

    const { month, year, valid } = resolveMonthYear(monthRaw, yearRaw);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid month selected. Please choose a valid month.' },
        { status: 400 }
      );
    }

    if (user.role === 'OM' && user.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const goal = Number(monthlyGoal);
    const suppGoal = supplementaryGoal !== undefined ? Number(supplementaryGoal) || 0 : 0;
    const metric = kpiMetric !== undefined ? String(kpiMetric) : 'transmittals';
    const wDays = workingDays !== undefined ? Number(workingDays) : 22;
    const dLapsed = daysLapsed !== undefined ? Number(daysLapsed) : 0;

    await ensureCampaignGoalTable();

    const existingGoalRows = await prisma.$queryRaw<Array<{ monthlyGoal: number | string }>>`
      SELECT "monthlyGoal"
      FROM "CampaignGoal"
      WHERE "campaignId" = ${campaignId}
        AND "month" = ${month}
        AND "year" = ${year}
        AND "deletedAt" IS NULL
      LIMIT 1
    `;
    const previousGoal =
      existingGoalRows.length > 0 ? Number(existingGoalRows[0].monthlyGoal) : null;
    const isUpdate = previousGoal !== null;

    // Upsert the per-(campaign, month, year) goal configuration. Creates a new
    // record or updates the existing one for this exact combination.
    await prisma.$executeRaw`
      INSERT INTO "CampaignGoal"
        ("id", "campaignId", "month", "year", "monthlyGoal", "supplementaryGoal", "kpiMetric", "workingDays", "daysLapsed", "createdAt", "updatedAt")
      VALUES
        (${crypto.randomUUID()}, ${campaignId}, ${month}, ${year}, ${goal}, ${suppGoal}, ${metric}, ${wDays}, ${dLapsed}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("campaignId", "month", "year")
      DO UPDATE SET
        "monthlyGoal" = EXCLUDED."monthlyGoal",
        "supplementaryGoal" = EXCLUDED."supplementaryGoal",
        "kpiMetric"   = EXCLUDED."kpiMetric",
        "workingDays" = EXCLUDED."workingDays",
        "daysLapsed"  = EXCLUDED."daysLapsed",
        "updatedAt"   = CURRENT_TIMESTAMP
    `;

    // Keep the legacy Campaign-level fields in sync for the CURRENT month so the
    // Collector Dashboard and other modules (which read Campaign.monthlyGoal)
    // stay accurate. Past/future months only update their own monthly record.
    const now = new Date();
    const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
    if (isCurrentMonth) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { monthlyGoal: goal, supplementaryGoal: suppGoal, ...(kpiMetric !== undefined && { kpiMetric: metric }) },
      });
      await prisma.$executeRaw`
        UPDATE "Campaign"
        SET "workingDays" = ${wDays}, "daysLapsed" = ${dLapsed}
        WHERE id = ${campaignId}
      `;
    }

    // Activity log — includes the selected month.
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { campaignName: true },
    });

    const activityType = isUpdate ? 'GOAL_UPDATED' : 'GOAL_CREATED';
    try {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog"
          ("id", "type", "campaignId", "month", "year", "previousValue", "newValue", "changedBy", "changedByName", "details", "createdAt")
        VALUES
          (${crypto.randomUUID()}, ${activityType}, ${campaignId}, ${month}, ${year},
           ${previousGoal ? previousGoal.toString() : null}, ${goal.toString()},
           ${user?.id}, ${user?.name ?? user?.email ?? user?.role ?? 'Unknown'},
           ${JSON.stringify({ kpiMetric: metric, workingDays: wDays, daysLapsed: dLapsed })},
           CURRENT_TIMESTAMP)
      `;
    } catch (logError) {
      // Non-critical: log table may not exist on older DBs
      console.log('ActivityLog insert skipped (table may not exist):', logError);
    }

    console.log(
      `[ActivityLog] Goal Configuration ${activityType === 'GOAL_CREATED' ? 'Created' : 'Updated'} | ` +
      `Campaign: ${campaign?.campaignName ?? campaignId} | ` +
      `Month: ${MONTH_NAMES[month - 1]} ${year} | ${activityType === 'GOAL_UPDATED' && previousGoal ? `Previous: ${previousGoal}, ` : ''}New: ${goal} | ` +
      `Updated By: ${user?.name ?? user?.email ?? user?.role} | ` +
      `Date: ${now.toISOString()}`
    );

    return NextResponse.json({
      campaignId,
      month,
      year,
      monthlyGoal: goal,
      supplementaryGoal: suppGoal,
      kpiMetric: metric,
      workingDays: wDays,
      daysLapsed: dLapsed,
    });
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

    const { userId, campaignId, monthlyTarget } = await req.json();

    if (!userId || !campaignId || monthlyTarget === undefined) {
      return NextResponse.json(
        { error: 'Missing userId, campaignId or monthlyTarget' },
        { status: 400 }
      );
    }

    // Validate that the agent is officially assigned to the selected campaign.
    // Prevents saving a target for an agent that belongs to another campaign
    // (or is unassigned/incorrectly mapped). Scopes the write by campaign id +
    // agent id so only the selected agent under the selected campaign is touched.
    if (!(await isAgentInCampaign(userId, campaignId))) {
      return NextResponse.json(
        { error: 'Agent is not assigned to the selected campaign' },
        { status: 400 }
      );
    }

    const result = await prisma.user.updateMany({
      where: { id: userId, campaignId, role: 'AGENT' },
      data: { monthlyTarget: Number(monthlyTarget) },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Agent is not assigned to the selected campaign' },
        { status: 400 }
      );
    }

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, monthlyTarget: true },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Agent target PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
