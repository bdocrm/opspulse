import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAssignedCampaignIds } from "@/lib/user-campaigns";
import { ensureCampaignGoalTable } from "@/lib/campaign-goals";

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

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const attendanceDate = searchParams.get("attendanceDate") || dateTo;

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
    const assignedIds = await getAssignedCampaignIds(user.id);
    if (assignedIds.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    await ensureCampaignGoalTable();

    // Pull everything in a few batched queries scoped to the assigned set.
    const [campaigns, agents, rawDetails, rawEntries, monthlyGoalRows, dashboardAgentRecords] = await Promise.all([
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
        },
        orderBy: [{ reportDate: "asc" }, { sourceRow: "asc" }],
      }).catch(() => []),
    ]);
    const usableDashboardAgentRecords = dashboardAgentRecords.filter(
      (record) => !isImportedClassificationRow(record)
    );
    const importedActual = (record: (typeof dashboardAgentRecords)[number]) => {
      if (record.actual != null) return Number(record.actual);
      if (record.target != null && record.achievement != null) return Math.round(Number(record.target) * Number(record.achievement));
      return null;
    };
    const hasUsableImportedActual = (record: (typeof dashboardAgentRecords)[number]) => {
      const actual = importedActual(record);
      return actual != null && (actual !== 0 || Number(record.target || 0) > 0);
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

    const campaignsWithStandardProduction = new Set(details.map((detail) => detail.campaignId));
    const campaignsWithMonthlyProductionImport = new Set(
      details
        .filter((detail) => detail.productionEntry.importFileName
          && detail.productionEntry.reportPeriodType === "monthly")
        .map((detail) => detail.campaignId)
    );
    const campaignNameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.campaignName]));
    const mbPaCampaignIds = new Set(campaigns.filter((campaign) => /\bMB\s*PA\b/i.test(campaign.campaignName)).map((campaign) => campaign.id));
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
      transmittedVolume: 0, approvalsVolume: 0, bookedVolume: 0,
      bauPayrollTxn: 0, bauPayrollVol: 0, bauDepositorTxn: 0, bauDepositorVol: 0,
      topupPayrollTxn: 0, topupPayrollVol: 0, topupDepositorTxn: 0, topupDepositorVol: 0,
      openMarketTxn: 0, openMarketVol: 0,
      c2gTxn: 0, c2gVol: 0, btTxn: 0, btVol: 0, balconTxn: 0, balconVol: 0, grandTotalTxn: 0, grandTotalVol: 0,
    });

    const prodByCampaign = new Map<string, Record<string, Record<string, number>>>();
    for (const d of details) {
      const byAgent = prodByCampaign.get(d.campaignId) ?? {};
      const cur = byAgent[d.agentId] ?? emptyProduction();
      cur.transmittals += Number(d.transmittals);
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

    // MB PA progress is based on BILLINGS / imported TARGET, while its table
    // ranking is based on GRAND TOTAL transactions. Older imports may have a
    // target on only the first populated months, so carry the closest known
    // per-agent target into target-less rows from the same selected range.
    const mbPaTargetByAgent = new Map<string, number>();
    const mbPaGoalByCampaign = new Map<string, number>();
    const mbPaActualByCampaign = new Map<string, number>();
    const mbPaRowsByAgent = new Map<string, typeof details>();
    const storedMonthlyTargetByAgent = new Map(agents.map((agent) => [agent.id, Number(agent.monthlyTarget || 0)]));
    for (const detail of details) {
      if (!mbPaCampaignIds.has(detail.campaignId)) continue;
      const key = `${detail.campaignId}|${detail.agentId}`;
      const rows = mbPaRowsByAgent.get(key) ?? [];
      rows.push(detail);
      mbPaRowsByAgent.set(key, rows);
    }
    for (const rows of mbPaRowsByAgent.values()) {
      rows.sort((a, b) => a.productionEntry.date.getTime() - b.productionEntry.date.getTime());
      const explicitTargets = rows.map((detail) => {
        const stored = Number(detail.monthlyGoal || 0);
        if (stored > 0) return stored;
        const actual = Number(detail.monthlyActual ?? detail.grandTotalVol ?? 0);
        const rawAchievement = Number(detail.monthlyAchievement || 0);
        const achievement = rawAchievement > 2 ? rawAchievement / 100 : rawAchievement;
        return actual > 0 && achievement > 0 ? actual / achievement : 0;
      });
      rows.forEach((detail, index) => {
        const target = explicitTargets[index]
          || [...explicitTargets.slice(0, index)].reverse().find((value) => value > 0)
          || explicitTargets.slice(index + 1).find((value) => value > 0)
          || storedMonthlyTargetByAgent.get(detail.agentId)
          || 0;
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

    // Dashboard workbooks often contain different latest months per campaign
    // (for example CIE through May while NTH/VC/Supple end in March). If the
    // selected range has no imported actuals for one campaign, show that
    // campaign's latest imported month instead of returning misleading zeros.
    const campaignsWithImportedActualsInRange = new Set(
      [...preferredDashboardRecords.values()].filter(hasUsableImportedActual).map((record) => record.campaignId)
    );
    const importedFallbackPeriodByCampaign = new Map<string, { year: number; month: number }>();
    for (const campaign of campaigns) {
      if (campaignsWithStandardProduction.has(campaign.id) || campaignsWithImportedActualsInRange.has(campaign.id)) continue;
      const candidates = [...allPreferredDashboardRecords.values()].filter(
        (record) => record.campaignId === campaign.id && hasUsableImportedActual(record) && record.month != null
      );
      if (candidates.length === 0) continue;
      const latest = candidates.reduce((current, record) => {
        const currentPeriod = current.year * 12 + (current.month || 0);
        const recordPeriod = record.year * 12 + (record.month || 0);
        return recordPeriod > currentPeriod ? record : current;
      });
      const period = { year: latest.year, month: latest.month as number };
      importedFallbackPeriodByCampaign.set(campaign.id, period);
      for (const [key, record] of preferredDashboardRecords) {
        if (record.campaignId === campaign.id) preferredDashboardRecords.delete(key);
      }
      for (const [key, record] of allPreferredDashboardRecords) {
        if (record.campaignId === campaign.id && record.year === period.year && record.month === period.month) {
          preferredDashboardRecords.set(key, record);
        }
      }
    }

    // Campaign summary (YTD) and collector monitoring worksheets do not
    // always end in the same month. Select agent-level imports independently
    // so a newer YTD row cannot hide the latest uploaded collector results.
    const preferredAgentDetailRecords = new Map(preferredDashboardRecords);
    const importedAgentFallbackPeriodByCampaign = new Map<string, { year: number; month: number }>();
    for (const campaign of campaigns) {
      if (!/^BDO\b/i.test(campaign.campaignName)) continue;

      const agentRecordsInRange = [...allPreferredDashboardRecords.entries()].filter(([, record]) =>
        record.campaignId === campaign.id &&
        record.recordKind === "agent_monitoring" &&
        isImportedRecordInSelectedRange(record)
      );
      let selectedAgentRecords = agentRecordsInRange;

      if (selectedAgentRecords.length === 0) {
        const candidates = [...allPreferredDashboardRecords.entries()].filter(([, record]) =>
          record.campaignId === campaign.id &&
          record.recordKind === "agent_monitoring" &&
          record.month != null &&
          (hasUsableImportedActual(record) || record.target != null)
        );
        if (candidates.length > 0) {
          const latestRecord = candidates.reduce((current, candidate) => {
            const currentPeriod = current[1].year * 12 + (current[1].month || 0);
            const candidatePeriod = candidate[1].year * 12 + (candidate[1].month || 0);
            return candidatePeriod > currentPeriod ? candidate : current;
          })[1];
          const period = { year: latestRecord.year, month: latestRecord.month as number };
          importedAgentFallbackPeriodByCampaign.set(campaign.id, period);
          selectedAgentRecords = candidates.filter(([, record]) =>
            record.year === period.year && record.month === period.month
          );
        }
      }

      for (const [key, record] of preferredAgentDetailRecords) {
        if (record.campaignId === campaign.id && record.recordKind === "agent_monitoring") {
          preferredAgentDetailRecords.delete(key);
        }
      }
      for (const [key, record] of selectedAgentRecords) {
        preferredAgentDetailRecords.set(key, record);
      }
    }
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
    const importedBdoPerformanceByCampaign = new Map<
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
      if (record.recordKind !== "ytd" && /^BDO\b/i.test(campaignNameById.get(record.campaignId) || "")) {
        const byAgent = importedBdoPerformanceByCampaign.get(record.campaignId) ?? {};
        const performance = byAgent[agentId] ?? { importedTarget: 0, actual: 0 };
        performance.importedTarget += target;
        performance.actual += effectiveActual;
        byAgent[agentId] = performance;
        importedBdoPerformanceByCampaign.set(record.campaignId, byAgent);
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

    const result = campaigns.map((c) => {
      const savedGoal = monthlyGoalsByCampaignId.get(c.id);
      const isBdoCampaign = /^BDO\b/i.test(c.campaignName);
      const isMbPaCampaign = /\bMB\s*PA\b/i.test(c.campaignName);
      const production = prodByCampaign.get(c.id) ?? {};
      const hasDashboardAgentImport = campaignsWithSelectedImportedAgentMonitoring.has(c.id);
      const syntheticTotalName = normalizeImportedAgentName(`${c.campaignName} Total`);
      const campaignAgentCandidates = [
        ...(agentsByCampaign.get(c.id) ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          seatNumber: a.seatNumber,
          monthlyTarget: isBdoCampaign ? a.monthlyTarget : isMbPaCampaign ? mbPaTargetByAgent.get(a.id) || a.monthlyTarget : importedTargetByAgent.get(a.id) || a.monthlyTarget,
          monthlyTargetSupplementary: a.monthlyTargetSupplementary,
          mbLevel: a.mbLevel,
          disbursedTxnTarget: a.disbursedTxnTarget,
          disbursedVolTarget: a.disbursedVolTarget,
          grossTurnInsTxnTarget: a.grossTurnInsTxnTarget,
          grossTurnInsVolTarget: a.grossTurnInsVolTarget,
          importedOnly: false,
        })),
        ...(importedRosterByCampaign.get(c.id) ?? []).map((agent) => ({
          ...agent,
          monthlyTarget: isBdoCampaign ? null : importedTargetByAgent.get(agent.id) || null,
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
      const importedBdoPerformance = importedBdoPerformanceByCampaign.get(c.id) ?? {};
      const importedTargetTotal = campaignAgents.reduce(
        (sum, agent) => sum + Number(importedBdoPerformance[agent.id]?.importedTarget || 0),
        0
      );
      const bdoPerformance = isBdoCampaign
        ? Object.fromEntries(campaignAgents.map((agent) => {
            const imported = importedBdoPerformance[agent.id] ?? { importedTarget: 0, actual: 0 };
            return [agent.id, {
              goal: imported.importedTarget,
              actual: imported.actual,
              achievement: imported.importedTarget > 0 ? (imported.actual / imported.importedTarget) * 100 : 0,
            }];
          }))
        : undefined;
      const bdoActualFromAgents = Object.values(importedBdoPerformance).reduce((sum, row) => sum + row.actual, 0);
      const hasBdoAgentImport = Object.keys(importedBdoPerformance).length > 0;

      return {
        id: c.id,
        campaignName: c.campaignName,
        kpiMetric: effectiveBdoGoalConfig?.kpiMetric || savedGoal?.kpiMetric || campaignKpiById.get(c.id) || c.kpiMetric || "booked",
        goal: isBdoCampaign
          ? (hasBdoAgentImport ? importedTargetTotal : importedGoalByCampaign.get(c.id) || ceoGoal)
          : isMbPaCampaign
            ? mbPaGoalByCampaign.get(c.id) || ceoGoal
            : importedGoalByCampaign.get(c.id) || importedAgentGoalByCampaign.get(c.id) || ceoGoal,
        actual: isBdoCampaign
          ? (hasBdoAgentImport ? bdoActualFromAgents : importedActualByCampaign.get(c.id) ?? null)
          : isMbPaCampaign
            ? mbPaActualByCampaign.get(c.id) ?? null
            : importedActualByCampaign.get(c.id) ?? null,
        supplementaryGoal: Number(savedGoal?.supplementaryGoal ?? c.supplementaryGoal ?? 0),
        agents: campaignAgents,
        dataEntryAgentIds,
        bdoPerformance,
        production,
        attendance: attByCampaign.get(c.id) ?? {},
        entriesCount: (entryCountByCampaign.get(c.id) ?? 0) + (importedEntryKeysByCampaign.get(c.id)?.size ?? 0),
        dataPeriod: isBdoCampaign && importedAgentFallbackPeriodByCampaign.has(c.id)
          ? { source: "latest_import", ...importedAgentFallbackPeriodByCampaign.get(c.id)! }
          : importedFallbackPeriodByCampaign.has(c.id)
            ? { source: "latest_import", ...importedFallbackPeriodByCampaign.get(c.id)! }
          : { source: "selected_range" },
        agentDataPeriod: importedAgentFallbackPeriodByCampaign.has(c.id)
          ? { source: "latest_import", ...importedAgentFallbackPeriodByCampaign.get(c.id)! }
          : { source: "selected_range" },
      };
    });

    return NextResponse.json({ campaigns: result }, {
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
