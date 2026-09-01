export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runRate, achievementPct, rrAchievementPct, WORKING_DAYS_DEFAULT } from '@/utils/kpi';
import { isExcludedBpiYtdRecord } from '@/lib/bpi-dashboard-import';

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

function normalizeAgentName(value: string | null | undefined) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function normalizeImportedMetric(value: string | null | undefined) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isImportedClassificationRow(row: {
  worksheetSource: string;
  monitoringType: string | null;
  entityName: string;
}) {
  const normalizedName = normalizeAgentName(row.entityName);
  return row.worksheetSource === 'PL YTD Productivity'
    && row.monitoringType === 'PL_PRODUCTIVITY'
    && /^(?:OLD|SEMI OLD|NEW|(?:OLD|SEMI OLD|NEW|TOTAL) AVERAGE PER AGENT)$/.test(normalizedName);
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
    const allMonths = searchParams.get('allMonths') === 'true';

    const { start: startDate, end: endDate } = monthRange(year, month);

    const campaignCatalog = await prisma.campaign.findMany({
      where: user.role === 'CEO'
        ? undefined
        : user.campaignId
          ? { id: user.campaignId }
          : { id: { in: [] } },
      select: {
        id: true,
        campaignName: true,
        kpiMetric: true,
        monthlyGoal: true,
      },
    });
    const scopedCampaignIds = campaignCatalog.map((campaign) => campaign.id);
    const campaignById = new Map(campaignCatalog.map((campaign) => [campaign.id, campaign]));

    const details = await prisma.productionDetail.findMany({
      where: {
        campaignId: { in: scopedCampaignIds },
        productionEntry: allMonths
          ? { importFileName: { not: null } }
          : {
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

    const dashboardImportRows = scopedCampaignIds.length > 0
      ? await prisma.dashboardImportRecord.findMany({
          where: {
            campaignId: { in: scopedCampaignIds },
            ...(allMonths ? {} : { year, month }),
          },
          select: {
            campaignId: true,
            recordKind: true,
            worksheetSource: true,
            entityName: true,
            monitoringType: true,
            metric: true,
            year: true,
            month: true,
            reportDate: true,
            target: true,
            actual: true,
            achievement: true,
            numericValue: true,
          },
          orderBy: [{ reportDate: 'asc' }, { sourceRow: 'asc' }],
        }).catch(() => [])
      : [];

    const campaignIds = Array.from(new Set([
      ...details.map((detail) => detail.campaignId),
      ...dashboardImportRows.map((row) => row.campaignId),
    ]));
    const monthlyGoalRows = campaignIds.length > 0
      ? await prisma.campaignGoal.findMany({
          where: {
            campaignId: { in: campaignIds },
            ...(allMonths ? {} : { month, year }),
          },
          select: {
            campaignId: true,
            month: true,
            year: true,
            monthlyGoal: true,
            kpiMetric: true,
            workingDays: true,
          },
        })
      : [];
    const importedPeriodsByCampaign = new Map<string, Set<string>>();
    details.forEach((detail) => {
      const periods = importedPeriodsByCampaign.get(detail.campaignId) ?? new Set<string>();
      periods.add(toBusinessYmd(detail.productionEntry.periodEnd ?? detail.productionEntry.date).slice(0, 7));
      importedPeriodsByCampaign.set(detail.campaignId, periods);
    });
    dashboardImportRows.forEach((row) => {
      const periods = importedPeriodsByCampaign.get(row.campaignId) ?? new Set<string>();
      periods.add(`${row.year}-${String(row.month ?? Number(toBusinessYmd(row.reportDate).slice(5, 7))).padStart(2, '0')}`);
      importedPeriodsByCampaign.set(row.campaignId, periods);
    });
    const goalByCampaignPeriod = new Map(monthlyGoalRows.map((row) => [
      `${row.campaignId}|${row.year}-${String(row.month).padStart(2, '0')}`,
      row,
    ]));
    const monthlyByCampaignId = new Map<string, {
      monthlyGoal: number;
      kpiMetric: string;
      workingDays: number;
    }>();
    campaignIds.forEach((campaignId) => {
      const campaign = campaignById.get(campaignId)!;
      if (!allMonths) {
        const config = monthlyGoalRows.find((row) => row.campaignId === campaignId);
        if (config) monthlyByCampaignId.set(campaignId, config);
        return;
      }
      const periods = importedPeriodsByCampaign.get(campaignId) ?? new Set<string>();
      const latestConfig = monthlyGoalRows.find((row) => row.campaignId === campaignId);
      monthlyByCampaignId.set(campaignId, {
        monthlyGoal: [...periods].reduce(
          (sum, period) => sum + Number(goalByCampaignPeriod.get(`${campaignId}|${period}`)?.monthlyGoal ?? campaign.monthlyGoal ?? 0),
          0
        ),
        kpiMetric: latestConfig?.kpiMetric ?? campaign.kpiMetric,
        workingDays: WORKING_DAYS_DEFAULT,
      });
    });

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

    const ensureCampaign = (campaignId: string) => {
      if (campaignMap.has(campaignId)) return campaignMap.get(campaignId)!;
      const campaign = campaignById.get(campaignId);
      if (!campaign) return null;
      const monthlyGoal = monthlyByCampaignId.get(campaign.id);
      const report = {
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
      };
      campaignMap.set(campaign.id, report);
      return report;
    };

    campaignIds.forEach(ensureCampaign);

    details.forEach((detail) => {
      const campaign = detail.campaign;
      if (!campaign?.id) return;

      const report = ensureCampaign(campaign.id);
      if (!report) return;
      report.transmittals += Number(detail.transmittals || 0);
      report.activations += Number(detail.activations || 0);
      report.approvals += Number(detail.approvals || 0);
      report.booked += Number(detail.booked || 0);
      report.volume += Number(detail.volume || 0);
      report.transaction += Number(detail.transaction || 0);
      report.agentIds.add(detail.agentId);
      report.workedDates.add(toBusinessYmd(detail.productionEntry.periodEnd ?? detail.productionEntry.date));
    });

    const usableDashboardRows = dashboardImportRows.filter((row) =>
      !isImportedClassificationRow(row) &&
      !isExcludedBpiYtdRecord(row, campaignById.get(row.campaignId)?.campaignName)
    );
    const importedActual = (row: (typeof dashboardImportRows)[number]) => row.actual != null
      ? Number(row.actual)
      : row.target != null && row.achievement != null
        ? Number(row.target) * Number(row.achievement)
        : null;

    const bpiCurrencyCampaigns = new Set(
      usableDashboardRows
        .filter((row) => Number(row.target || 0) >= 1_000_000
          && /^BPI\b/i.test(campaignById.get(row.campaignId)?.campaignName || ''))
        .map((row) => row.campaignId)
    );
    const campaignsWithAgentRows = new Set(
      usableDashboardRows
        .filter((row) => row.recordKind === 'agent_monitoring')
        .map((row) => row.campaignId)
    );

    // Some workbooks expose the same agent/metric in both a campaign summary
    // sheet and a dedicated agent sheet. Keep the most specific agent row.
    const preferredDashboardRows = new Map<string, (typeof dashboardImportRows)[number]>();
    for (const row of usableDashboardRows) {
      if (!['agent_monitoring', 'ytd'].includes(row.recordKind)) continue;
      const key = [
        row.campaignId,
        normalizeAgentName(row.entityName || 'Campaign Total'),
        row.year,
        row.month || 0,
        normalizeImportedMetric(row.metric),
      ].join('|');
      const existing = preferredDashboardRows.get(key);
      const priority = row.monitoringType?.endsWith('_AGENT') ? 2 : 1;
      const existingPriority = existing?.monitoringType?.endsWith('_AGENT') ? 2 : existing ? 1 : 0;
      if (!existing || priority > existingPriority) preferredDashboardRows.set(key, row);
    }

    const importedHeadCountByCampaign = new Map<string, number>();
    for (const row of usableDashboardRows) {
      const report = ensureCampaign(row.campaignId);
      if (!report) continue;
      report.workedDates.add(toBusinessYmd(row.reportDate));

      if (row.recordKind === 'agent_monitoring' && normalizeAgentName(row.entityName)) {
        report.agentIds.add(`imported:${normalizeAgentName(row.entityName)}`);
      }

      if (normalizeImportedMetric(row.metric) === 'actual head count' && row.numericValue != null) {
        importedHeadCountByCampaign.set(
          row.campaignId,
          Math.max(importedHeadCountByCampaign.get(row.campaignId) || 0, Number(row.numericValue))
        );
      }
    }

    const importedQualityByCampaign = new Map<string, {
      transmittals: number;
      approvals: number;
      booked: number;
    }>();
    for (const row of preferredDashboardRows.values()) {
      if (row.recordKind !== 'agent_monitoring') continue;
      const actual = importedActual(row);
      if (actual == null) continue;
      const metric = normalizeImportedMetric(row.metric);
      const totals = importedQualityByCampaign.get(row.campaignId) || {
        transmittals: 0,
        approvals: 0,
        booked: 0,
      };
      if (metric === 'transmitted count') totals.transmittals += actual;
      if (metric === 'approvals count') totals.approvals += actual;
      if (metric === 'booked count') totals.booked += actual;
      importedQualityByCampaign.set(row.campaignId, totals);
    }

    const importedKpiRows = [...preferredDashboardRows.values()].flatMap((row) => {
      const campaign = campaignById.get(row.campaignId);
      if (!campaign) return [];
      const metric = normalizeImportedMetric(row.metric);
      const configuredMetric = normalizeMetric(campaign.kpiMetric);
      const effectiveMetric: MetricKey = bpiCurrencyCampaigns.has(row.campaignId)
        ? 'volume'
        : configuredMetric;
      const actual = importedActual(row);
      if (actual == null) return [];
      const isGenericPerformanceMetric = /\b(?:performance|actual)\b/.test(metric)
        && !/\b(?:score|ranking)\b/.test(metric);

      const matchesKpi =
        (effectiveMetric === 'transmittals' && (metric === 'transmitted count'
          || isGenericPerformanceMetric))
        || (effectiveMetric === 'approvals' && (metric === 'approvals count'
          || isGenericPerformanceMetric))
        || (effectiveMetric === 'booked' && (metric === 'booked count'
          || isGenericPerformanceMetric))
        || (effectiveMetric === 'activations' && isGenericPerformanceMetric)
        || (effectiveMetric === 'volume' && (
          row.recordKind === 'ytd'
          || metric.includes('booked volume')
          || metric.includes('cash installment')
          || isGenericPerformanceMetric
          || (!campaignsWithAgentRows.has(row.campaignId) && metric.includes('volume'))
        ));

      return matchesKpi ? [{ ...row, value: actual, effectiveMetric }] : [];
    });

    const importedKpiByCampaign = new Map<string, {
      metric: MetricKey;
      mtd: number;
      goal: number;
    }>();
    for (const campaignId of campaignIds) {
      const rows = importedKpiRows.filter((row) => row.campaignId === campaignId);
      if (rows.length === 0) continue;
      const ytdRows = rows.filter((row) => row.recordKind === 'ytd' && row.value !== 0);
      const latestYtdPeriod = allMonths && ytdRows.length > 0
        ? Math.max(...ytdRows.map((row) => row.year * 12 + Number(row.month || 0)))
        : null;
      const selectedYtdRows = latestYtdPeriod == null
        ? ytdRows
        : ytdRows.filter((row) => row.year * 12 + Number(row.month || 0) === latestYtdPeriod);
      const selectedRows = selectedYtdRows.length > 0 ? selectedYtdRows : rows.filter((row) => row.recordKind !== 'ytd');
      if (selectedRows.length === 0) continue;
      importedKpiByCampaign.set(campaignId, {
        metric: selectedRows[0].effectiveMetric,
        mtd: selectedRows.reduce((sum, row) => sum + row.value, 0),
        goal: selectedRows.reduce((sum, row) => sum + Number(row.target || 0), 0),
      });
    }

    const campaignReports = Array.from(campaignMap.values()).map((campaign) => {
      const configuredMetric = normalizeMetric(campaign.kpiMetric);
      const importedKpi = importedKpiByCampaign.get(campaign.id);
      const monthlyGoal = importedKpi?.goal || campaign.monthlyGoal;
      const effectiveMetric = importedKpi?.metric
        ?? resolveEffectiveMetric(configuredMetric, monthlyGoal, campaign);
      // Normalized workbook KPI rows are authoritative for imported BPI/BDO
      // campaigns. This prevents counting the workbook again if a legacy
      // ProductionDetail mirror also exists.
      const mtd = importedKpi?.mtd ?? metricValue(effectiveMetric, campaign);
      const elapsed = campaign.workedDates.size;
      const rr = allMonths ? mtd : runRate(mtd, elapsed, campaign.workingDays);
      const ach = achievementPct(mtd, monthlyGoal);
      const rrAch = allMonths ? ach : rrAchievementPct(rr, monthlyGoal);
      const importedQuality = importedQualityByCampaign.get(campaign.id);
      const qualityTransmittals = importedQuality?.transmittals || campaign.transmittals;
      const qualityApprovals = importedQuality?.transmittals
        ? importedQuality.approvals
        : campaign.approvals;
      const qualityBooked = importedQuality?.transmittals
        ? importedQuality.booked
        : campaign.booked;
      const avgQuality = percent(qualityApprovals, qualityTransmittals);
      const avgConversion = percent(qualityBooked, qualityTransmittals);

      const status = reportStatus(ach);

      return {
        id: campaign.id,
        name: campaign.name,
        kpiMetric: effectiveMetric,
        monthlyGoal,
        mtd: Math.round(mtd),
        achievement: ach,
        runRate: Math.round(rr),
        rrAchievement: rrAch,
        agentCount: Math.max(
          campaign.agentIds.size,
          importedHeadCountByCampaign.get(campaign.id) || 0
        ),
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
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    console.error('Campaign reports API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
