import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupByWeek } from "@/utils/kpi";

/** Achievement = (MTD / Goal) × 100 */
function achievement(mtd: number, goal: number): number {
  if (goal === 0) return 0;
  return (mtd / goal) * 100;
}

/** Run Rate = (MTD / Days Lapsed) × Working Days */
function runRate(mtd: number, daysLapsed: number, workingDays: number): number {
  if (daysLapsed === 0) return 0;
  return (mtd / daysLapsed) * workingDays;
}

/** Run Rate Achievement = (Run Rate / Goal) × 100 */
function rrAchievement(rr: number, goal: number): number {
  if (goal === 0) return 0;
  return (rr / goal) * 100;
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

    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);

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

    const wDays = Number(extras[0]?.workingDays ?? 22);
    const dLapsed = Number(extras[0]?.daysLapsed ?? 0);

    // ── Fetch ProductionDetail rows for the period ──────────────────────────
    const rawDetails = await prisma.productionDetail.findMany({
      where: {
        campaignId: id,
        productionEntry: { date: { gte: startDate, lte: endDate } },
      },
      include: {
        agent: { select: { id: true, name: true, seatNumber: true } },
        productionEntry: { select: { date: true } },
      },
    });

    // Flatten rows — MTD uses volume (peso amounts) matching the OM Dashboard
    const salesRows = rawDetails.map((d) => ({
      date: d.productionEntry.date.toISOString(),
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
    const mtd = salesRows.reduce((sum, r) => sum + r.volume, 0);
    const ach = achievement(mtd, campaign.monthlyGoal);
    const rr = runRate(mtd, dLapsed, wDays);
    const rrAch = rrAchievement(rr, campaign.monthlyGoal);

    // ── Weekly breakdown (W1–W4) ────────────────────────────────────────────
    const weekMap = groupByWeek(salesRows as any, "volume");
    const weeklyData = (["W1", "W2", "W3", "W4"] as const).map((w) => ({
      week: w,
      value: weekMap[w] ?? 0,
    }));

    // ── Daily trend ─────────────────────────────────────────────────────────
    const dailyMap = new Map<string, number>();
    salesRows.forEach((r) => {
      const key = new Date(r.date).toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + r.volume);
    });
    const dailyTrend = Array.from(dailyMap.entries())
      .sort()
      .map(([date, value]) => ({ date, value }));

    // ── Per-agent breakdown ─────────────────────────────────────────────────
    const agentMap = new Map<
      string,
      { name: string; seatNumber: number | null; mtd: number; target: number }
    >();

    for (const d of rawDetails) {
      const aid = d.agent.id;
      if (!agentMap.has(aid)) {
        agentMap.set(aid, {
          name: d.agent.name,
          seatNumber: d.agent.seatNumber,
          mtd: 0,
          target: 0,
        });
      }
      agentMap.get(aid)!.mtd += Number(d.volume);
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

    const agentBreakdown = Array.from(agentMap.entries())
      .map(([userId, { name, seatNumber, mtd: agentMtd, target }]) => {
        const agentGoal = target > 0 ? target : campaign.monthlyGoal;
        const agentRr = runRate(agentMtd, dLapsed, wDays);
        return {
          userId,
          name,
          seatNumber,
          mtd: Math.round(agentMtd),
          goal: agentGoal,
          achievement: achievement(agentMtd, agentGoal),
          runRate: Math.round(agentRr),
          rrAchievement: rrAchievement(agentRr, agentGoal),
        };
      })
      .sort((a, b) => b.mtd - a.mtd);

    // ── Production entries for the period ───────────────────────────────────
    const rawEntries = await prisma.productionEntry.findMany({
      where: { campaignId: id, date: { gte: startDate, lte: endDate } },
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
        kpiMetric: campaign.kpiMetric,
        workingDays: wDays,
        daysLapsed: dLapsed,
      },
      kpis: {
        goal: campaign.monthlyGoal,
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
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { getServerSession } = await import("next-auth/next");
    const { authOptions } = await import("@/lib/auth");

    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "CEO") {
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
