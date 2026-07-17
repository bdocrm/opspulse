import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAssignedCampaignIds } from '@/lib/user-campaigns';

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

function normalizeName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function normalizeMetric(value: string) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function achievementPercent(value: number | null, actual: number | null, target: number | null) {
  if (value != null && Number.isFinite(value)) {
    // Dashboard/bulk-import achievements are stored as ratios (0.329 = 32.9%).
    return Math.abs(value) <= 5 ? value * 100 : value;
  }
  return actual != null && target != null ? percent(actual, target) : null;
}

function qualityPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1.5 ? value * 100 : value;
}

function isImportedClassificationRow(row: {
  worksheetSource: string;
  monitoringType: string | null;
  entityName: string;
}) {
  const normalizedName = normalizeName(row.entityName);
  return row.worksheetSource === 'PL YTD Productivity' &&
    row.monitoringType === 'PL_PRODUCTIVITY' &&
    /^(?:OLD|SEMI OLD|NEW|(?:OLD|SEMI OLD|NEW|TOTAL) AVERAGE PER AGENT)$/.test(normalizedName);
}

function importRowPriority(monitoringType: string | null) {
  if (monitoringType?.endsWith('_AGENT')) return 3;
  if (monitoringType?.includes('PRODUCTIVITY')) return 2;
  if (monitoringType?.endsWith('_HOH')) return 1;
  return 2;
}

function isImportedTaskMetric(row: {
  monitoringType: string | null;
  metric: string;
  actual: number | null;
  target: number | null;
}) {
  const metric = normalizeMetric(row.metric);
  if (/\b(?:volume|amount|cash installment|performance)\b/.test(metric)) return false;
  if (/\b(?:count|transaction|activation|approval|booked|transmitted|transmittal|application|ntb|supplementary)\b/.test(metric)) {
    return true;
  }

  // BDO cross-sell sheets use the product name as the metric, but their
  // target/actual values are task counts rather than currency amounts.
  if (row.monitoringType?.startsWith('CROSS_SELL_')) return true;

  return false;
}

function countMetricKind(metricName: string) {
  const metric = normalizeMetric(metricName);
  if (/\b(?:transmitted|transmittal)\b/.test(metric)) return 'transmittals';
  if (/\bapproval/.test(metric)) return 'approvals';
  if (/\bbooked/.test(metric)) return 'booked';
  if (/\bactivation/.test(metric)) return 'activations';
  return null;
}

function sumBigInts(values: Array<bigint | number>) {
  return values.reduce<number>((sum, value) => sum + Number(value || 0), 0);
}

function detailTaskCount(detail: {
  transmittals: bigint;
  activations: bigint;
  approvals: bigint;
  booked: bigint;
  transaction: bigint;
  ntb: bigint;
  supplementary: bigint;
  bauPayrollTxn: bigint;
  bauDepositorTxn: bigint;
  topupPayrollTxn: bigint;
  topupDepositorTxn: bigint;
  openMarketTxn: bigint;
  c2gTxn: bigint;
  btTxn: bigint;
  balconTxn: bigint;
  grandTotalTxn: bigint;
}) {
  const transaction = Number(detail.transaction || 0);
  if (transaction > 0) return transaction;

  const grandTotal = Number(detail.grandTotalTxn || 0);
  if (grandTotal > 0) return grandTotal;

  const acquisition = sumBigInts([detail.ntb, detail.supplementary]);
  if (acquisition > 0) return acquisition;

  const categoryTransactions = sumBigInts([
    detail.bauPayrollTxn,
    detail.bauDepositorTxn,
    detail.topupPayrollTxn,
    detail.topupDepositorTxn,
    detail.openMarketTxn,
    detail.c2gTxn,
    detail.btTxn,
    detail.balconTxn,
  ]);
  if (categoryTransactions > 0) return categoryTransactions;

  return sumBigInts([
    detail.transmittals,
    detail.activations,
    detail.approvals,
    detail.booked,
  ]);
}

type CountBreakdown = {
  transmittals: number;
  approvals: number;
  booked: number;
  activations: number;
};

