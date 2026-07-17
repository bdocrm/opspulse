import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ─── KPI helpers ──────────────────────────────────────────────────────────────

function calcAchievement(mtd: number, goal: number) {
  return goal > 0 ? (mtd / goal) * 100 : 0;
}
function calcRunRate(mtd: number, daysLapsed: number, workingDays: number) {
  return daysLapsed > 0 ? (mtd / daysLapsed) * workingDays : 0;
}
function calcRRAch(rr: number, goal: number) {
  return goal > 0 ? (rr / goal) * 100 : 0;
}

// ACQ campaigns (name contains "ACQ") report acquisitions in `ntb`, not peso
// `volume`. Mirror the Collector Dashboard so MB ACQ shows real numbers here too.
const isAcqCampaign = (name?: string | null) => /\bacq\b/i.test(name || "");

/** Resolve the MTD-contributing value for one ProductionDetail row given its
 *  campaign: NTB for acquisition campaigns, gross peso volume for everything else. */
function metricValue(campaignName: string | undefined, d: { volume: bigint | number; ntb: bigint | number }) {
  return isAcqCampaign(campaignName) ? Number(d.ntb) : Number(d.volume);
}

function isImportedClassificationRow(row: {
  worksheetSource: string;
  monitoringType: string | null;
  entityName: string;
}) {
  const normalizedName = row.entityName.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return row.worksheetSource === "PL YTD Productivity" &&
    row.monitoringType === "PL_PRODUCTIVITY" &&
    /^(?:OLD|SEMI OLD|NEW|(?:OLD|SEMI OLD|NEW|TOTAL) AVERAGE PER AGENT)$/.test(normalizedName);
}

