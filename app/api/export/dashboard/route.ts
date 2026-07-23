import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { GET as getDashboard } from "@/app/api/dashboard/route";

export async function GET(req: NextRequest) {
  try {
    const dashboardResponse = await getDashboard(req);
    if (!dashboardResponse.ok) return dashboardResponse;
    const dashboard = await dashboardResponse.json();
    const rows = (dashboard.campaignTable || []).map((campaign: any) => ({
      Campaign: campaign.campaignName,
      "KPI Metric": campaign.kpiMetric,
      Goal: campaign.goal ?? "Goal missing",
      MTD: campaign.mtd ?? "No data",
      "Achievement %": campaign.achievement == null ? "N/A" : Number(campaign.achievement).toFixed(1),
      "Run Rate": campaign.runRate ?? "N/A",
      "RR Achievement %": campaign.rrAchievement == null ? "N/A" : Number(campaign.rrAchievement).toFixed(1),
      Status: campaign.dataStatus,
    }));

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