type AgentAccumulator = {
  agentId: string;
  agentName: string;
  campaignId: string;
  campaignName: string;
  seatNumber: number | null;
  importedTasks: number;
  detailTasks: number;
  hasImportedTaskMetric: boolean;
  hasDetailTaskMetric: boolean;
  importedCounts: CountBreakdown;
  importedCountKinds: Set<keyof CountBreakdown>;
  detailCounts: CountBreakdown;
  importedAchievements: Map<string, number>;
  detailAchievements: number[];
  qualityScores: number[];
  workedDates: Set<string>;
  attendanceDays: number;
  hasAttendance: boolean;
  sources: Set<string>;
};

const emptyCounts = (): CountBreakdown => ({
  transmittals: 0,
  approvals: 0,
  booked: 0,
  activations: 0,
});

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null, digits = 1) {
  if (value == null) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
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
    const requestedCampaignId = searchParams.get('campaignId');

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid reporting period' }, { status: 400 });
    }

    const assignedCampaignIds = user.role === 'CEO' ? null : await getAssignedCampaignIds(user.id);
    const scopedCampaignIds = user.role === 'CEO'
      ? requestedCampaignId ? [requestedCampaignId] : null
      : requestedCampaignId
        ? assignedCampaignIds?.includes(requestedCampaignId) ? [requestedCampaignId] : []
        : assignedCampaignIds ?? [];
    const campaignIdWhere = scopedCampaignIds ? { in: scopedCampaignIds } : undefined;
    const { start: startDate, end: endDate } = monthRange(year, month);

    const detailSelect = {
      agentId: true,
      campaignId: true,
      transmittals: true,
      activations: true,
      approvals: true,
      booked: true,
      transaction: true,
      ntb: true,
      supplementary: true,
      bauPayrollTxn: true,
      bauDepositorTxn: true,
      topupPayrollTxn: true,
      topupDepositorTxn: true,
      openMarketTxn: true,
      c2gTxn: true,
      btTxn: true,
      balconTxn: true,
      grandTotalTxn: true,
      qualityRate: true,
      monthlyGoal: true,
      monthlyActual: true,
      monthlyAchievement: true,
      agent: { select: { id: true, name: true, seatNumber: true } },
      productionEntry: {
        select: {
          id: true,
          date: true,
          importFileName: true,
          reportPeriodType: true,
        },
      },
    } as const;

    const [campaigns, details, rawImportedRows, registeredAgents, attendance] = await Promise.all([
      prisma.campaign.findMany({
        where: campaignIdWhere ? { id: campaignIdWhere } : undefined,
        select: { id: true, campaignName: true },
      }),
      prisma.productionDetail.findMany({
        where: {
          ...(campaignIdWhere ? { campaignId: campaignIdWhere } : {}),
          productionEntry: { date: { gte: startDate, lte: endDate } },
        },
        select: detailSelect,
      }),
      prisma.dashboardImportRecord.findMany({
        where: {
          ...(campaignIdWhere ? { campaignId: campaignIdWhere } : {}),
          year,
          month,
          recordKind: 'agent_monitoring',
          entityName: { not: '' },
          OR: [{ actual: { not: null } }, { achievement: { not: null } }],
        },
        select: {
          campaignId: true,
          worksheetSource: true,
          monitoringType: true,
          entityName: true,
          category: true,
          product: true,
          metric: true,
          target: true,
          actual: true,
          achievement: true,
          sourceFile: true,
        },
      }).catch(() => []),
      prisma.user.findMany({
        where: {
          role: 'AGENT',
          ...(campaignIdWhere
            ? {
                OR: [
                  { campaignId: campaignIdWhere },
                  { campaignAssignments: { some: { campaignId: campaignIdWhere } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          seatNumber: true,
          campaignId: true,
          campaignAssignments: { select: { campaignId: true } },
        },
      }),
      prisma.attendance.findMany({
        where: {
          ...(campaignIdWhere ? { campaignId: campaignIdWhere } : {}),
          date: { gte: startDate, lte: endDate },
        },
        select: { agentId: true, campaignId: true, date: true, status: true },
      }),
    ]);

    const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.campaignName]));
    const registeredByCampaignAndName = new Map<string, (typeof registeredAgents)[number]>();
    for (const agent of registeredAgents) {
      const ids = new Set([
        agent.campaignId,
        ...agent.campaignAssignments.map((assignment) => assignment.campaignId),
      ].filter(Boolean) as string[]);
      for (const campaignId of ids) {
        registeredByCampaignAndName.set(`${campaignId}|${normalizeName(agent.name)}`, agent);
      }
    }

    const agentMap = new Map<string, AgentAccumulator>();
    const getAgent = (
      campaignId: string,
      name: string,
      registered?: { id: string; name: string; seatNumber: number | null },
    ) => {
      const normalizedName = normalizeName(name);
      const key = `${campaignId}|${normalizedName}`;
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          agentId: registered?.id ?? `imported:${campaignId}:${normalizedName}`,
          agentName: registered?.name ?? name.trim(),
          campaignId,
          campaignName: campaignNames.get(campaignId) ?? 'Unknown Campaign',
          seatNumber: registered?.seatNumber ?? null,
          importedTasks: 0,
          detailTasks: 0,
          hasImportedTaskMetric: false,
          hasDetailTaskMetric: false,
          importedCounts: emptyCounts(),
          importedCountKinds: new Set(),
          detailCounts: emptyCounts(),
          importedAchievements: new Map(),
          detailAchievements: [],
          qualityScores: [],
          workedDates: new Set(),
          attendanceDays: 0,
          hasAttendance: false,
          sources: new Set(),
        });
      }
      return agentMap.get(key)!;
    };

    for (const detail of details) {
      const agent = getAgent(detail.campaignId, detail.agent.name, detail.agent);
      agent.detailTasks += detailTaskCount(detail);
      agent.hasDetailTaskMetric = true;
      agent.detailCounts.transmittals += Number(detail.transmittals || 0);
      agent.detailCounts.approvals += Number(detail.approvals || 0);
      agent.detailCounts.booked += Number(detail.booked || 0);
      agent.detailCounts.activations += Number(detail.activations || 0);

      const quality = qualityPercent(detail.qualityRate);
      if (quality != null) agent.qualityScores.push(quality);

      const achievement = achievementPercent(
        detail.monthlyAchievement,
        detail.monthlyActual,
        detail.monthlyGoal,
      );
      if (achievement != null) agent.detailAchievements.push(achievement);

      if (detail.productionEntry.reportPeriodType === 'daily') {
        agent.workedDates.add(toBusinessYmd(detail.productionEntry.date));
      }
      agent.sources.add(detail.productionEntry.importFileName ? 'Bulk import' : 'Production entry');
    }

    // Dashboard workbooks frequently include the same agent metric in both
    // AGENT and HOH worksheets. Keep the most specific row for each metric.
    const preferredImportedRows = new Map<string, (typeof rawImportedRows)[number]>();
    for (const row of rawImportedRows.filter((candidate) => !isImportedClassificationRow(candidate))) {
      const key = [
        row.campaignId,
        normalizeName(row.entityName),
        normalizeMetric(row.metric),
        normalizeMetric(row.category),
        normalizeMetric(row.product),
      ].join('|');
      const existing = preferredImportedRows.get(key);
      if (!existing || importRowPriority(row.monitoringType) > importRowPriority(existing.monitoringType)) {
        preferredImportedRows.set(key, row);
      }
    }

    for (const row of preferredImportedRows.values()) {
      const registered = registeredByCampaignAndName.get(`${row.campaignId}|${normalizeName(row.entityName)}`);
      const agent = getAgent(row.campaignId, row.entityName, registered);
      const actual = Number(row.actual ?? 0);

      if (isImportedTaskMetric(row)) {
        agent.importedTasks += actual;
        agent.hasImportedTaskMetric = true;
        const kind = countMetricKind(row.metric);
        if (kind) {
          agent.importedCounts[kind] += actual;
          agent.importedCountKinds.add(kind);
        }
      }

      const achievement = achievementPercent(row.achievement, row.actual, row.target);
      if (achievement != null) {
        agent.importedAchievements.set(normalizeMetric(row.metric), achievement);
      }
      agent.sources.add('Bulk import');
    }

    const agentsByIdAndCampaign = new Map(
      [...agentMap.values()].map((agent) => [`${agent.campaignId}|${agent.agentId}`, agent]),
    );
    for (const record of attendance) {
      const detailAgent = agentsByIdAndCampaign.get(`${record.campaignId}|${record.agentId}`);
      if (!detailAgent) continue;
      detailAgent.hasAttendance = true;
      if (record.status === 'PRESENT') detailAgent.attendanceDays += 1;
      if (record.status === 'HALFDAY') detailAgent.attendanceDays += 0.5;
    }

    const metrics = [...agentMap.values()]
      .map((agent) => {
        const tasksCompleted = agent.hasImportedTaskMetric
          ? agent.importedTasks
          : agent.hasDetailTaskMetric
            ? agent.detailTasks
            : null;
        const daysWorked = agent.hasAttendance
          ? agent.attendanceDays
          : agent.workedDates.size > 0
            ? agent.workedDates.size
            : null;
        const importedAchievement = average([...agent.importedAchievements.values()]);
        const detailAchievement = average(agent.detailAchievements);
        const efficiency = importedAchievement ?? detailAchievement ??
          (tasksCompleted != null && daysWorked != null && daysWorked > 0
            ? Math.min(100, (tasksCompleted / daysWorked / 20) * 100)
            : null);
        const counts = agent.hasImportedTaskMetric ? agent.importedCounts : agent.detailCounts;
        const canDeriveQuality = agent.hasImportedTaskMetric
          ? agent.importedCountKinds.has('approvals') && agent.importedCountKinds.has('transmittals')
          : agent.hasDetailTaskMetric;
        const derivedQuality = canDeriveQuality
          ? percent(counts.approvals, counts.transmittals)
          : null;
        const quality = average(agent.qualityScores) ?? derivedQuality;
        const avgTaskTime = tasksCompleted != null && tasksCompleted > 0 && daysWorked != null
          ? (daysWorked * 480) / tasksCompleted
          : null;

        return {
          agentId: agent.agentId,
          agentName: agent.agentName,
          campaignId: agent.campaignId,
          campaignName: agent.campaignName,
          seatNumber: agent.seatNumber,
          tasksCompleted: round(tasksCompleted, 0),
          avgTaskTime: round(avgTaskTime, 2),
          efficiencyScore: round(efficiency),
          qualityScore: round(quality),
          conversionScore: round(percent(counts.booked, counts.transmittals)),
          daysWorked: round(daysWorked, 1),
          overtimeHours: null,
          dataSource: [...agent.sources].join(' + '),
        };
      })
      .sort((a, b) =>
        (b.efficiencyScore ?? -Infinity) - (a.efficiencyScore ?? -Infinity) ||
        (b.tasksCompleted ?? -Infinity) - (a.tasksCompleted ?? -Infinity) ||
        a.agentName.localeCompare(b.agentName)
      );

    const efficiencyValues = metrics.flatMap((metric) =>
      metric.efficiencyScore == null ? [] : [metric.efficiencyScore]
    );
    const qualityValues = metrics.flatMap((metric) =>
      metric.qualityScore == null ? [] : [metric.qualityScore]
    );
    const taskValues = metrics.flatMap((metric) =>
      metric.tasksCompleted == null ? [] : [metric.tasksCompleted]
    );

    const summary = {
      avgEfficiency: round(average(efficiencyValues)),
      avgQuality: round(average(qualityValues)),
      avgTasksPerAgent: round(average(taskValues)),
      topPerformer: metrics.find((metric) => metric.efficiencyScore != null) ?? metrics[0] ?? null,
      totalAgents: metrics.length,
    };

    return NextResponse.json({ metrics, summary });
  } catch (error) {
    console.error('Productivity API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
