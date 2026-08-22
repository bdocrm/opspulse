import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupByWeek, type KpiMetricKey } from "@/utils/kpi";

const BUSINESS_TIME_ZONE = "Asia/Manila";
const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

type MetricTotals = {
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  volume: number;
  transaction: number;
};

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function toBusinessYmd(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const yyyy = parts.find((part) => part.type === "year")?.value ?? "0000";
  const mm = parts.find((part) => part.type === "month")?.value ?? "01";
  const dd = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${yyyy}-${mm}-${dd}`;
}

function normalizeMetric(metric: string | null | undefined): KpiMetricKey {
  const normalized = (metric ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["activation", "activations", "activated", "act"].includes(normalized)) return "activations";
  if (["approval", "approvals", "approved", "appr"].includes(normalized)) return "approvals";
  if (["book", "booked", "booking", "bookings"].includes(normalized)) return "booked";
  if (["volume", "vol"].includes(normalized)) return "volume";
  if (["transaction", "transactions", "txn", "txns"].includes(normalized)) return "transaction";
  return "transmittals";
}

function metricValue(metric: KpiMetricKey, totals: MetricTotals) {
  if (metric === "activations") return totals.activations;
  if (metric === "approvals") return totals.approvals;
  if (metric === "booked") return totals.booked;
  if (metric === "volume") return totals.volume;
  if (metric === "transaction") return totals.transaction;
  return totals.transmittals;
}

function resolveEffectiveMetric(metric: KpiMetricKey, goal: number, totals: MetricTotals, agentGoals: number[]) {
  const configuredActual = metricValue(metric, totals);
  const averageAgentGoal =
    agentGoals.length > 0 ? agentGoals.reduce((sum, value) => sum + value, 0) / agentGoals.length : 0;
  const looksLikeMoneyGoal = goal >= 1_000_000 || averageAgentGoal >= 1_000_000;
  const hasMeaningfulVolume = totals.volume > configuredActual && totals.volume > 0;

  if (metric !== "volume" && looksLikeMoneyGoal && hasMeaningfulVolume) {
    return "volume";
  }

  return metric;
}

/** Achievement = (MTD / Goal) × 100 */
function achievement(mtd: number, goal: number): number {
  if (goal === 0) return 0;
  return (mtd / goal) * 100;
}

/** Run Rate = MTD / Days Lapsed */
function runRate(mtd: number, daysLapsed: number): number {
  if (daysLapsed === 0) return 0;
  return mtd / daysLapsed;
}

// ─── GET /api/campaigns/[id] ─────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));

    const { start: startDate, end: endDate } = monthRange(year, month);

    // Fetch base campaign fields via ORM
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        campaignName: true,
        kpiMetric: true,
        monthlyGoal: true,
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch workingDays / daysLapsed via raw SQL (Prisma client may not know about them yet)
    const extras = await prisma.$queryRaw<{ workingDays: number; daysLapsed: number }[]>`
      SELECT "workingDays", "daysLapsed" FROM "Campaign" WHERE id = ${id}
    `;

    const monthlyConfig = await prisma.campaignGoal.findFirst({
      where: { campaignId: id, month, year },
      select: {
        monthlyGoal: true,
        kpiMetric: true,
        workingDays: true,
        daysLapsed: true,
      },
    });

    const goal = Number(monthlyConfig?.monthlyGoal ?? campaign.monthlyGoal ?? 0);
    const configuredMetric = normalizeMetric(monthlyConfig?.kpiMetric ?? campaign.kpiMetric);
    const wDays = Number(monthlyConfig?.workingDays ?? extras[0]?.workingDays ?? 22);
    const configuredDaysLapsed = Number(monthlyConfig?.daysLapsed ?? extras[0]?.daysLapsed ?? 0);

    // ── Fetch ProductionDetail rows for the period ──────────────────────────
    const rawDetails = await prisma.productionDetail.findMany({
      where: {
        campaignId: id,
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
      include: {
        agent: { select: { id: true, name: true, seatNumber: true, monthlyTarget: true } },
        productionEntry: { select: { date: true, periodStart: true, periodEnd: true } },
      },
    });

    const campaignTotals: MetricTotals = {
      transmittals: 0,
      activations: 0,
      approvals: 0,
      booked: 0,
      volume: 0,
      transaction: 0,
    };

    rawDetails.forEach((d) => {
      campaignTotals.transmittals += Number(d.transmittals || 0);
      campaignTotals.activations += Number(d.activations || 0);
      campaignTotals.approvals += Number(d.approvals || 0);
      campaignTotals.booked += Number(d.booked || 0);
      campaignTotals.volume += Number(d.volume || 0);
      campaignTotals.transaction += Number(d.transaction || 0);
    });

    const explicitAgentGoals = rawDetails
      .map((d) => Number(d.agent.monthlyTarget || 0))
      .filter((target) => target > 0);
    const effectiveMetric = resolveEffectiveMetric(configuredMetric, goal, campaignTotals, explicitAgentGoals);
    const workedDates = new Set(rawDetails.map((d) => toBusinessYmd(d.productionEntry.periodEnd ?? d.productionEntry.date)));
    const dLapsed = configuredDaysLapsed > 0 ? configuredDaysLapsed : workedDates.size;

    // Flatten rows — MTD uses volume (peso amounts) matching the OM Dashboard
    const salesRows = rawDetails.map((d) => ({
      date: (d.productionEntry.periodEnd ?? d.productionEntry.date).toISOString(),
      transmittals: Number(d.transmittals),
      activations: Number(d.activations),
      approvals: Number(d.approvals),
      booked: Number(d.booked),
      qualityRate: d.qualityRate,
      conversionRate: d.conversionRate,
      volume: Number(d.volume),
      transaction: Number(d.transaction),
    }));

    // ── Campaign-level KPIs (volume = peso gross transmittals) ──────────────
    const mtd = metricValue(effectiveMetric, campaignTotals);
    const ach = achievement(mtd, goal);
    const rr = runRate(mtd, dLapsed);
    const rrAch = achievement(mtd, goal);

    // ── Weekly breakdown (W1–W4) ────────────────────────────────────────────
    const weekMap = groupByWeek(salesRows as any, effectiveMetric);
    const weeklyData = (["W1", "W2", "W3", "W4", "W5"] as const).map((w) => ({
      week: w,
      value: weekMap[w] ?? 0,
    }));

    // ── Daily trend ─────────────────────────────────────────────────────────
    const dailyMap = new Map<string, number>();
    salesRows.forEach((r) => {
      const key = new Date(r.date).toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number((r as any)[effectiveMetric] ?? 0));
    });
    const dailyTrend = Array.from(dailyMap.entries())
      .sort()
      .map(([date, value]) => ({ date, value }));

    // ── Per-agent breakdown ─────────────────────────────────────────────────
    const agentMap = new Map<
      string,
      { name: string; seatNumber: number | null; totals: MetricTotals; target: number }
    >();

    for (const d of rawDetails) {
      const aid = d.agent.id;
      if (!agentMap.has(aid)) {
        agentMap.set(aid, {
          name: d.agent.name,
          seatNumber: d.agent.seatNumber,
          totals: {
            transmittals: 0,
            activations: 0,
            approvals: 0,
            booked: 0,
            volume: 0,
            transaction: 0,
          },
          target: Number(d.agent.monthlyTarget || 0),
        });
      }
      const agentTotals = agentMap.get(aid)!.totals;
      agentTotals.transmittals += Number(d.transmittals || 0);
      agentTotals.activations += Number(d.activations || 0);
      agentTotals.approvals += Number(d.approvals || 0);
      agentTotals.booked += Number(d.booked || 0);
      agentTotals.volume += Number(d.volume || 0);
      agentTotals.transaction += Number(d.transaction || 0);
    }

    // Fetch per-agent monthly targets
    const agentIds = Array.from(agentMap.keys());
    if (agentIds.length > 0) {
      const agentUsers = await prisma.user.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, monthlyTarget: true },
      });
      for (const u of agentUsers) {
        const entry = agentMap.get(u.id);
        if (entry) entry.target = u.monthlyTarget ?? 0;
      }
    }

    const explicitTargetTotal = Array.from(agentMap.values()).reduce(
      (sum, agent) => sum + (agent.target > 0 ? agent.target : 0),
      0
    );
    const agentsWithoutTargets = Array.from(agentMap.values()).filter((agent) => agent.target <= 0);
    const fallbackGoal =
      agentsWithoutTargets.length > 0 ? Math.max(goal - explicitTargetTotal, 0) / agentsWithoutTargets.length : 0;

    const agentBreakdown = Array.from(agentMap.entries())
      .map(([userId, { name, seatNumber, totals, target }]) => {
        const agentMtd = metricValue(effectiveMetric, totals);
        const agentGoal = target > 0 ? target : fallbackGoal;
        const agentRr = runRate(agentMtd, dLapsed);
        return {
          userId,
          name,
          seatNumber,
          mtd: Math.round(agentMtd),
          goal: agentGoal,
          achievement: achievement(agentMtd, agentGoal),
          runRate: Math.round(agentRr),
          rrAchievement: achievement(agentMtd, agentGoal),
        };
      })
      .sort((a, b) => b.mtd - a.mtd);

    // ── Production entries for the period ───────────────────────────────────
    const rawEntries = await prisma.productionEntry.findMany({
      where: {
        campaignId: id,
        OR: [
          { date: { gte: startDate, lte: endDate } },
          {
            periodStart: { lte: endDate },
            periodEnd: { gte: startDate },
          },
        ],
      },
      include: {
        details: {
          include: { agent: { select: { id: true, name: true, seatNumber: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { date: "desc" },
    });

    const productionEntries = rawEntries.map((entry) => ({
      id: entry.id,
      date: entry.date.toISOString().slice(0, 10),
      time: entry.time,
      createdAt: entry.createdAt.toISOString(),
      details: entry.details.map((d) => ({
        id: d.id,
        agentId: d.agentId,
        agentName: d.agent.name,
        seatNumber: d.agent.seatNumber,
        transmittals: Number(d.transmittals),
        activations: Number(d.activations),
        approvals: Number(d.approvals),
        booked: Number(d.booked),
        volume: Number(d.volume),
        transaction: Number(d.transaction),
      })),
    }));

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        campaignName: campaign.campaignName,
        kpiMetric: effectiveMetric,
        workingDays: wDays,
        daysLapsed: dLapsed,
      },
      kpis: {
        goal,
        mtd: Math.round(mtd),
        achievement: ach,
        runRate: Math.round(rr),
        rrAchievement: rrAch,
        workingDays: wDays,
        daysLapsed: dLapsed,
      },
      weeklyData,
      dailyTrend,
      agentBreakdown,
      productionEntries,
      hasProductionData: rawDetails.length > 0,
      dateRange: {
        start: startDate.toISOString().slice(0, 10),
        end: endDate.toISOString().slice(0, 10),
      },
    });
  } catch (error) {
    console.error("Campaign detail API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/campaigns/[id] ───────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { id } = params;

    const updateData: any = {};
    if (body.campaignName) updateData.campaignName = body.campaignName;
    if (body.goalType) updateData.goalType = body.goalType;
    if (body.monthlyGoal !== undefined) updateData.monthlyGoal = body.monthlyGoal;
    if (body.kpiMetric) updateData.kpiMetric = body.kpiMetric;

    const updated = await prisma.campaign.update({ where: { id }, data: updateData });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update campaign error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/campaigns/[id] ──────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { getServerSession } = await import("next-auth/next");
    const { authOptions } = await import("@/lib/auth");

    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "CEO") {
      return NextResponse.json({ error: "Unauthorized: CEO access required" }, { status: 403 });
    }

    const campaignId = params.id;
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    await prisma.dailySales.deleteMany({ where: { campaignId } });
    await prisma.productionDetail.deleteMany({ where: { productionEntry: { campaignId } } });
    await prisma.productionEntry.deleteMany({ where: { campaignId } });
    await prisma.attendance.deleteMany({ where: { campaignId } });
    await prisma.user.updateMany({ where: { campaignId }, data: { campaignId: null } });
    await prisma.campaign.delete({ where: { id: campaignId } });

    return NextResponse.json({ message: "Campaign deleted successfully" });
  } catch (error) {
    console.error("Delete campaign error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
