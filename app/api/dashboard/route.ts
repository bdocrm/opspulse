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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const now        = new Date();
    const year       = parseInt(searchParams.get("year")       ?? String(now.getFullYear()));
    const month      = parseInt(searchParams.get("month")      ?? String(now.getMonth() + 1));
    const campaignId = searchParams.get("campaignId") ?? null;

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month,     0, 23, 59, 59);

    // 1. Campaigns
    const campaigns = await prisma.campaign.findMany({
      where: campaignId ? { id: campaignId } : undefined,
      select: { id: true, campaignName: true, kpiMetric: true, monthlyGoal: true },
      orderBy: { createdAt: "asc" },
    });

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

    // 3. All ProductionDetail rows for the period
    const allDetails = await prisma.productionDetail.findMany({
      where: {
        ...(campaignId ? { campaignId } : {}),
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      include: {
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
      // MTD = sum of volume (peso amounts), matching the OM Dashboard Excel
      const mtd     = details.reduce((sum, d) => sum + Number(d.volume), 0);
      const rr      = calcRunRate(mtd, dLapsed, wDays);
      const ach     = calcAchievement(mtd, c.monthlyGoal);
      const rrAch   = calcRRAch(rr, c.monthlyGoal);

      return {
        id: c.id,
        campaignName: c.campaignName,
        kpiMetric: c.kpiMetric,
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

    // 8. Daily trend (aggregate volume per date)
    const dailyMap = new Map<string, number>();
    for (const d of allDetails) {
      const key = new Date(d.productionEntry.date).toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number(d.volume));
    }
    const dailyTrend = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // 9. Distribution (each campaign's share of total MTD)
    const distribution = campaignTable
      .filter((c) => c.mtd > 0)
      .map((c) => ({ name: c.campaignName, value: c.mtd }));

    // 10. Agent leaderboard (top 10 by volume)
    const agentMap = new Map<string, { name: string; value: number }>();
    for (const d of allDetails) {
      const val = Number(d.volume);
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
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
