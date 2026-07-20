import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runRate, achievementPct, rrAchievementPct, WORKING_DAYS_DEFAULT } from '@/utils/kpi';

const BUSINESS_TIME_ZONE = 'Asia/Manila';
const BUSINESS_TIME_ZONE_OFFSET = '+08:00';

type MetricKey = 'transmittals' | 'activations' | 'approvals' | 'booked' | 'volume' | 'transaction';
type MetricTotals = Record<MetricKey, number>;

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

function normalizeMetric(metric: string | null | undefined): MetricKey {
  const normalized = (metric ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['activation', 'activations', 'activated', 'act'].includes(normalized)) return 'activations';
  if (['approval', 'approvals', 'approved', 'appr'].includes(normalized)) return 'approvals';
  if (['book', 'booked', 'booking', 'bookings'].includes(normalized)) return 'booked';
  if (['volume', 'vol'].includes(normalized)) return 'volume';
  if (['transaction', 'transactions', 'txn', 'txns'].includes(normalized)) return 'transaction';
  return 'transmittals';
}

function metricValue(metric: string, totals: Record<string, number>) {
  if (metric === 'activations') return totals.activations;
  if (metric === 'approvals') return totals.approvals;
  if (metric === 'booked') return totals.booked;
  if (metric === 'volume') return totals.volume;
  if (metric === 'transaction') return totals.transaction;
  return totals.transmittals;
}

