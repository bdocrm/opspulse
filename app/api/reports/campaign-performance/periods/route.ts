import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== "CEO" && user.role !== "OM") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedCampaignIds =
      user.role === "CEO"
        ? null
        : Array.from(
            new Set(
              [
                user.campaignId,
                ...(Array.isArray(user.campaignIds) ? user.campaignIds : []),
              ].filter(Boolean) as string[]
            )
          );
    const campaignWhere = scopedCampaignIds
      ? { campaignId: { in: scopedCampaignIds } }
      : {};
    const [productionImports, metricImports, dashboardImports] = await Promise.all([
      prisma.productionEntry.findMany({
        where: {
          ...campaignWhere,
          importFileName: { not: null },
          details: { some: {} },
        },
        select: { date: true, periodEnd: true },
      }),
      prisma.productionMetricRecord.findMany({
        where: {
          ...campaignWhere,
          reportMonth: { not: null },
        },
        select: { reportYear: true, reportMonth: true },
      }),
      prisma.dashboardImportRecord.findMany({
        where: campaignWhere,
        select: { year: true, month: true, reportDate: true },
      }),
    ]);

    const periodKeys = new Set<string>();
    productionImports.forEach((row) => {
      const periodDate = row.periodEnd ?? row.date;
      periodKeys.add(`${periodDate.getFullYear()}-${periodDate.getMonth() + 1}`);
    });
    metricImports.forEach((row) => {
      if (row.reportMonth != null) {
        periodKeys.add(`${row.reportYear}-${row.reportMonth}`);
      }
    });
    dashboardImports.forEach((row) => {
      periodKeys.add(`${row.year}-${row.month ?? row.reportDate.getMonth() + 1}`);
    });

    const periods = Array.from(periodKeys)
      .map((key) => {
        const [year, month] = key.split("-").map(Number);
        return { year, month };
      })
      .sort((a, b) => b.year - a.year || b.month - a.month);

    return NextResponse.json({ periods });
  } catch (error) {
    console.error("Campaign performance periods error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
