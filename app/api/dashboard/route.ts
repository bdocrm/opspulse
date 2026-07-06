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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const now        = new Date();
    const year       = parseInt(searchParams.get("year")       ?? String(now.getFullYear()));
    const month      = parseInt(searchParams.get("month")      ?? String(now.getMonth() + 1));
    const campaignId = searchParams.get("campaignId") ?? null;

    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate   = new Date(year, month, 0);
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
    const availablePeriods = await prisma.$queryRaw<Array<{ year: number; month: number }>>`
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
        agent: { select: { id: true, name: true } },
        productionEntry: { select: { date: true } },
      },
    });

    // 4. Group by campaign
    const detailsByCampaign = new Map<string, typeof allDetails>();
    for (const d of allDetails) {
      if (!detailsByCampaign.has(d.campaignId)) detailsByCampaign.set(d.campaignId, []);
      detailsByCampaign.get(d.campaignId)!.push(d);
    }

    // 5. Campaign-level KPIs
    const campaignTable = campaigns.map((c) => {
      const details = detailsByCampaign.get(c.id) ?? [];
      const wDays   = Number(extrasById[c.id]?.workingDays ?? 22);
      const dLapsed = Number(extrasById[c.id]?.daysLapsed  ?? 0);
      // MTD = sum of volume (peso amounts) for standard campaigns, or NTB for ACQ
      // campaigns — matching the OM / Collector dashboards.
      const mtd     = details.reduce((sum, d) => sum + metricValue(c.campaignName, d), 0);
      const rr      = calcRunRate(mtd, dLapsed, wDays);
      const ach     = calcAchievement(mtd, c.monthlyGoal);
      const rrAch   = calcRRAch(rr, c.monthlyGoal);

      return {
        id: c.id,
        campaignName: c.campaignName,
        // Show the metric that actually drives MTD (NTB for acquisition campaigns).
        kpiMetric: isAcqCampaign(c.campaignName) ? "ntb" : c.kpiMetric,
        goal: c.monthlyGoal,
        mtd:          Math.round(mtd),
        achievement:  ach,
        runRate:      Math.round(rr),
        rrAchievement: rrAch,
        workingDays:  wDays,
        daysLapsed:   dLapsed,
      };
    });

    // 6. Aggregated KPI cards
    const n = campaignTable.length || 1;
    const totalMTD         = campaignTable.reduce((a, c) => a + c.mtd, 0);
    const avgAchievement   = campaignTable.reduce((a, c) => a + c.achievement, 0)   / n;
    const avgRunRate       = campaignTable.reduce((a, c) => a + c.runRate, 0)       / n;
    const avgRRAchievement = campaignTable.reduce((a, c) => a + c.rrAchievement, 0) / n;

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
    const dailyTrend = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // 9. Distribution (each campaign's share of total MTD)
    const distribution = campaignTable
      .filter((c) => c.mtd > 0)
      .map((c) => ({ name: c.campaignName, value: c.mtd }));

    // 10. Agent leaderboard (top 10 by the per-campaign metric)
    const agentMap = new Map<string, { name: string; value: number }>();
    for (const d of allDetails) {
      const val = metricValue(campaignNameById.get(d.campaignId), d);
      const aid = d.agent.id;
      if (!agentMap.has(aid)) agentMap.set(aid, { name: d.agent.name, value: 0 });
      agentMap.get(aid)!.value += val;
    }
    const leaderboard = Array.from(agentMap.values())
      .filter((a) => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((a) => ({ name: a.name, value: Math.round(a.value) }));

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
