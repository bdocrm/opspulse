import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";
import {
  computeMTD,
  achievementPct,
  daysLapsed,
  runRate,
  rrAchievementPct,
  WORKING_DAYS_DEFAULT,
  type KpiMetricKey,
} from "@/utils/kpi";

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const campaigns = await prisma.campaign.findMany({
      include: {
        dailySales: {
          where: { date: { gte: startDate, lte: endDate } },
        },
      },
    });

    const rows = campaigns.map((c) => {
      const metric = c.kpiMetric as KpiMetricKey;
      const salesRows = c.dailySales.map((s) => ({
        date: s.date.toISOString(),
        transmittals: Number(s.transmittals),
        activations: Number(s.activations),
        approvals: Number(s.approvals),
        booked: Number(s.booked),
        qualityRate: s.qualityRate,
        conversionRate: s.conversionRate,
      }));
      const mtd = computeMTD(salesRows, metric);
      const elapsed = daysLapsed(salesRows);
      const rr = runRate(mtd, elapsed, WORKING_DAYS_DEFAULT);
      const ach = achievementPct(mtd, c.monthlyGoal);
      const rrAch = rrAchievementPct(rr, c.monthlyGoal);

      return {
        Campaign: c.campaignName,
        "KPI Metric": c.kpiMetric,
        Goal: c.monthlyGoal,
        MTD: Math.round(mtd),
        "Achievement %": ach.toFixed(1),
        "Run Rate": Math.round(rr),
        "RR Achievement %": rrAch.toFixed(1),
      };
    });

    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="dashboard_export.csv"',
      },
    });
  } catch (error) {
    console.error("Export dashboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
