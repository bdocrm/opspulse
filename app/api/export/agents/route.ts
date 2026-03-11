import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";
import {
  achievementPct,
  runRate,
  rrAchievementPct,
  WORKING_DAYS_DEFAULT,
} from "@/utils/kpi";

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const sales = await prisma.dailySales.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: {
        user: { select: { name: true, seatNumber: true } },
        campaign: { select: { kpiMetric: true, monthlyGoal: true } },
      },
    });

    const uniqueDates = new Set(sales.map((s) => s.date.toISOString().slice(0, 10)));
    const elapsed = uniqueDates.size;

    const agentMap = new Map<
      string,
      { name: string; seat: number | null; mtd: number; goal: number }
    >();

    sales.forEach((s) => {
      const metric = s.campaign.kpiMetric;
      const val = Number((s as any)[metric] ?? 0);
      const existing = agentMap.get(s.userId) ?? {
        name: s.user.name,
        seat: s.user.seatNumber,
        mtd: 0,
        goal: s.campaign.monthlyGoal,
      };
      existing.mtd += val;
      agentMap.set(s.userId, existing);
    });

    const rows = Array.from(agentMap.entries())
      .map(([_, a]) => {
        const rr = runRate(a.mtd, elapsed, WORKING_DAYS_DEFAULT);
        return {
          Agent: a.name,
          Seat: a.seat ?? "",
          MTD: Math.round(a.mtd),
          "Achievement %": achievementPct(a.mtd, a.goal).toFixed(1),
          "Run Rate": Math.round(rr),
          "RR Achievement %": rrAchievementPct(rr, a.goal).toFixed(1),
        };
      })
      .sort((a, b) => b.MTD - a.MTD);

    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="agents_export.csv"',
      },
    });
  } catch (error) {
    console.error("Export agents error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