function normalizeAgentName(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const now        = new Date();
    const year       = parseInt(searchParams.get("year")       ?? String(now.getFullYear()));
    // month = 0 means "All Months" → aggregate the entire selected year.
    const month      = parseInt(searchParams.get("month")      ?? String(now.getMonth() + 1));
    const campaignId = searchParams.get("campaignId") ?? null;
    const allMonths  = month === 0;

    const startDate = allMonths ? new Date(year, 0, 1)  : new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate   = allMonths ? new Date(year, 11, 31) : new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);

    // 1. Campaigns
    const campaigns = await prisma.campaign.findMany({
      where: campaignId ? { id: campaignId } : undefined,
      select: { id: true, campaignName: true, kpiMetric: true, monthlyGoal: true },
      orderBy: { createdAt: "asc" },
    });

    // 1b. Distinct periods (year/month) that actually contain production data.
    // Used by the UI to populate the month selector and to auto-jump to the most
    // recent month with data when the current month is empty.
    let availablePeriods = await prisma.$queryRaw<Array<{ year: number; month: number }>>`
      SELECT DISTINCT
        EXTRACT(YEAR FROM pe."date")::int  AS year,
        EXTRACT(MONTH FROM pe."date")::int AS month
      FROM "ProductionEntry" pe
      JOIN "ProductionDetail" pd ON pd."productionEntryId" = pe."id"
      ORDER BY year DESC, month DESC
    `;

    // 2. workingDays / daysLapsed via raw SQL
    const cIds = campaigns.map((c) => c.id);
    let extras: { id: string; workingDays: number; daysLapsed: number }[] = [];
    if (cIds.length > 0) {
      extras = await prisma.$queryRaw<any[]>`
        SELECT id, "workingDays", "daysLapsed"
        FROM "Campaign"
        WHERE id = ANY(${cIds}::text[])
      `;
    }
    const extrasById = Object.fromEntries(extras.map((e) => [e.id, e]));

    // Campaign name lookup — used to pick the right metric (NTB vs volume) per row.
    const campaignNameById = new Map(campaigns.map((c) => [c.id, c.campaignName]));

    // 3. All ProductionDetail rows for the period
    const allDetails = await prisma.productionDetail.findMany({
      where: {
        ...(campaignId ? { campaignId } : {}),
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      select: {
        campaignId: true,
        volume: true,
        ntb: true,
        monthlyGoal: true,
        agent: { select: { id: true, name: true, monthlyTarget: true } },
        productionEntry: { select: { date: true } },
      },
    });

    // Dashboard-style BPI/BDO workbooks are normalized into DashboardImportRecord.
    // Merge their campaign KPI values into the CEO dashboard without collapsing
    // PL Count/Volume metrics or counting HOH mirrors twice.
    const dashboardRows = await prisma.dashboardImportRecord.findMany({
      where: {
        campaignId: { in: cIds },
        recordKind: { in: ["agent_monitoring", "ytd"] },
        reportDate: { gte: startDate, lte: endDate },
        OR: [{ actual: { not: null } }, { achievement: { not: null } }],
      },
      select: { campaignId: true, recordKind: true, worksheetSource: true, entityName: true, monitoringType: true, metric: true, year: true, month: true, reportDate: true, target: true, actual: true, achievement: true },
      orderBy: [{ reportDate: "asc" }, { sourceRow: "asc" }],
    }).catch(() => []);
    const usableDashboardRows = dashboardRows.filter((row) => !isImportedClassificationRow(row));
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const importedActual = (row: (typeof dashboardRows)[number]) => row.actual != null
      ? Number(row.actual)
      : row.target != null && row.achievement != null
        ? Math.round(Number(row.target) * Number(row.achievement))
        : null;
    const bpiCurrencyCampaigns = new Set(
      usableDashboardRows.filter((row) => Number(row.target || 0) >= 1_000_000 && /^BPI\b/i.test(campaignById.get(row.campaignId)?.campaignName || "")).map((row) => row.campaignId)
    );
    const campaignsWithAgentRows = new Set(usableDashboardRows.filter((row) => row.recordKind === "agent_monitoring").map((row) => row.campaignId));
    const preferredDashboardRows = new Map<string, (typeof dashboardRows)[number]>();
    for (const row of usableDashboardRows) {
      const normalizedName = normalizeAgentName(row.entityName || "Campaign Total");
      const rowKey = `${row.campaignId}|${normalizedName}|${row.year}|${row.month || 0}|${row.metric}`;
      const existing = preferredDashboardRows.get(rowKey);
      const priority = row.monitoringType?.endsWith("_AGENT") ? 2 : 1;
      const existingPriority = existing?.monitoringType?.endsWith("_AGENT") ? 2 : existing ? 1 : 0;
      if (priority > existingPriority) preferredDashboardRows.set(rowKey, row);
    }
    const importedTargetByAgent = new Map<string, number>();
    for (const row of preferredDashboardRows.values()) {
      if (row.recordKind !== "agent_monitoring" || Number(row.target || 0) <= 0) continue;
      const key = `${row.campaignId}|${normalizeAgentName(row.entityName)}`;
      importedTargetByAgent.set(key, (importedTargetByAgent.get(key) || 0) + Number(row.target));
    }
    const importedRows = [...preferredDashboardRows.values()].flatMap((row) => {
      const campaign = campaignById.get(row.campaignId);
      if (!campaign) return [];
      const metric = row.metric.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const kpi = /cash installment/.test(metric) || bpiCurrencyCampaigns.has(row.campaignId) ? "volume" : campaign.kpiMetric || "booked";
      const actual = importedActual(row);
      if (actual == null || (row.recordKind === "ytd" && actual === 0 && Number(row.target || 0) === 0)) return [];
      const matchesKpi =
        (kpi === "transmittals" && (metric === "transmitted count" || !/\b(?:volume|approvals|booked)\b/.test(metric))) ||
        (kpi === "approvals" && (metric === "approvals count" || !/\b(?:volume|transmitted|booked)\b/.test(metric))) ||
        (kpi === "booked" && (metric === "booked count" || !/\b(?:volume|transmitted|approvals)\b/.test(metric))) ||
        (kpi === "activations" && !/\b(?:volume|transmitted|approvals|booked)\b/.test(metric)) ||
        (kpi === "volume" && (row.recordKind === "ytd" || metric.includes("booked volume") || metric.includes("cash installment") || (!campaignsWithAgentRows.has(row.campaignId) && metric.includes("volume"))));
      return matchesKpi ? [{ ...row, value: actual, agentName: row.entityName || `${campaign.campaignName} Total` }] : [];
    });
    const campaignsWithYtdSummary = new Set(importedRows.filter((row) => row.recordKind === "ytd").map((row) => row.campaignId));
    const importedByCampaign = new Map<string, typeof importedRows>();
    const importedGoalByCampaign = new Map<string, number>();
    for (const row of importedRows) {
      importedByCampaign.set(row.campaignId, [...(importedByCampaign.get(row.campaignId) || []), row]);
      if (row.target && (row.recordKind === "ytd" || !campaignsWithYtdSummary.has(row.campaignId))) {
        importedGoalByCampaign.set(row.campaignId, (importedGoalByCampaign.get(row.campaignId) || 0) + Number(row.target));
      }
    }
    const dashboardPeriods = await prisma.$queryRaw<Array<{ year: number; month: number }>>`
      SELECT DISTINCT "year", "month" FROM "DashboardImportRecord" WHERE "month" IS NOT NULL ORDER BY "year" DESC, "month" DESC
    `.catch(() => []);
    availablePeriods = [...new Map([...availablePeriods, ...dashboardPeriods].map((period) => [`${period.year}-${period.month}`, period])).values()]
      .sort((a, b) => b.year - a.year || b.month - a.month);

    // 4. Group by campaign
    const detailsByCampaign = new Map<string, typeof allDetails>();
    for (const d of allDetails) {
      if (!detailsByCampaign.has(d.campaignId)) detailsByCampaign.set(d.campaignId, []);
      detailsByCampaign.get(d.campaignId)!.push(d);
    }

    // 5. Campaign-level KPIs
    const allCampaignRows = campaigns.map((c) => {
      const details = detailsByCampaign.get(c.id) ?? [];
      const imported = importedByCampaign.get(c.id) ?? [];
      const wDays   = Number(extrasById[c.id]?.workingDays ?? 22);
      const dLapsed = Number(extrasById[c.id]?.daysLapsed  ?? 0);
      // MTD = sum of volume (peso amounts) for standard campaigns, or NTB for ACQ
      // campaigns — matching the OM / Collector dashboards.
      const ytdSummary = imported.filter((row) => row.recordKind === "ytd");
      const importedDetails = imported.filter((row) => row.recordKind !== "ytd");
      const mtd = ytdSummary.length
        ? ytdSummary.reduce((sum, row) => sum + row.value, 0)
        : details.reduce((sum, d) => sum + metricValue(c.campaignName, d), 0) + importedDetails.reduce((sum, row) => sum + row.value, 0);
      const goal    = importedGoalByCampaign.get(c.id) || c.monthlyGoal;
      const rr      = calcRunRate(mtd, dLapsed, wDays);
      const ach     = calcAchievement(mtd, goal);
      const rrAch   = calcRRAch(rr, goal);

      return {
        id: c.id,
        campaignName: c.campaignName,
        hasData: details.length > 0 || imported.length > 0,
        // Show the metric that actually drives MTD (NTB for acquisition campaigns).
        kpiMetric: isAcqCampaign(c.campaignName) ? "ntb" : bpiCurrencyCampaigns.has(c.id) ? "volume" : c.kpiMetric,
        goal,
        mtd:          Math.round(mtd),
        achievement:  ach,
        runRate:      Math.round(rr),
        rrAchievement: rrAch,
        workingDays:  wDays,
        daysLapsed:   dLapsed,
      };
    });

    // Keep every selected campaign visible on the CEO dashboard. Campaigns without
    // production for the period are marked with hasData=false so the UI can show
    // them as "No data" instead of silently removing them.
    const campaignTable = allCampaignRows;
    const campaignsWithData = allCampaignRows.filter((c) => c.hasData);

    // 6. Aggregated KPI cards
    // No-data campaigns remain visible but do not dilute the performance averages.
    const n = campaignsWithData.length || 1;
    const totalMTD         = campaignsWithData.reduce((a, c) => a + c.mtd, 0);
    const avgAchievement   = campaignsWithData.reduce((a, c) => a + c.achievement, 0)   / n;
    const avgRunRate       = campaignsWithData.reduce((a, c) => a + c.runRate, 0)       / n;
    const avgRRAchievement = campaignsWithData.reduce((a, c) => a + c.rrAchievement, 0) / n;

    // 7. Campaign achievement chart
    const campaignsChart = campaignTable.map((c) => ({
      name: c.campaignName,
      achievement: c.achievement,
    }));

    // 8. Daily trend (aggregate the per-campaign metric per date)
    const dailyMap = new Map<string, number>();
    for (const d of allDetails) {
      const key = new Date(d.productionEntry.date).toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + metricValue(campaignNameById.get(d.campaignId), d));
    }
    for (const row of importedRows.filter((record) => !campaignsWithYtdSummary.has(record.campaignId) || record.recordKind === "ytd")) {
      const date = row.month ? `${row.year}-${String(row.month).padStart(2, "0")}-01` : new Date(row.reportDate).toISOString().slice(0, 10);
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + row.value);
    }
    const dailyTrend = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // 9. Distribution (each campaign's share of total MTD)
    const distribution = campaignsWithData
      .filter((c) => c.mtd > 0)
      .map((c) => ({ name: c.campaignName, value: c.mtd }));

    // 10. Agent leaderboard (top 10 by the per-campaign metric)
    const agentMap = new Map<string, { name: string; value: number; goal: number }>();
    const registeredAgentKeyByCampaignName = new Map<string, string>();
    for (const d of allDetails) {
      const val = metricValue(campaignNameById.get(d.campaignId), d);
      const aid = d.agent.id;
      registeredAgentKeyByCampaignName.set(`${d.campaignId}|${normalizeAgentName(d.agent.name)}`, aid);
      if (!agentMap.has(aid)) {
        agentMap.set(aid, {
          name: d.agent.name,
          value: 0,
          goal: Number(d.monthlyGoal || d.agent.monthlyTarget || 0),
        });
      } else {
        const current = agentMap.get(aid)!;
        current.goal = Math.max(current.goal, Number(d.monthlyGoal || d.agent.monthlyTarget || 0));
      }
      agentMap.get(aid)!.value += val;
    }
    for (const row of importedRows.filter((record) => record.recordKind !== "ytd")) {
      const targetKey = `${row.campaignId}|${normalizeAgentName(row.agentName)}`;
      const key = registeredAgentKeyByCampaignName.get(targetKey) || `imported:${targetKey}`;
      const goal = importedTargetByAgent.get(targetKey) || 0;
      if (!agentMap.has(key)) agentMap.set(key, { name: row.agentName, value: 0, goal });
      else agentMap.get(key)!.goal = Math.max(agentMap.get(key)!.goal, goal);
      agentMap.get(key)!.value += row.value;
    }
    const leaderboard = Array.from(agentMap.values())
      .filter((a) => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((a) => ({
        name: a.name,
        value: Math.round(a.value),
        goal: a.goal > 0 ? a.goal : null,
        achievement: a.goal > 0 ? calcAchievement(a.value, a.goal) : null,
      }));

    return NextResponse.json({
      kpis: {
        totalMTD:       Math.round(totalMTD),
        avgAchievement,
        avgRunRate:     Math.round(avgRunRate),
        avgRRAchievement,
      },
      campaigns:    campaignsChart,
      campaignTable,
      dailyTrend,
      distribution,
      leaderboard,
      availablePeriods,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
