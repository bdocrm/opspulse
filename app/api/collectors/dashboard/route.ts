import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAssignedCampaignIds } from "@/lib/user-campaigns";
import { ensureCampaignGoalTable } from "@/lib/campaign-goals";
import {
  calculateCampaignAchievement,
  summarizeCampaignAchievements,
} from "@/lib/campaign-achievement";
import {
  BDO_CCC_CAMPAIGN_PATTERN,
  highestBdoCccAchievementPercent,
} from "@/lib/bdo-ccc-kpi";

const BUSINESS_TIME_ZONE = "Asia/Manila";
const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

function businessDayRange(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${to}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function businessMonthRange(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(toYear, toMonth, 0)).getUTCDate();
  return {
    start: new Date(
      `${fromYear}-${String(fromMonth).padStart(2, "0")}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`
    ),
    end: new Date(
      `${toYear}-${String(toMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`
    ),
  };
}

function businessMonthKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function businessDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function monthYearFromYmd(value: string) {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return { month, year };
  }

  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function normalizeImportedAgentName(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function importedAgentId(campaignId: string, name: string) {
  return `imported:${campaignId}:${Buffer.from(normalizeImportedAgentName(name)).toString("base64url")}`;
}

function isImportedClassificationRow(record: {
  worksheetSource: string;
  monitoringType: string | null;
  entityName: string;
}) {
  return record.worksheetSource === "PL YTD Productivity" &&
    record.monitoringType === "PL_PRODUCTIVITY" &&
    /^(?:OLD|SEMI OLD|NEW|(?:OLD|SEMI OLD|NEW|TOTAL) AVERAGE PER AGENT)$/.test(normalizeImportedAgentName(record.entityName));
}

/**
 * Aggregate Collector Dashboard data, grouped by the logged-in collector's
 * assigned campaigns.
 *
 * Returns one block per assigned campaign (alphabetical) with its agents,
 * per-agent production for the date range, and attendance for `attendanceDate`.
 * Doing it in a handful of `in: [...]` queries (instead of one round-trip per
 * campaign) avoids N+1 and keeps the dashboard fast even with many campaigns.
 *
 * Only campaigns the collector is actually assigned to are returned, so the UI
 * can render the full response without further filtering.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = session.user as any;
    if (user.role !== "COLLECTOR") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const attendanceDate = searchParams.get("attendanceDate") || dateTo;
    const requestedCampaignId = searchParams.get("campaignId");

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: "Date range required" }, { status: 400 });
    }

    const { start: startDate, end: endDate } = businessDayRange(dateFrom, dateTo);
    const { start: importedMonthStart, end: importedMonthEnd } = businessMonthRange(dateFrom, dateTo);
    const selectedStartPeriod = monthYearFromYmd(dateFrom);
    const selectedEndPeriod = monthYearFromYmd(dateTo);
    const selectedStartPeriodIndex = selectedStartPeriod.year * 12 + selectedStartPeriod.month;
    const selectedEndPeriodIndex = selectedEndPeriod.year * 12 + selectedEndPeriod.month;
    const isImportedRecordInSelectedRange = (record: { year: number; month: number | null; reportDate: Date }) => {
      if (record.month != null) {
        const periodIndex = record.year * 12 + record.month;
        return periodIndex >= selectedStartPeriodIndex && periodIndex <= selectedEndPeriodIndex;
      }
      return record.reportDate >= startDate && record.reportDate <= endDate;
    };
    const { month: goalMonth, year: goalYear } = monthYearFromYmd(dateTo);

    // Resolve the collector's assigned campaigns (join table + legacy primary).
    const authorizedCampaignIds = await getAssignedCampaignIds(user.id);
    if (
      requestedCampaignId &&
      requestedCampaignId !== "all" &&
      !authorizedCampaignIds.includes(requestedCampaignId)
    ) {
      return NextResponse.json(
        { error: "Campaign is not assigned to this collector" },
        { status: 403 }
      );
    }
    const assignedIds =
      requestedCampaignId && requestedCampaignId !== "all"
        ? [requestedCampaignId]
        : authorizedCampaignIds;
    if (assignedIds.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    await ensureCampaignGoalTable();

    // Pull everything in a few batched queries scoped to the assigned set.
    const [campaigns, agents, rawDetails, rawEntries, monthlyGoalRows, dashboardAgentRecords, rawMetricRecords, rawKpiRecords] = await Promise.all([
      prisma.campaign.findMany({
        where: { id: { in: assignedIds } },
        select: {
          id: true,
          campaignName: true,
          kpiMetric: true,
          monthlyGoal: true,
          supplementaryGoal: true,
        },
        orderBy: { campaignName: "asc" }, // alphabetical grouping
      }),
      prisma.user.findMany({
        where: { campaignId: { in: assignedIds }, role: "AGENT" },
        select: {
          id: true,
          name: true,
          email: true,
          seatNumber: true,
          monthlyTarget: true,
          monthlyTargetSupplementary: true,
          mbLevel: true,
          disbursedTxnTarget: true,
          disbursedVolTarget: true,
          grossTurnInsTxnTarget: true,
          grossTurnInsVolTarget: true,
          campaignId: true,
        },
        orderBy: [{ seatNumber: "asc" }, { name: "asc" }],
      }),
      prisma.productionDetail.findMany({
        where: {
          campaignId: { in: assignedIds },
          productionEntry: {
            OR: [
              { date: { gte: startDate, lte: endDate } },
              {
                importFileName: { not: null },
                reportPeriodType: "monthly",
                date: { gte: importedMonthStart, lte: importedMonthEnd },
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
          ntb: true,
          supplementary: true,
          cardLevel: true,
          cardLevelLabel: true,
          cardLevelGrandTotal: true,
          sourceNickname: true,
          cardLevelFinalTotal: true,
          cardLevelRanking: true,
          bauPayrollTxn: true,
          bauPayrollVol: true,
          bauDepositorTxn: true,
          bauDepositorVol: true,
          topupPayrollTxn: true,
          topupPayrollVol: true,
          topupDepositorTxn: true,
          topupDepositorVol: true,
          openMarketTxn: true,
          openMarketVol: true,
          c2gTxn: true,
          c2gVol: true,
          btTxn: true,
          btVol: true,
          balconTxn: true,
          balconVol: true,
          grandTotalTxn: true,
          grandTotalVol: true,
          agentLevel: true,
          monthlyGoal: true,
          monthlyActual: true,
          monthlyAchievement: true,
          productionEntry: {
            select: {
              id: true,
              date: true,
              createdAt: true,
              importFileName: true,
              reportPeriodType: true,
            },
          },
        },
      }),
      prisma.productionEntry.findMany({
        where: {
          campaignId: { in: assignedIds },
          OR: [
            { date: { gte: startDate, lte: endDate } },
            {
              importFileName: { not: null },
              reportPeriodType: "monthly",
              date: { gte: importedMonthStart, lte: importedMonthEnd },
            },
          ],
        },
        select: {
          id: true,
          campaignId: true,
          date: true,
          createdAt: true,
          importFileName: true,
          reportPeriodType: true,
        },
      }),
      prisma.$queryRaw<any[]>`
        SELECT "campaignId", "month", "year", "monthlyGoal", "supplementaryGoal", "kpiMetric"
        FROM "CampaignGoal"
        WHERE "campaignId" = ANY(${assignedIds}::text[])
          AND "deletedAt" IS NULL
      `,
      prisma.dashboardImportRecord.findMany({
        where: {
          campaignId: { in: assignedIds },
          recordKind: { in: ["agent_monitoring", "ytd"] },
        },
        select: {
          campaignId: true,
          recordKind: true,
          worksheetSource: true,
          entityName: true,
          level: true,
          monitoringType: true,
          category: true,
          product: true,
          metric: true,
          year: true,
          month: true,
          reportDate: true,
          target: true,
          actual: true,
          achievement: true,
          updatedAt: true,
        },
        orderBy: [{ reportDate: "asc" }, { sourceRow: "asc" }],
      }).catch(() => []),
      prisma.productionMetricRecord.findMany({
        where: {
          campaignId: { in: assignedIds },
          reportYear: { gte: selectedStartPeriod.year, lte: selectedEndPeriod.year },
          OR: [
            { goal: { not: null } },
            { metricType: { in: ["transactions", "volume", "transactions_score", "volume_score", "overall"] } },
          ],
        },
        select: {
          campaignId: true,
          agentId: true,
          reportYear: true,
          reportMonth: true,
          metricType: true,
          count: true,
          volume: true,
          goal: true,
          actual: true,
          achievement: true,
          sourceFile: true,
          createdAt: true,
        },
      }).catch(() => []),
      prisma.collectorKpiRecord.findMany({
        where: { campaignId: { in: assignedIds } },
        select: {
          campaignId: true,
          employeeId: true,
          employeeNameSnapshot: true,
          month: true,
          year: true,
          achievementQa: true,
          achievementAht: true,
          achievementAdherence: true,
          achievementCm: true,
          achievementCd: true,
          updatedAt: true,
        },
        orderBy: [{ year: "asc" }, { month: "asc" }, { sourceRow: "asc" }],
      }).catch(() => []),
    ]);

    const importedFallbackPeriodByCampaign = new Map<string, { year: number; month: number }>();
    const importedAgentFallbackPeriodByCampaign = new Map<string, { year: number; month: number }>();
    const bdoCccCampaignIds = new Set(
      campaigns
        .filter((campaign) => BDO_CCC_CAMPAIGN_PATTERN.test(campaign.campaignName.trim()))
        .map((campaign) => campaign.id)
    );
    const bdoCccKpiFallbackPeriodByCampaign = new Map<string, { year: number; month: number }>();
    const selectedBdoCccKpiRecords = rawKpiRecords.filter((record) => {
      if (!bdoCccCampaignIds.has(record.campaignId)) return false;
      const periodIndex = record.year * 12 + record.month;
      return periodIndex >= selectedStartPeriodIndex && periodIndex <= selectedEndPeriodIndex;
    });
    const bdoCccKpiRecords = [...selectedBdoCccKpiRecords];
    for (const campaignId of bdoCccCampaignIds) {
      if (selectedBdoCccKpiRecords.some((record) => record.campaignId === campaignId)) continue;
      const latest = rawKpiRecords
        .filter((record) => record.campaignId === campaignId)
        .sort((left, right) => right.year - left.year || right.month - left.month)[0];
      if (!latest) continue;
      bdoCccKpiRecords.push(...rawKpiRecords.filter((record) =>
        record.campaignId === campaignId &&
        record.year === latest.year &&
        record.month === latest.month
      ));
      bdoCccKpiFallbackPeriodByCampaign.set(campaignId, {
        year: latest.year,
        month: latest.month,
      });
    }
    const bdoSgmCampaignIds = campaigns
      .filter((campaign) => /^BDO\s+SGM$/i.test(campaign.campaignName.trim()))
      .map((campaign) => campaign.id);
    const selectedDetailCampaignIds = new Set(rawDetails.map((detail) => detail.campaignId));
    const fallbackCampaignIds = bdoSgmCampaignIds.filter((campaignId) => !selectedDetailCampaignIds.has(campaignId));

    // BDO SGM ranking workbooks contain monthly data. When a daily range such
    // as "Today" has no matching rows, use the campaign's latest imported
    // month and label the response accordingly instead of displaying zero.
    if (fallbackCampaignIds.length > 0) {
      const importedEntries = await prisma.productionEntry.findMany({
        where: {
          campaignId: { in: fallbackCampaignIds },
          importFileName: { not: null },
          reportPeriodType: "monthly",
        },
        select: {
          id: true,
          campaignId: true,
          date: true,
          createdAt: true,
          importFileName: true,
          reportPeriodType: true,
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      });
      const latestMonthByCampaign = new Map<string, string>();
      for (const entry of importedEntries) {
        if (!latestMonthByCampaign.has(entry.campaignId)) {
          latestMonthByCampaign.set(entry.campaignId, businessMonthKey(entry.date));
        }
      }
      const fallbackEntries = importedEntries.filter(
        (entry) => businessMonthKey(entry.date) === latestMonthByCampaign.get(entry.campaignId)
      );
      if (fallbackEntries.length > 0) {
        const fallbackDetails = await prisma.productionDetail.findMany({
          where: { productionEntryId: { in: fallbackEntries.map((entry) => entry.id) } },
          select: {
            agentId: true,
            campaignId: true,
            transmittals: true,
            activations: true,
            approvals: true,
            booked: true,
            volume: true,
            ntb: true,
            supplementary: true,
            cardLevel: true,
            cardLevelLabel: true,
            cardLevelGrandTotal: true,
            sourceNickname: true,
            cardLevelFinalTotal: true,
            cardLevelRanking: true,
            bauPayrollTxn: true,
            bauPayrollVol: true,
            bauDepositorTxn: true,
            bauDepositorVol: true,
            topupPayrollTxn: true,
            topupPayrollVol: true,
            topupDepositorTxn: true,
            topupDepositorVol: true,
            openMarketTxn: true,
            openMarketVol: true,
            c2gTxn: true,
            c2gVol: true,
            btTxn: true,
            btVol: true,
            balconTxn: true,
            balconVol: true,
            grandTotalTxn: true,
            grandTotalVol: true,
            agentLevel: true,
            monthlyGoal: true,
            monthlyActual: true,
            monthlyAchievement: true,
            productionEntry: {
              select: {
                id: true,
                date: true,
                createdAt: true,
                importFileName: true,
                reportPeriodType: true,
              },
            },
          },
        });
        rawDetails.push(...fallbackDetails);
        rawEntries.push(...fallbackEntries);
        for (const [campaignId, period] of latestMonthByCampaign) {
          const [year, month] = period.split("-").map(Number);
          importedFallbackPeriodByCampaign.set(campaignId, { year, month });
          importedAgentFallbackPeriodByCampaign.set(campaignId, { year, month });
        }
      }
    }

    const bdoSgmYearDetails = bdoSgmCampaignIds.length > 0
      ? await prisma.productionDetail.findMany({
          where: {
            campaignId: { in: bdoSgmCampaignIds },
            productionEntry: {
              importFileName: { not: null },
              date: {
                gte: new Date(selectedEndPeriod.year, 0, 1),
                lte: new Date(selectedEndPeriod.year, 11, 31, 23, 59, 59, 999),
              },
            },
          },
          select: {
            agentId: true,
            campaignId: true,
            cardLevel: true,
            cardLevelGrandTotal: true,
            sourceNickname: true,
            cardLevelRanking: true,
          },
        })
      : [];

    const usableDashboardAgentRecords = dashboardAgentRecords.filter(
      (record) => !isImportedClassificationRow(record)
    );
    const importedActual = (record: (typeof dashboardAgentRecords)[number]) => {
      if (record.actual != null) return Number(record.actual);
      if (record.target != null && record.achievement != null) return Math.round(Number(record.target) * Number(record.achievement));
      return null;
    };
    const dashboardAgentImportPeriodKeys = new Set(
      usableDashboardAgentRecords
        .filter((record) => record.recordKind === "agent_monitoring" && importedActual(record) != null && record.month != null)
        .map((record) => `${record.campaignId}|${record.year}-${String(record.month).padStart(2, "0")}`)
    );
    const monthlyImportKeys = new Set(
      rawDetails
        .filter((detail) => detail.productionEntry.importFileName
          && detail.productionEntry.reportPeriodType === "monthly")
        .map((detail) => `${detail.campaignId}|${businessMonthKey(detail.productionEntry.date)}`)
    );
    const details = rawDetails.filter((detail) => {
      const isMonthlyImport = Boolean(detail.productionEntry.importFileName)
        && detail.productionEntry.reportPeriodType === "monthly";
      const key = `${detail.campaignId}|${businessMonthKey(detail.productionEntry.date)}`;
      return !dashboardAgentImportPeriodKeys.has(key) && (isMonthlyImport || !monthlyImportKeys.has(key));
    });
    const entries = rawEntries.filter((entry) => {
      const isMonthlyImport = Boolean(entry.importFileName) && entry.reportPeriodType === "monthly";
      const key = `${entry.campaignId}|${businessMonthKey(entry.date)}`;
      return !dashboardAgentImportPeriodKeys.has(key) && (isMonthlyImport || !monthlyImportKeys.has(key));
    });
    const monthlyGoalsByCampaignId = new Map(
      monthlyGoalRows
        .filter((row) => Number(row.month) === goalMonth && Number(row.year) === goalYear)
        .map((row) => [row.campaignId, row])
    );
    const monthlyGoalsByCampaignPeriod = new Map(
      monthlyGoalRows.map((row) => [`${row.campaignId}|${row.year}|${row.month}`, row])
    );

    // Attendance is optional (table may not exist on older DBs).
    let attendanceRows: any[] = [];
    if (attendanceDate) {
      const { start: attStart, end: attEnd } = businessDayRange(attendanceDate, attendanceDate);
      try {
        attendanceRows = await prisma.attendance.findMany({
          where: {
            campaignId: { in: assignedIds },
            date: { gte: attStart, lte: attEnd },
          },
          select: { agentId: true, campaignId: true, status: true, remarks: true },
        });
      } catch {
        attendanceRows = [];
      }
    }

    // ── Index everything by campaign id (single pass each) ──────────────────
    const agentsByCampaign = new Map<string, typeof agents>();
    for (const a of agents) {
      const list = agentsByCampaign.get(a.campaignId!) ?? [];
      list.push(a);
      agentsByCampaign.set(a.campaignId!, list);
    }

    const actualAgentIdByCampaignAndName = new Map(
      agents.map((agent) => [`${agent.campaignId}|${normalizeImportedAgentName(agent.name)}`, agent.id])
    );
    const importedRosterByCampaign = new Map<string, Array<{
      id: string;
      name: string;
      email: string;
      seatNumber: null;
      monthlyTarget: null;
      monthlyTargetSupplementary: null;
      mbLevel: string | null;
      disbursedTxnTarget: null;
      disbursedVolTarget: null;
      grossTurnInsTxnTarget: null;
      grossTurnInsVolTarget: null;
      campaignId: string;
      importedOnly: true;
    }>>();
    const importedRosterSeen = new Set<string>();
    for (const record of usableDashboardAgentRecords) {
      if (record.recordKind !== "agent_monitoring") continue;
      const normalizedName = normalizeImportedAgentName(record.entityName);
      if (!normalizedName) continue;
      const identity = `${record.campaignId}|${normalizedName}`;
      if (actualAgentIdByCampaignAndName.has(identity) || importedRosterSeen.has(identity)) continue;
      importedRosterSeen.add(identity);
      const list = importedRosterByCampaign.get(record.campaignId) ?? [];
      list.push({
        id: importedAgentId(record.campaignId, record.entityName),
        name: record.entityName,
        email: "",
        seatNumber: null,
        monthlyTarget: null,
        monthlyTargetSupplementary: null,
        mbLevel: record.level || null,
        disbursedTxnTarget: null,
        disbursedVolTarget: null,
        grossTurnInsTxnTarget: null,
        grossTurnInsVolTarget: null,
        campaignId: record.campaignId,
        importedOnly: true,
      });
      importedRosterByCampaign.set(record.campaignId, list);
    }
    for (const record of bdoCccKpiRecords) {
      const normalizedName = normalizeImportedAgentName(record.employeeNameSnapshot);
      if (!normalizedName) continue;
      const identity = `${record.campaignId}|${normalizedName}`;
      if (actualAgentIdByCampaignAndName.has(identity) || importedRosterSeen.has(identity)) continue;
      importedRosterSeen.add(identity);
      const list = importedRosterByCampaign.get(record.campaignId) ?? [];
      list.push({
        id: record.employeeId,
        name: record.employeeNameSnapshot,
        email: "",
        seatNumber: null,
        monthlyTarget: null,
        monthlyTargetSupplementary: null,
        mbLevel: null,
        disbursedTxnTarget: null,
        disbursedVolTarget: null,
        grossTurnInsTxnTarget: null,
        grossTurnInsVolTarget: null,
        campaignId: record.campaignId,
        importedOnly: true,
      });
      importedRosterByCampaign.set(record.campaignId, list);
    }

    const campaignsWithMonthlyProductionImport = new Set(
      details
        .filter((detail) => detail.productionEntry.importFileName
          && detail.productionEntry.reportPeriodType === "monthly")
        .map((detail) => detail.campaignId)
    );
    const campaignNameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.campaignName]));
    const mbPaCampaignIds = new Set(campaigns.filter((campaign) => /\bMB\s*PA\b/i.test(campaign.campaignName)).map((campaign) => campaign.id));
    const mbPlCampaignIds = new Set(campaigns.filter((campaign) => /\bMB\s*PL\b/i.test(campaign.campaignName)).map((campaign) => campaign.id));
    const importedMetricGoalsByCampaign = new Map<string, Record<string, Record<string, number>>>();
    const importedSummaryByCampaignPeriod = new Map<string, { goal: number; actual: number }>();
    for (const metric of rawMetricRecords) {
      if (!metric.sourceFile || metric.reportMonth == null) continue;
      const periodIndex = metric.reportYear * 12 + metric.reportMonth;
      if (periodIndex < selectedStartPeriodIndex || periodIndex > selectedEndPeriodIndex) continue;
      if (metric.goal != null) {
        const byAgent = importedMetricGoalsByCampaign.get(metric.campaignId) ?? {};
        const goals = byAgent[metric.agentId] ?? {};
        goals[metric.metricType] = (goals[metric.metricType] ?? 0) + Number(metric.goal);
        byAgent[metric.agentId] = goals;
        importedMetricGoalsByCampaign.set(metric.campaignId, byAgent);
      }
      if (metric.metricType === "actual" && metric.actual != null) {
        const key = `${metric.campaignId}|${metric.reportYear}|${metric.reportMonth}`;
        const current = importedSummaryByCampaignPeriod.get(key) ?? { goal: 0, actual: 0 };
        current.actual += Number(metric.actual);
        // A campaign/team goal repeated on several production rows is one
        // period goal, never one goal per transaction or collector.
        current.goal = Math.max(current.goal, Number(metric.goal ?? 0));
        importedSummaryByCampaignPeriod.set(key, current);
      }
    }
    const importedSummaryGoalByCampaign = new Map<string, number>();
    const importedSummaryActualByCampaign = new Map<string, number>();
    for (const [key, summary] of importedSummaryByCampaignPeriod) {
      const campaignId = key.split("|")[0];
      importedSummaryGoalByCampaign.set(
        campaignId,
        (importedSummaryGoalByCampaign.get(campaignId) ?? 0) + summary.goal
      );
      importedSummaryActualByCampaign.set(
        campaignId,
        (importedSummaryActualByCampaign.get(campaignId) ?? 0) + summary.actual
      );
    }
    for (const record of usableDashboardAgentRecords) {
      if (record.recordKind !== "ytd") continue;
      const summaryName = `${campaignNameById.get(record.campaignId) || "Campaign"} Total`;
      const identity = `${record.campaignId}|${normalizeImportedAgentName(summaryName)}`;
      if (importedRosterSeen.has(identity)) continue;
      importedRosterSeen.add(identity);
      const list = importedRosterByCampaign.get(record.campaignId) ?? [];
      list.push({
        id: importedAgentId(record.campaignId, summaryName), name: summaryName, email: "", seatNumber: null,
        monthlyTarget: null, monthlyTargetSupplementary: null, mbLevel: null,
        disbursedTxnTarget: null, disbursedVolTarget: null, grossTurnInsTxnTarget: null, grossTurnInsVolTarget: null,
        campaignId: record.campaignId, importedOnly: true,
      });
      importedRosterByCampaign.set(record.campaignId, list);
    }

    // Per-category MB PL fields aggregated alongside the standard metrics.
    const CATEGORY_KEYS = [
      'bauPayrollTxn', 'bauPayrollVol', 'bauDepositorTxn', 'bauDepositorVol',
      'topupPayrollTxn', 'topupPayrollVol', 'topupDepositorTxn', 'topupDepositorVol',
      'openMarketTxn', 'openMarketVol',
      'c2gTxn', 'c2gVol', 'btTxn', 'btVol', 'balconTxn', 'balconVol', 'grandTotalTxn', 'grandTotalVol',
    ] as const;

    const emptyProduction = () => ({
      transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0,
      firstCardTransmittals: 0, bundleCardTransmittals: 0,
      firstCardFinalTotal: 0, bundleCardFinalTotal: 0,
      firstCardWholeYearTotal: 0, bundleCardWholeYearTotal: 0,
      sourceNickname: '', cardLevelRanking: null as number | null,
      transmittedVolume: 0, approvalsVolume: 0, bookedVolume: 0,
      bauPayrollTxn: 0, bauPayrollVol: 0, bauDepositorTxn: 0, bauDepositorVol: 0,
      topupPayrollTxn: 0, topupPayrollVol: 0, topupDepositorTxn: 0, topupDepositorVol: 0,
      openMarketTxn: 0, openMarketVol: 0,
      c2gTxn: 0, c2gVol: 0, btTxn: 0, btVol: 0, balconTxn: 0, balconVol: 0, grandTotalTxn: 0, grandTotalVol: 0,
    });

    const prodByCampaign = new Map<string, Record<string, Record<string, any>>>();
    for (const d of details) {
      const byAgent = prodByCampaign.get(d.campaignId) ?? {};
      const cur = byAgent[d.agentId] ?? emptyProduction();
      cur.transmittals += Number(d.transmittals);
      const cardFinalTotal = Number(d.cardLevelFinalTotal ?? d.transmittals);
      const cardWholeYearTotal = Number(d.cardLevelGrandTotal ?? cardFinalTotal);
      if (d.cardLevel === "FIRST_CARD") {
        cur.firstCardTransmittals += Number(d.transmittals);
        cur.firstCardFinalTotal += cardFinalTotal;
        cur.firstCardWholeYearTotal = Math.max(cur.firstCardWholeYearTotal, cardWholeYearTotal);
      }
      if (d.cardLevel === "BUNDLE_CARD") {
        cur.bundleCardTransmittals += Number(d.transmittals);
        cur.bundleCardFinalTotal += cardFinalTotal;
        cur.bundleCardWholeYearTotal = Math.max(cur.bundleCardWholeYearTotal, cardWholeYearTotal);
      }
      if (d.sourceNickname && !cur.sourceNickname) cur.sourceNickname = d.sourceNickname;
      if (d.cardLevelRanking != null) {
        cur.cardLevelRanking = cur.cardLevelRanking == null
          ? d.cardLevelRanking
          : Math.min(cur.cardLevelRanking, d.cardLevelRanking);
      }
      cur.activations += Number(d.activations);
      cur.approvals += Number(d.approvals);
      cur.booked += Number(d.booked);
      cur.volume += Number(d.volume);
      cur.ntb += Number(d.ntb);
      cur.supplementary += Number(d.supplementary);
      for (const k of CATEGORY_KEYS) cur[k] += Number((d as any)[k] ?? 0);
      byAgent[d.agentId] = cur;
      prodByCampaign.set(d.campaignId, byAgent);
    }
    const bdoCccActualByCampaign = new Map<string, number>();
    const bdoCccPerformanceByCampaign = new Map<
      string,
      Record<string, { actual: number; achievement: number }>
    >();
    for (const record of bdoCccKpiRecords) {
      const percentage = highestBdoCccAchievementPercent(record);
      if (percentage == null) continue;
      const byAgent = prodByCampaign.get(record.campaignId) ?? {};
      const cur = byAgent[record.employeeId] ?? emptyProduction();
      // Multiple months can be in range. BDO CCC explicitly uses the highest
      // imported ACVT percentage, so never add monthly percentages together.
      cur.transmittals = Math.max(Number(cur.transmittals || 0), percentage);
      byAgent[record.employeeId] = cur;
      prodByCampaign.set(record.campaignId, byAgent);

      const performance = bdoCccPerformanceByCampaign.get(record.campaignId) ?? {};
      const existing = performance[record.employeeId];
      if (!existing || percentage > existing.actual) {
        performance[record.employeeId] = { actual: percentage, achievement: 0 };
      }
      bdoCccPerformanceByCampaign.set(record.campaignId, performance);
      bdoCccActualByCampaign.set(
        record.campaignId,
        Math.max(bdoCccActualByCampaign.get(record.campaignId) ?? 0, percentage)
      );
    }
    // Whole-year totals and source identity are annual metadata. Merge them
    // independently of the active month so an agent with a blank latest month
    // is still included in the annual campaign totals.
    for (const d of bdoSgmYearDetails) {
      const byAgent = prodByCampaign.get(d.campaignId) ?? {};
      const cur = byAgent[d.agentId] ?? emptyProduction();
      const wholeYearTotal = Number(d.cardLevelGrandTotal ?? 0);
      if (d.cardLevel === "FIRST_CARD") {
        cur.firstCardWholeYearTotal = Math.max(cur.firstCardWholeYearTotal, wholeYearTotal);
      }
      if (d.cardLevel === "BUNDLE_CARD") {
        cur.bundleCardWholeYearTotal = Math.max(cur.bundleCardWholeYearTotal, wholeYearTotal);
      }
      if (d.sourceNickname && !cur.sourceNickname) cur.sourceNickname = d.sourceNickname;
      if (d.cardLevelRanking != null) {
        cur.cardLevelRanking = cur.cardLevelRanking == null
          ? d.cardLevelRanking
          : Math.min(cur.cardLevelRanking, d.cardLevelRanking);
      }
      byAgent[d.agentId] = cur;
      prodByCampaign.set(d.campaignId, byAgent);
    }

    // MB PL's annual Goal/Achievement workbook stores separate Transactions
    // and Volume values under TARGET, ACTUAL, %, and SCORE, plus the weighted
    // ACHIEVEMENT. ProductionMetricRecord preserves those exact cells.
    type MbPlPerformanceAccumulator = {
      transactionGoal: number;
      transactionActual: number;
      volumeGoal: number;
      volumeActual: number;
      transactionAchievementTotal: number;
      transactionAchievementCount: number;
      volumeAchievementTotal: number;
      volumeAchievementCount: number;
      transactionScoreTotal: number;
      transactionScoreCount: number;
      volumeScoreTotal: number;
      volumeScoreCount: number;
      achievementTotal: number;
      achievementCount: number;
    };
    const emptyMbPlPerformance = (): MbPlPerformanceAccumulator => ({
      transactionGoal: 0,
      transactionActual: 0,
      volumeGoal: 0,
      volumeActual: 0,
      transactionAchievementTotal: 0,
      transactionAchievementCount: 0,
      volumeAchievementTotal: 0,
      volumeAchievementCount: 0,
      transactionScoreTotal: 0,
      transactionScoreCount: 0,
      volumeScoreTotal: 0,
      volumeScoreCount: 0,
      achievementTotal: 0,
      achievementCount: 0,
    });
    const mbPlPerformanceByCampaign = new Map<string, Record<string, MbPlPerformanceAccumulator>>();

    for (const metric of rawMetricRecords) {
      if (!mbPlCampaignIds.has(metric.campaignId) || !metric.sourceFile) continue;
      if (metric.reportMonth == null) continue;
      const periodIndex = metric.reportYear * 12 + metric.reportMonth;
      if (periodIndex < selectedStartPeriodIndex || periodIndex > selectedEndPeriodIndex) continue;

      const byAgent = mbPlPerformanceByCampaign.get(metric.campaignId) ?? {};
      const performance = byAgent[metric.agentId] ?? emptyMbPlPerformance();
      if (metric.metricType === "transactions") {
        performance.transactionGoal += Number(metric.goal ?? 0);
        performance.transactionActual += Number(metric.actual ?? metric.count ?? 0);
        if (metric.achievement != null) {
          performance.transactionAchievementTotal += Number(metric.achievement);
          performance.transactionAchievementCount++;
        }
      } else if (metric.metricType === "volume") {
        performance.volumeGoal += Number(metric.goal ?? 0);
        performance.volumeActual += Number(metric.actual ?? metric.volume ?? 0);
        if (metric.achievement != null) {
          performance.volumeAchievementTotal += Number(metric.achievement);
          performance.volumeAchievementCount++;
        }
      } else if (metric.metricType === "transactions_score" && metric.actual != null) {
        performance.transactionScoreTotal += Number(metric.actual);
        performance.transactionScoreCount++;
      } else if (metric.metricType === "volume_score" && metric.actual != null) {
        performance.volumeScoreTotal += Number(metric.actual);
        performance.volumeScoreCount++;
      } else if (metric.metricType === "overall" && metric.achievement != null) {
        performance.achievementTotal += Number(metric.achievement);
        performance.achievementCount++;
      }
      byAgent[metric.agentId] = performance;
      mbPlPerformanceByCampaign.set(metric.campaignId, byAgent);
    }
    const exactMbPlAgentKeys = new Set(
      [...mbPlPerformanceByCampaign.entries()].flatMap(([campaignId, byAgent]) =>
        Object.keys(byAgent).map((agentId) => `${campaignId}|${agentId}`)
      )
    );

    // Backward-compatible fallback for imports made before normalized MB PL
    // metrics were introduced. A re-import/backfill replaces this path.
    for (const detail of details) {
      if (!mbPlCampaignIds.has(detail.campaignId) || !detail.productionEntry.importFileName) continue;
      if (detail.monthlyGoal == null && detail.monthlyActual == null && detail.monthlyAchievement == null) continue;
      if (exactMbPlAgentKeys.has(`${detail.campaignId}|${detail.agentId}`)) continue;
      const byAgent = mbPlPerformanceByCampaign.get(detail.campaignId) ?? {};
      const performance = byAgent[detail.agentId] ?? emptyMbPlPerformance();
      performance.transactionGoal += Number(detail.monthlyGoal ?? 0);
      performance.transactionActual += Number(detail.monthlyActual ?? 0);
      if (detail.monthlyAchievement != null) {
        performance.achievementTotal += Number(detail.monthlyAchievement);
        performance.achievementCount++;
      }
      byAgent[detail.agentId] = performance;
      mbPlPerformanceByCampaign.set(detail.campaignId, byAgent);

      const production = prodByCampaign.get(detail.campaignId) ?? {};
      const current = production[detail.agentId] ?? emptyProduction();
      current.importedGoal = performance.transactionGoal;
      current.importedActual = performance.transactionActual;
      current.importedAchievement = performance.achievementCount > 0
        ? (performance.achievementTotal / performance.achievementCount) * 100
        : performance.transactionGoal > 0 ? (performance.transactionActual / performance.transactionGoal) * 100 : 0;
      production[detail.agentId] = current;
      prodByCampaign.set(detail.campaignId, production);
    }

    // MB PA progress is based on BILLINGS / the exact imported TARGET, while
    // its table ranking is based on GRAND TOTAL transactions. Blank target
    // cells remain blank/zero; never manufacture later-month goals by carrying
    // an earlier target or falling back to a manually configured user target.
    const mbPaTargetByAgent = new Map<string, number>();
    const mbPaGoalByCampaign = new Map<string, number>();
    const mbPaActualByCampaign = new Map<string, number>();
    const mbPaRowsByAgent = new Map<string, typeof details>();
    for (const detail of details) {
      if (!mbPaCampaignIds.has(detail.campaignId)) continue;
      const key = `${detail.campaignId}|${detail.agentId}`;
      const rows = mbPaRowsByAgent.get(key) ?? [];
      rows.push(detail);
      mbPaRowsByAgent.set(key, rows);
    }
    for (const rows of mbPaRowsByAgent.values()) {
      rows.sort((a, b) => a.productionEntry.date.getTime() - b.productionEntry.date.getTime());
      rows.forEach((detail) => {
        const target = Number(detail.monthlyGoal ?? 0);
        const categoryBilling = Number(detail.c2gVol || 0) + Number(detail.btVol || 0) + Number(detail.balconVol || 0);
        const actual = categoryBilling || Number(detail.grandTotalVol || 0) || Number(detail.monthlyActual ?? detail.volume ?? 0);
        mbPaTargetByAgent.set(detail.agentId, (mbPaTargetByAgent.get(detail.agentId) ?? 0) + target);
        mbPaGoalByCampaign.set(detail.campaignId, (mbPaGoalByCampaign.get(detail.campaignId) ?? 0) + target);
        mbPaActualByCampaign.set(detail.campaignId, (mbPaActualByCampaign.get(detail.campaignId) ?? 0) + actual);
      });
    }


    // BDO dashboard imports are stored separately from ProductionEntry/Detail.
    // Prefer the regular agent worksheet over its HOH mirror so the same agent,
    // month, and metric are never counted twice.
    const allPreferredDashboardRecords = new Map<string, (typeof dashboardAgentRecords)[number]>();
    for (const record of usableDashboardAgentRecords) {
      if (importedActual(record) == null && record.target == null) continue;
      const entityName = record.entityName || `${campaignNameById.get(record.campaignId) || "Campaign"} Total`;
      const normalizedName = normalizeImportedAgentName(entityName);
      const key = `${record.campaignId}|${normalizedName}|${record.year}|${record.month || 0}|${record.metric}`;
      const existing = allPreferredDashboardRecords.get(key);
      const priority = record.monitoringType?.endsWith("_AGENT") ? 2 : 1;
      const existingPriority = existing?.monitoringType?.endsWith("_AGENT") ? 2 : existing ? 1 : 0;
      if (priority > existingPriority) allPreferredDashboardRecords.set(key, record);
    }

    const preferredDashboardRecords = new Map<string, (typeof dashboardAgentRecords)[number]>();
    for (const [key, record] of allPreferredDashboardRecords) {
      if (isImportedRecordInSelectedRange(record)) {
        preferredDashboardRecords.set(key, record);
      }
    }

    // Keep dashboard imports inside the requested reporting period. Pulling a
    // campaign's latest record from another month made filters look populated
    // while displaying data that did not belong to the selected month/year.
    const preferredAgentDetailRecords = new Map(preferredDashboardRecords);
    const campaignsWithCashInstallment = new Set(
      usableDashboardAgentRecords.filter((record) => /cash installment/i.test(record.metric)).map((record) => record.campaignId)
    );
    const campaignsWithSelectedImportedAgentMonitoring = new Set(
      [...preferredAgentDetailRecords.values()]
        .filter((record) => record.recordKind === "agent_monitoring" && importedActual(record) != null)
        .map((record) => record.campaignId)
    );
    const campaignsWithBpiCurrencyTargets = new Set(
      usableDashboardAgentRecords
        .filter((record) => Number(record.target || 0) >= 1_000_000 && /^BPI\b/i.test(campaignNameById.get(record.campaignId) || ""))
        .map((record) => record.campaignId)
    );
    const campaignKpiById = new Map(campaigns.map((campaign) => [
      campaign.id,
      campaignsWithCashInstallment.has(campaign.id) || campaignsWithBpiCurrencyTargets.has(campaign.id) ? "volume" : campaign.kpiMetric || "booked",
    ]));
    const importedEntryKeysByCampaign = new Map<string, Set<string>>();
    const registerImportedReport = (record: (typeof dashboardAgentRecords)[number]) => {
      const reports = importedEntryKeysByCampaign.get(record.campaignId) ?? new Set<string>();
      reports.add(`${record.worksheetSource}|${record.recordKind}|${record.year}|${record.month || 0}`);
      importedEntryKeysByCampaign.set(record.campaignId, reports);
    };
    const importedGoalByCampaign = new Map<string, number>();
    const importedAgentGoalByCampaign = new Map<string, number>();
    const importedActualByCampaign = new Map<string, number>();
    const importedTargetByAgent = new Map<string, number>();
    const importedAgentPerformanceByCampaign = new Map<
      string,
      Record<string, { importedTarget: number; actual: number }>
    >();

    // YTD rows are campaign summaries from the workbook. Sum one target and
    // one derived/explicit actual per selected month; never multiply them by
    // the number of agents or mix their currency values with count KPIs.
    for (const record of preferredDashboardRecords.values()) {
      if (record.recordKind !== "ytd") continue;
      const target = Number(record.target || 0);
      const actual = importedActual(record);
      if (target === 0 && actual === 0) continue;
      if (target) importedGoalByCampaign.set(record.campaignId, (importedGoalByCampaign.get(record.campaignId) ?? 0) + target);
      if (actual != null) importedActualByCampaign.set(record.campaignId, (importedActualByCampaign.get(record.campaignId) ?? 0) + actual);
      registerImportedReport(record);
    }

    for (const record of preferredAgentDetailRecords.values()) {
      if (record.recordKind === "ytd") {
        // Keep one synthetic campaign-total row when the workbook has no
        // agent-level monitoring. Registered agents remain visible, but the
        // imported YTD total must not disappear from Production Entry.
        if (campaignsWithSelectedImportedAgentMonitoring.has(record.campaignId)) continue;
      }
      const entityName = record.entityName || `${campaignNameById.get(record.campaignId) || "Campaign"} Total`;
      const normalizedName = normalizeImportedAgentName(entityName);
      const agentId = actualAgentIdByCampaignAndName.get(`${record.campaignId}|${normalizedName}`) || importedAgentId(record.campaignId, entityName);
      const target = Number(record.target || 0);
      if (target) {
        importedTargetByAgent.set(agentId, (importedTargetByAgent.get(agentId) ?? 0) + target);
        if (record.recordKind === "agent_monitoring") {
          importedAgentGoalByCampaign.set(record.campaignId, (importedAgentGoalByCampaign.get(record.campaignId) ?? 0) + target);
        }
      }
      const effectiveActual = importedActual(record);
      if (effectiveActual == null) continue;
      if (record.recordKind === "agent_monitoring") {
        const byAgent = importedAgentPerformanceByCampaign.get(record.campaignId) ?? {};
        const performance = byAgent[agentId] ?? { importedTarget: 0, actual: 0 };
        performance.importedTarget += target;
        performance.actual += effectiveActual;
        byAgent[agentId] = performance;
        importedAgentPerformanceByCampaign.set(record.campaignId, byAgent);
      }
      const byAgent = prodByCampaign.get(record.campaignId) ?? {};
      const cur = byAgent[agentId] ?? emptyProduction();
      const actual = effectiveActual;
      const kpiMetric = campaignKpiById.get(record.campaignId);
      const importedMetric = record.metric.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (importedMetric === "transmitted count") {
        cur.transmittals += actual;
      } else if (importedMetric === "transmitted volume") {
        cur.transmittedVolume += actual;
      } else if (importedMetric === "approvals count") {
        cur.approvals += actual;
      } else if (importedMetric === "approvals volume") {
        cur.approvalsVolume += actual;
      } else if (importedMetric === "booked count") {
        cur.booked += actual;
      } else if (importedMetric === "booked volume") {
        cur.bookedVolume += actual;
        cur.volume += actual;
      } else if (kpiMetric === "volume") {
        cur.volume += actual;
      } else if (kpiMetric === "transmittals" || kpiMetric === "activations" || kpiMetric === "approvals" || kpiMetric === "booked") {
        cur[kpiMetric] += actual;
      }
      byAgent[agentId] = cur;
      prodByCampaign.set(record.campaignId, byAgent);
      if (record.recordKind !== "ytd") {
        registerImportedReport(record);
      }
    }

    const attByCampaign = new Map<
      string,
      Record<string, { status: string; remarks: string | null }>
    >();
    for (const r of attendanceRows) {
      const byAgent = attByCampaign.get(r.campaignId) ?? {};
      byAgent[r.agentId] = { status: r.status, remarks: r.remarks };
      attByCampaign.set(r.campaignId, byAgent);
    }

    const entryCountByCampaign = new Map<string, number>();
    for (const e of entries) {
      entryCountByCampaign.set(e.campaignId, (entryCountByCampaign.get(e.campaignId) ?? 0) + 1);
    }
    const detailCountByCampaign = new Map<string, number>();
    for (const detail of details) {
      detailCountByCampaign.set(
        detail.campaignId,
        (detailCountByCampaign.get(detail.campaignId) ?? 0) + 1
      );
    }
    const metricCountByCampaign = new Map<string, number>();
    for (const metric of rawMetricRecords) {
      if (!metric.sourceFile || metric.reportMonth == null) continue;
      const periodIndex = metric.reportYear * 12 + metric.reportMonth;
      if (
        periodIndex < selectedStartPeriodIndex ||
        periodIndex > selectedEndPeriodIndex
      ) {
        continue;
      }
      metricCountByCampaign.set(
        metric.campaignId,
        (metricCountByCampaign.get(metric.campaignId) ?? 0) + 1
      );
    }
    const dashboardRecordCountByCampaign = new Map<string, number>();
    for (const record of preferredAgentDetailRecords.values()) {
      dashboardRecordCountByCampaign.set(
        record.campaignId,
        (dashboardRecordCountByCampaign.get(record.campaignId) ?? 0) + 1
      );
    }
    const kpiRecordCountByCampaign = new Map<string, number>();
    const kpiPeriodCountByCampaign = new Map<string, Set<string>>();
    for (const record of bdoCccKpiRecords) {
      kpiRecordCountByCampaign.set(
        record.campaignId,
        (kpiRecordCountByCampaign.get(record.campaignId) ?? 0) + 1
      );
      const periods = kpiPeriodCountByCampaign.get(record.campaignId) ?? new Set<string>();
      periods.add(`${record.year}-${record.month}`);
      kpiPeriodCountByCampaign.set(record.campaignId, periods);
    }

    const sourceUpdateByCampaign = new Map<string, Date>();
    const registerSourceUpdate = (campaignId: string, timestamp: Date) => {
      const current = sourceUpdateByCampaign.get(campaignId);
      if (!current || timestamp > current) sourceUpdateByCampaign.set(campaignId, timestamp);
    };
    for (const entry of entries) registerSourceUpdate(entry.campaignId, entry.createdAt);
    for (const record of preferredAgentDetailRecords.values()) registerSourceUpdate(record.campaignId, record.updatedAt);
    for (const metric of rawMetricRecords) {
      if (metric.reportMonth == null) continue;
      const periodIndex = metric.reportYear * 12 + metric.reportMonth;
      if (periodIndex >= selectedStartPeriodIndex && periodIndex <= selectedEndPeriodIndex) {
        registerSourceUpdate(metric.campaignId, metric.createdAt);
      }
    }
    for (const record of bdoCccKpiRecords) {
      registerSourceUpdate(record.campaignId, record.updatedAt);
    }

    const activityByDate = new Map<string, number>();
    for (const entry of entries) {
      const key = businessDateKey(entry.date);
      activityByDate.set(key, (activityByDate.get(key) ?? 0) + 1);
    }
    const importedActivityKeys = new Set<string>();
    for (const record of preferredAgentDetailRecords.values()) {
      const identity = `${record.campaignId}|${record.worksheetSource}|${record.recordKind}|${record.year}|${record.month ?? businessDateKey(record.reportDate)}`;
      if (importedActivityKeys.has(identity)) continue;
      importedActivityKeys.add(identity);
      const key = businessDateKey(record.reportDate);
      activityByDate.set(key, (activityByDate.get(key) ?? 0) + 1);
    }
    for (const record of bdoCccKpiRecords) {
      const key = `${record.year}-${String(record.month).padStart(2, "0")}-01`;
      activityByDate.set(key, (activityByDate.get(key) ?? 0) + 1);
    }

    const result = campaigns.map((c) => {
      const savedGoal = monthlyGoalsByCampaignId.get(c.id);
      const isBdoCampaign = /^BDO\b/i.test(c.campaignName);
      const isAcqCampaign = /\bACQ\b/i.test(c.campaignName);
      const isMbPaCampaign = /\bMB\s*PA\b/i.test(c.campaignName);
      const isMbPlCampaign = /\bMB\s*PL\b/i.test(c.campaignName);
      const isBdoCccCampaign = BDO_CCC_CAMPAIGN_PATTERN.test(c.campaignName.trim());
      const production = prodByCampaign.get(c.id) ?? {};
      const normalizedGoalsByAgent = importedMetricGoalsByCampaign.get(c.id) ?? {};
      const rawMbPlPerformance = mbPlPerformanceByCampaign.get(c.id) ?? {};
      const mbPlPerformance = Object.fromEntries(Object.entries(rawMbPlPerformance).map(([agentId, performance]) => [
        agentId,
        {
          goal: performance.transactionGoal,
          actual: performance.transactionActual,
          transactionGoal: performance.transactionGoal,
          transactionActual: performance.transactionActual,
          volumeGoal: performance.volumeGoal,
          volumeActual: performance.volumeActual,
          transactionAchievement: performance.transactionAchievementCount > 0
            ? (performance.transactionAchievementTotal / performance.transactionAchievementCount) * 100
            : 0,
          volumeAchievement: performance.volumeAchievementCount > 0
            ? (performance.volumeAchievementTotal / performance.volumeAchievementCount) * 100
            : 0,
          transactionScore: performance.transactionScoreCount > 0
            ? (performance.transactionScoreTotal / performance.transactionScoreCount) * 100
            : 0,
          volumeScore: performance.volumeScoreCount > 0
            ? (performance.volumeScoreTotal / performance.volumeScoreCount) * 100
            : 0,
          achievement: performance.achievementCount > 0
            ? (performance.achievementTotal / performance.achievementCount) * 100
            : performance.transactionGoal > 0 ? (performance.transactionActual / performance.transactionGoal) * 100 : 0,
        },
      ]));
      const hasMbPlImport = Object.keys(mbPlPerformance).length > 0;
      if (hasMbPlImport) {
        for (const [agentId, performance] of Object.entries(mbPlPerformance)) {
          const current = production[agentId] ?? emptyProduction();
          current.importedGoal = performance.transactionGoal;
          current.importedActual = performance.transactionActual;
          current.importedAchievement = performance.achievement;
          production[agentId] = current;
        }
      }
      const mbPlImportedGoal = Object.values(mbPlPerformance).reduce((sum, performance) => sum + performance.transactionGoal, 0);
      const mbPlImportedActual = Object.values(mbPlPerformance).reduce((sum, performance) => sum + performance.transactionActual, 0);
      const mbPlImportedVolumeGoal = Object.values(mbPlPerformance).reduce((sum, performance) => sum + performance.volumeGoal, 0);
      const mbPlImportedVolumeActual = Object.values(mbPlPerformance).reduce((sum, performance) => sum + performance.volumeActual, 0);
      const mbPlAchievementTotal = Object.values(rawMbPlPerformance).reduce((sum, performance) => sum + performance.achievementTotal, 0);
      const mbPlAchievementCount = Object.values(rawMbPlPerformance).reduce((sum, performance) => sum + performance.achievementCount, 0);
      const mbPlImportedAchievement = mbPlAchievementCount > 0
        ? (mbPlAchievementTotal / mbPlAchievementCount) * 100
        : mbPlImportedGoal > 0 ? (mbPlImportedActual / mbPlImportedGoal) * 100 : 0;
      const hasDashboardAgentImport = campaignsWithSelectedImportedAgentMonitoring.has(c.id);
      const hasDashboardAgentTargetImport = [...preferredAgentDetailRecords.values()].some((record) =>
        record.campaignId === c.id &&
        record.recordKind === "agent_monitoring" &&
        record.target != null
      );
      const hasBdoCccImport = bdoCccKpiRecords.some((record) => record.campaignId === c.id);
      const hasCampaignAgentImport = campaignsWithMonthlyProductionImport.has(c.id)
        || hasDashboardAgentImport
        || hasDashboardAgentTargetImport
        || hasMbPlImport
        || hasBdoCccImport;
      const syntheticTotalName = normalizeImportedAgentName(`${c.campaignName} Total`);
      const importedGoalForAgent = (agentId: string) => {
        const goals = normalizedGoalsByAgent[agentId] ?? {};
        if (isMbPlCampaign && hasMbPlImport) return mbPlPerformance[agentId]?.transactionGoal;
        if (isMbPaCampaign) return mbPaTargetByAgent.get(agentId) ?? goals.goal;
        if (isAcqCampaign) return goals.ntb;
        return importedTargetByAgent.get(agentId)
          ?? goals[campaignKpiById.get(c.id) || c.kpiMetric || "booked"]
          ?? goals.goal;
      };
      const campaignAgentCandidates = [
        ...(agentsByCampaign.get(c.id) ?? []).map((a) => {
          const importedGoal = importedGoalForAgent(a.id);
          const importedGoals = normalizedGoalsByAgent[a.id] ?? {};
          return {
            id: a.id,
            name: a.name,
            email: a.email,
            seatNumber: a.seatNumber,
            monthlyTarget: hasCampaignAgentImport ? importedGoal ?? null : importedGoal ?? a.monthlyTarget,
            monthlyTargetSupplementary: hasCampaignAgentImport
              ? importedGoals.supplementary ?? null
              : importedGoals.supplementary ?? a.monthlyTargetSupplementary,
            importedGoals,
            goalSource: hasCampaignAgentImport || importedGoal != null ? "bulk_import" : "configured",
            mbLevel: a.mbLevel,
            disbursedTxnTarget: a.disbursedTxnTarget,
            disbursedVolTarget: a.disbursedVolTarget,
            grossTurnInsTxnTarget: a.grossTurnInsTxnTarget,
            grossTurnInsVolTarget: a.grossTurnInsVolTarget,
            importedOnly: false,
          };
        }),
        ...(importedRosterByCampaign.get(c.id) ?? []).map((agent) => ({
          ...agent,
          monthlyTarget: importedGoalForAgent(agent.id) ?? null,
          monthlyTargetSupplementary: normalizedGoalsByAgent[agent.id]?.supplementary ?? null,
          importedGoals: normalizedGoalsByAgent[agent.id] ?? {},
          goalSource: hasCampaignAgentImport || importedGoalForAgent(agent.id) != null ? "bulk_import" : "configured",
        })),
      ].filter((agent) => !(
        hasDashboardAgentImport &&
        agent.importedOnly &&
        normalizeImportedAgentName(agent.name) === syntheticTotalName
      ));
      const campaignAgentByName = new Map<string, (typeof campaignAgentCandidates)[number]>();
      for (const agent of campaignAgentCandidates) {
        const normalizedName = normalizeImportedAgentName(agent.name);
        if (!normalizedName) continue;
        const existing = campaignAgentByName.get(normalizedName);
        // Duplicate user accounts must not create duplicate cards. Prefer the
        // account that owns the selected import-period production, if present.
        if (!existing || (production[agent.id] && !production[existing.id])) {
          campaignAgentByName.set(normalizedName, agent);
        }
      }
      const campaignAgents = [...campaignAgentByName.values()];
      const hasDashboardProductionImport = [...preferredAgentDetailRecords.values()].some((record) =>
        record.campaignId === c.id &&
        (record.recordKind === "agent_monitoring" || !campaignsWithSelectedImportedAgentMonitoring.has(c.id)) &&
        (importedActual(record) != null || record.target != null)
      );
      const dataEntryAgentIds = campaignsWithMonthlyProductionImport.has(c.id) || hasDashboardProductionImport
        ? Object.keys(production)
        : campaignAgents.map((agent) => agent.id);
      const importedPeriods = [...new Map(
        [...preferredDashboardRecords.values()]
          .filter((record) => record.campaignId === c.id && record.month != null)
          .map((record) => [`${record.year}-${record.month}`, { year: record.year, month: record.month as number }])
      ).values()];
      const goalPeriods = importedPeriods.length > 0 ? importedPeriods : [{ year: goalYear, month: goalMonth }];
      const ceoGoal = isBdoCampaign
        ? goalPeriods.reduce((sum, period) => {
            const configured = monthlyGoalsByCampaignPeriod.get(`${c.id}|${period.year}|${period.month}`);
            return sum + Number(configured?.monthlyGoal ?? c.monthlyGoal ?? 0);
          }, 0)
        : Number(savedGoal?.monthlyGoal ?? c.monthlyGoal ?? 0);
      const latestGoalPeriod = [...goalPeriods].sort((a, b) => b.year - a.year || b.month - a.month)[0];
      const effectiveBdoGoalConfig = isBdoCampaign
        ? monthlyGoalsByCampaignPeriod.get(`${c.id}|${latestGoalPeriod.year}|${latestGoalPeriod.month}`)
        : null;
      const rawImportedPerformance = importedAgentPerformanceByCampaign.get(c.id) ?? {};
      const importedTargetTotal = campaignAgents.reduce(
        (sum, agent) => sum + Number(rawImportedPerformance[agent.id]?.importedTarget || 0),
        0
      );
      const importedPerformance = Object.keys(rawImportedPerformance).length > 0
        ? Object.fromEntries(campaignAgents.map((agent) => {
            const imported = rawImportedPerformance[agent.id] ?? { importedTarget: 0, actual: 0 };
            return [agent.id, {
              goal: imported.importedTarget,
              actual: imported.actual,
              achievement: imported.importedTarget > 0 ? (imported.actual / imported.importedTarget) * 100 : 0,
            }];
          }))
        : undefined;
      const bdoSgmPerformance = /^BDO\s+SGM$/i.test(c.campaignName.trim())
        ? Object.fromEntries(campaignAgents.map((agent) => {
            const actual = Number(production[agent.id]?.transmittals || 0);
            const goal = Number(importedGoalForAgent(agent.id) || 0);
            return [agent.id, {
              goal,
              actual,
              achievement: goal > 0 ? (actual / goal) * 100 : 0,
            }];
          }))
        : undefined;
      const rawBdoCccPerformance = bdoCccPerformanceByCampaign.get(c.id);
      const bdoCccPerformance = rawBdoCccPerformance
        ? Object.fromEntries(Object.entries(rawBdoCccPerformance).map(([agentId, row]) => [agentId, {
            goal: ceoGoal,
            actual: row.actual,
            achievement: ceoGoal > 0 ? (row.actual / ceoGoal) * 100 : 0,
          }]))
        : undefined;
      const bdoPerformance = isBdoCampaign
        ? bdoCccPerformance ?? importedPerformance ?? bdoSgmPerformance
        : undefined;
      const bdoActualFromAgents = Object.values(rawImportedPerformance).reduce((sum, row) => sum + row.actual, 0);
      const hasBdoAgentImport = Object.keys(rawImportedPerformance).length > 0;
      const normalizedPrimaryGoalTotal = campaignAgents.reduce((sum, agent) => {
        const importedGoal = importedGoalForAgent(agent.id);
        return sum + Number(importedGoal ?? 0);
      }, 0);
      const normalizedSupplementaryGoalTotal = campaignAgents.reduce(
        (sum, agent) => sum + Number(normalizedGoalsByAgent[agent.id]?.supplementary ?? 0),
        0
      );
      const importedCampaignGoal = Number(
        importedGoalByCampaign.get(c.id) ??
        importedSummaryGoalByCampaign.get(c.id) ??
        0
      );
      const fallbackGoal = isBdoCampaign
        ? hasDashboardAgentTargetImport
          ? normalizedPrimaryGoalTotal
          : hasBdoAgentImport
            ? importedTargetTotal
            : ceoGoal
        : isMbPaCampaign
          ? hasCampaignAgentImport
            ? normalizedPrimaryGoalTotal
            : Number(mbPaGoalByCampaign.get(c.id) || ceoGoal)
          : isMbPlCampaign && hasMbPlImport
            ? mbPlImportedGoal
            : hasCampaignAgentImport
              ? normalizedPrimaryGoalTotal || importedAgentGoalByCampaign.get(c.id) || 0
              : ceoGoal;
      // Explicit campaign/team goals from the imported workbook always win.
      // Otherwise use one goal per unique agent and reporting period; the
      // maps above are keyed by agent and metric so transaction rows cannot
      // multiply the same target.
      const resolvedGoalValue = importedCampaignGoal || fallbackGoal;
      const resolvedGoal = resolvedGoalValue > 0 ? resolvedGoalValue : null;
      const resolvedActual = isBdoCccCampaign && bdoCccActualByCampaign.has(c.id)
        ? bdoCccActualByCampaign.get(c.id)!
        : isBdoCampaign
        ? hasBdoAgentImport
          ? bdoActualFromAgents
          : importedActualByCampaign.get(c.id) ??
            importedSummaryActualByCampaign.get(c.id) ??
            null
        : isMbPaCampaign
          ? mbPaActualByCampaign.get(c.id) ??
            importedSummaryActualByCampaign.get(c.id) ??
            null
          : isMbPlCampaign && hasMbPlImport
            ? mbPlImportedActual
            : importedActualByCampaign.get(c.id) ??
              importedSummaryActualByCampaign.get(c.id) ??
              null;
      const resolvedKpiMetric = isMbPlCampaign && hasMbPlImport
        ? "actual"
        : hasDashboardAgentImport || hasDashboardAgentTargetImport
          ? campaignKpiById.get(c.id) || c.kpiMetric || "booked"
          : effectiveBdoGoalConfig?.kpiMetric ||
            savedGoal?.kpiMetric ||
            campaignKpiById.get(c.id) ||
            c.kpiMetric ||
            "booked";
      const productionFromAgents = Object.values(production).reduce(
        (sum, row) => {
          if (isAcqCampaign) return sum + Number(row.ntb || 0);
          return sum + Number(row[resolvedKpiMetric] || 0);
        },
        0
      );
      const campaignProduction = Number(resolvedActual ?? productionFromAgents);
      const recordCount =
        (detailCountByCampaign.get(c.id) ?? 0) +
        (dashboardRecordCountByCampaign.get(c.id) ?? 0) +
        (metricCountByCampaign.get(c.id) ?? 0) +
        (kpiRecordCountByCampaign.get(c.id) ?? 0);
      const campaignAchievement = calculateCampaignAchievement({
        campaignId: c.id,
        campaignName: c.campaignName,
        production: campaignProduction,
        goal: resolvedGoal,
        agentCount: campaignAgents.length,
        recordCount,
        hasCampaignConfiguration: Boolean(
          savedGoal ||
          c.monthlyGoal ||
          c.supplementaryGoal ||
          campaignAgents.length
        ),
      });

      return {
        id: c.id,
        campaignName: c.campaignName,
        kpiMetric: resolvedKpiMetric,
        goal: campaignAchievement.goal,
        actual: resolvedActual,
        achievement: campaignAchievement.achievementPercent,
        campaignProduction: campaignAchievement.production,
        achievementPercent: campaignAchievement.achievementPercent,
        goalStatus: campaignAchievement.goalStatus,
        dataStatus: campaignAchievement.dataStatus,
        agentCount: campaignAchievement.agentCount,
        recordCount: campaignAchievement.recordCount,
        supplementaryGoal: hasCampaignAgentImport && isAcqCampaign
          ? normalizedSupplementaryGoalTotal
          : normalizedSupplementaryGoalTotal
            || Number(savedGoal?.supplementaryGoal ?? c.supplementaryGoal ?? 0),
        agents: campaignAgents,
        dataEntryAgentIds,
        bdoPerformance,
        importedPerformance,
        mbPlPerformance: hasMbPlImport ? mbPlPerformance : undefined,
        mbPlTotals: hasMbPlImport ? {
          transactionGoal: mbPlImportedGoal,
          transactionActual: mbPlImportedActual,
          volumeGoal: mbPlImportedVolumeGoal,
          volumeActual: mbPlImportedVolumeActual,
          achievement: mbPlImportedAchievement,
        } : undefined,
        production,
        attendance: attByCampaign.get(c.id) ?? {},
        entriesCount: (entryCountByCampaign.get(c.id) ?? 0)
          + (importedEntryKeysByCampaign.get(c.id)?.size ?? 0)
          + (kpiPeriodCountByCampaign.get(c.id)?.size ?? 0),
        dataPeriod: bdoCccKpiFallbackPeriodByCampaign.has(c.id)
          ? { source: "latest_import", ...bdoCccKpiFallbackPeriodByCampaign.get(c.id)! }
          : isBdoCampaign && importedAgentFallbackPeriodByCampaign.has(c.id)
          ? { source: "latest_import", ...importedAgentFallbackPeriodByCampaign.get(c.id)! }
          : importedFallbackPeriodByCampaign.has(c.id)
            ? { source: "latest_import", ...importedFallbackPeriodByCampaign.get(c.id)! }
          : { source: "selected_range" },
        agentDataPeriod: bdoCccKpiFallbackPeriodByCampaign.has(c.id)
          ? { source: "latest_import", ...bdoCccKpiFallbackPeriodByCampaign.get(c.id)! }
          : importedAgentFallbackPeriodByCampaign.has(c.id)
          ? { source: "latest_import", ...importedAgentFallbackPeriodByCampaign.get(c.id)! }
          : { source: "selected_range" },
        lastUpdated: sourceUpdateByCampaign.get(c.id)?.toISOString() ?? null,
      };
    });

    const summary = summarizeCampaignAchievements(
      result.map((campaign) => ({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        production: campaign.campaignProduction,
        goal: campaign.goal,
        agentCount: campaign.agentCount,
        recordCount: campaign.recordCount,
        achievementPercent: campaign.achievementPercent,
        goalStatus: campaign.goalStatus,
        dataStatus: campaign.dataStatus,
      }))
    );
    if (process.env.NODE_ENV !== "production") {
      console.info("[collector-dashboard-aggregation]", {
        dateFrom,
        dateTo,
        requestedCampaignId: requestedCampaignId || "all",
        campaignCount: result.length,
        campaignsWithProduction: summary.campaignsWithProduction,
        campaignsWithoutProduction: summary.campaignsWithoutProduction,
        campaignsWithoutGoal: summary.campaignsWithoutGoal,
      });
    }

    return NextResponse.json({
      filters: {
        campaign: requestedCampaignId || "all",
        month: selectedEndPeriod.month,
        year: selectedEndPeriod.year,
        dateFrom,
        dateTo,
      },
      summary,
      campaigns: result,
      lastUpdated: sourceUpdateByCampaign.size > 0
        ? new Date(Math.max(...[...sourceUpdateByCampaign.values()].map((timestamp) => timestamp.getTime()))).toISOString()
        : null,
      activityTrend: [...activityByDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, value]) => ({ date, value })),
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error: any) {
    console.error("Collector dashboard API error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
