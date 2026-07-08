import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runRate, achievementPct, rrAchievementPct, WORKING_DAYS_DEFAULT } from '@/utils/kpi';

const BUSINESS_TIME_ZONE = 'Asia/Manila';
const BUSINESS_TIME_ZONE_OFFSET = '+08:00';

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, '0')}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function toBusinessYmd(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const yyyy = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const mm = parts.find((part) => part.type === 'month')?.value ?? '01';
  const dd = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${yyyy}-${mm}-${dd}`;
}

type MetricTotals = {
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  volume: number;
  transaction: number;
};

type MetricKey = keyof MetricTotals;

function normalizeMetric(metric: string | null | undefined): MetricKey {
  const normalized = (metric ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['activation', 'activations', 'activated', 'act'].includes(normalized)) return 'activations';
  if (['approval', 'approvals', 'approved', 'appr'].includes(normalized)) return 'approvals';
  if (['book', 'booked', 'booking', 'bookings'].includes(normalized)) return 'booked';
  if (['volume', 'vol'].includes(normalized)) return 'volume';
  if (['transaction', 'transactions', 'txn', 'txns'].includes(normalized)) return 'transaction';
  return 'transmittals';
}

function metricValue(metric: string, totals: MetricTotals) {
  if (metric === 'activations') return totals.activations;
  if (metric === 'approvals') return totals.approvals;
  if (metric === 'booked') return totals.booked;
  if (metric === 'volume') return totals.volume;
  if (metric === 'transaction') return totals.transaction;
  return totals.transmittals;
}

function resolveEffectiveMetric(metric: MetricKey, goal: number, totals: MetricTotals) {
  const configuredActual = metricValue(metric, totals);
  const looksLikeMoneyGoal = goal >= 1_000_000;
  const hasMeaningfulVolume = totals.volume > configuredActual && totals.volume > 0;

  return metric !== 'volume' && looksLikeMoneyGoal && hasMeaningfulVolume ? 'volume' : metric;
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function reportStatus(achievement: number): 'on-track' | 'at-risk' | 'exceeding' {
  if (achievement >= 100) return 'exceeding';
  if (achievement >= 85) return 'on-track';
  return 'at-risk';
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role === 'AGENT' || user.role === 'COLLECTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get('year') ?? new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

    const { start: startDate, end: endDate } = monthRange(year, month);

    const details = await prisma.productionDetail.findMany({
      where: {
        ...(user.role === 'CEO' ? {} : user.campaignId ? { campaignId: user.campaignId } : {}),
        productionEntry: {
          OR: [
            { date: { gte: startDate, lte: endDate } },
            {
              periodStart: { lte: endDate },
              periodEnd: { gte: startDate },
            },
          ],
        },
      },
      select: {
        agentId: true,
        campaignId: true,
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        volume: true,
        transaction: true,
        campaign: {
          select: {
            id: true,
            campaignName: true,
            kpiMetric: true,
            monthlyGoal: true,
          },
        },
        productionEntry: { select: { date: true, periodStart: true, periodEnd: true } },
      },
    });

    const campaignIds = Array.from(new Set(details.map((detail) => detail.campaignId)));
    const monthlyGoalRows = campaignIds.length > 0
      ? await prisma.campaignGoal.findMany({
          where: { campaignId: { in: campaignIds }, month, year },
          select: {
            campaignId: true,
            monthlyGoal: true,
            kpiMetric: true,
            workingDays: true,
          },
        })
      : [];
    const monthlyByCampaignId = new Map(monthlyGoalRows.map((row) => [row.campaignId, row]));

    const campaignMap = new Map<string, {
      id: string;
      name: string;
      kpiMetric: string;
      monthlyGoal: number;
      workingDays: number;
      transmittals: number;
      activations: number;
      approvals: number;
      booked: number;
      volume: number;
      transaction: number;
      agentIds: Set<string>;
      workedDates: Set<string>;
    }>();

    details.forEach((detail) => {
      const campaign = detail.campaign;
      if (!campaign?.id) return;

      if (!campaignMap.has(campaign.id)) {
        const monthlyGoal = monthlyByCampaignId.get(campaign.id);
        campaignMap.set(campaign.id, {
          id: campaign.id,
          name: campaign.campaignName,
          kpiMetric: monthlyGoal?.kpiMetric ?? campaign.kpiMetric,
          monthlyGoal: Number(monthlyGoal?.monthlyGoal ?? campaign.monthlyGoal ?? 0),
          workingDays: Number(monthlyGoal?.workingDays ?? WORKING_DAYS_DEFAULT),
          transmittals: 0,
          activations: 0,
          approvals: 0,
          booked: 0,
          volume: 0,
          transaction: 0,
          agentIds: new Set<string>(),
          workedDates: new Set<string>(),
        });
      }

      const report = campaignMap.get(campaign.id)!;
      report.transmittals += Number(detail.transmittals || 0);
      report.activations += Number(detail.activations || 0);
      report.approvals += Number(detail.approvals || 0);
      report.booked += Number(detail.booked || 0);
      report.volume += Number(detail.volume || 0);
      report.transaction += Number(detail.transaction || 0);
      report.agentIds.add(detail.agentId);
      report.workedDates.add(toBusinessYmd(detail.productionEntry.periodEnd ?? detail.productionEntry.date));
    });

    const campaignReports = Array.from(campaignMap.values()).map((campaign) => {
      const configuredMetric = normalizeMetric(campaign.kpiMetric);
      const effectiveMetric = resolveEffectiveMetric(configuredMetric, campaign.monthlyGoal, campaign);
      const mtd = metricValue(effectiveMetric, campaign);
      const elapsed = campaign.workedDates.size;
      const rr = runRate(mtd, elapsed, campaign.workingDays);
      const ach = achievementPct(mtd, campaign.monthlyGoal);
      const rrAch = rrAchievementPct(rr, campaign.monthlyGoal);
      const avgQuality = percent(campaign.approvals, campaign.transmittals);
      const avgConversion = percent(campaign.booked, campaign.transmittals);

      const status = reportStatus(ach);

      return {
        id: campaign.id,
        name: campaign.name,
        kpiMetric: effectiveMetric,
        monthlyGoal: campaign.monthlyGoal,
        mtd: Math.round(mtd),
        achievement: ach,
        runRate: Math.round(rr),
        rrAchievement: rrAch,
        agentCount: campaign.agentIds.size,
        avgQuality,
        avgConversion,
        status,
      };
    }).sort((a, b) => b.achievement - a.achievement || a.name.localeCompare(b.name));

    const onTrack = campaignReports.filter(c => c.status === 'on-track').length;
    const atRisk = campaignReports.filter(c => c.status === 'at-risk').length;
    const exceeding = campaignReports.filter(c => c.status === 'exceeding').length;
    const avgAchievement = campaignReports.length > 0 
      ? campaignReports.reduce((sum, c) => sum + c.achievement, 0) / campaignReports.length
      : 0;

    return NextResponse.json({
      campaigns: campaignReports,
      summary: {
        totalCampaigns: campaignReports.length,
        onTrack,
        atRisk,
        exceeding,
        avgAchievement,
      },
    });
  } catch (error) {
    console.error('Campaign reports API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