function resolveEffectiveMetric(metric: MetricKey, goal: number, totals: MetricTotals, agentGoal: number) {
  const configuredActual = metricValue(metric, totals);
  const looksLikeMoneyGoal = goal >= 1_000_000 || agentGoal >= 1_000_000;
  const hasMeaningfulVolume = totals.volume > configuredActual && totals.volume > 0;

  return metric !== 'volume' && looksLikeMoneyGoal && hasMeaningfulVolume ? 'volume' : metric;
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== 'CEO') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('id');
    const campaignId = searchParams.get('campaignId');
    const year = parseInt(searchParams.get('year') ?? new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

    const { start: startDate, end: endDate } = monthRange(year, month);

    const where: any = {
      ...(campaignId ? { campaignId } : {}),
      productionEntry: {
        OR: [
          { date: { gte: startDate, lte: endDate } },
          {
            periodStart: { lte: endDate },
            periodEnd: { gte: startDate },
          },
        ],
      },
    };
    if (agentId) {
      where.agentId = agentId;
    }

    const details = await prisma.productionDetail.findMany({
      where,
      select: {
        agentId: true,
        campaignId: true,
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        volume: true,
        transaction: true,
        agent: { select: { id: true, name: true, seatNumber: true, monthlyTarget: true } },
        campaign: { select: { id: true, campaignName: true, kpiMetric: true, monthlyGoal: true } },
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
          },
        })
      : [];
    const monthlyByCampaignId = new Map(monthlyGoalRows.map((row) => [row.campaignId, row]));

    const agentMap = new Map();

    details.forEach((detail) => {
      if (!detail.agent?.id || !detail.campaign?.id) return;
      const agentId = detail.agentId;
      const dateKey = toBusinessYmd(detail.productionEntry.periodEnd ?? detail.productionEntry.date);

      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, {
          id: detail.agentId,
          name: detail.agent.name,
          seatNumber: detail.agent.seatNumber,
          monthlyTarget: detail.agent.monthlyTarget,
          campaigns: new Map(),
          totalTransmittals: 0,
          totalActivations: 0,
          totalApprovals: 0,
          totalBooked: 0,
          totalVolume: 0,
          totalTransaction: 0,
          workedDates: new Set<string>(),
        });
      }

      const agent = agentMap.get(agentId);
      const transmittals = Number(detail.transmittals || 0);
      const activations = Number(detail.activations || 0);
      const approvals = Number(detail.approvals || 0);
      const booked = Number(detail.booked || 0);
      const volume = Number(detail.volume || 0);
      const transaction = Number(detail.transaction || 0);

      agent.totalTransmittals += transmittals;
      agent.totalActivations += activations;
      agent.totalApprovals += approvals;
      agent.totalBooked += booked;
      agent.totalVolume += volume;
      agent.totalTransaction += transaction;
      agent.workedDates.add(dateKey);

      const campId = detail.campaignId;
      if (!agent.campaigns.has(campId)) {
        const monthlyGoal = monthlyByCampaignId.get(campId);
        agent.campaigns.set(campId, {
          id: detail.campaign.id,
          name: detail.campaign.campaignName,
          kpiMetric: monthlyGoal?.kpiMetric ?? detail.campaign.kpiMetric,
          monthlyGoal: Number(monthlyGoal?.monthlyGoal ?? detail.campaign.monthlyGoal ?? 0),
          transmittals: 0,
          activations: 0,
          approvals: 0,
          booked: 0,
          volume: 0,
          transaction: 0,
          workedDates: new Set<string>(),
        });
      }

      const camp = agent.campaigns.get(campId);
      camp.transmittals += transmittals;
      camp.activations += activations;
      camp.approvals += approvals;
      camp.booked += booked;
      camp.volume += volume;
      camp.transaction += transaction;
      camp.workedDates.add(dateKey);
    });

    const agents = Array.from(agentMap.values()).map((agent: any) => {
      const campaigns = Array.from(agent.campaigns.values()).map((camp: any) => {
        const configuredMetric = normalizeMetric(camp.kpiMetric);
        const agentGoal = Number(agent.monthlyTarget || 0);
        const effectiveMetric = resolveEffectiveMetric(configuredMetric, camp.monthlyGoal, camp, agentGoal);
        const goal = agentGoal > 0 ? agentGoal : camp.monthlyGoal;
        const mtd = metricValue(effectiveMetric, camp);
        const elapsed = camp.workedDates.size;
        const rr = runRate(mtd, elapsed, WORKING_DAYS_DEFAULT);
        const ach = achievementPct(mtd, goal);
        const rrAch = rrAchievementPct(rr, goal);
        const avgQuality = percent(camp.approvals, camp.transmittals);
        const avgConversion = percent(camp.booked, camp.transmittals);

        return {
          id: camp.id,
          name: camp.name,
          kpiMetric: effectiveMetric,
          monthlyGoal: goal,
          mtd,
          runRate: rr,
          achievement: ach,
          rrAchievement: rrAch,
          avgQualityRate: avgQuality,
          avgConversionRate: avgConversion,
          totalTransmittals: camp.transmittals,
          totalActivations: camp.activations,
          totalApprovals: camp.approvals,
          totalBooked: camp.booked,
        };
      });

      const avgQuality = percent(agent.totalApprovals, agent.totalTransmittals);
      const avgConversion = percent(agent.totalBooked, agent.totalTransmittals);

      return {
        id: agent.id,
        name: agent.name,
        seatNumber: agent.seatNumber,
        monthlyTarget: agent.monthlyTarget,
        campaigns,
        totalTransmittals: agent.totalTransmittals,
        totalActivations: agent.totalActivations,
        totalApprovals: agent.totalApprovals,
        totalBooked: agent.totalBooked,
        totalVolume: agent.totalVolume,
        totalTransaction: agent.totalTransaction,
        avgQualityRate: avgQuality,
        avgConversionRate: avgConversion,
        daysWorked: agent.workedDates.size,
      };
    }).sort((a: any, b: any) => {
      const averageAchievement = (agent: any) => agent.campaigns.length > 0
        ? agent.campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.achievement || 0), 0) / agent.campaigns.length
        : 0;
      const productionTotal = (agent: any) =>
        agent.campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.mtd || 0), 0);
      return averageAchievement(b) - averageAchievement(a)
        || productionTotal(b) - productionTotal(a)
        || a.name.localeCompare(b.name);
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Agent summary error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
