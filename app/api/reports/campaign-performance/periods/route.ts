import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const BUSINESS_TIME_ZONE = "Asia/Manila";

function businessPeriod(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(value);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

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
        where: {
          ...campaignWhere,
          recordKind: { in: ["agent_monitoring", "ytd"] },
        },
        select: { year: true, month: true, reportDate: true },
      }),
    ]);

    const periodKeys = new Set<string>();
    productionImports.forEach((row) => {
      const periodDate = row.periodEnd ?? row.date;
      const period = businessPeriod(periodDate);
      periodKeys.add(`${period.year}-${period.month}`);
    });
    metricImports.forEach((row) => {
      if (row.reportMonth != null) {
        periodKeys.add(`${row.reportYear}-${row.reportMonth}`);
      }
    });
    dashboardImports.forEach((row) => {
      const period = row.month == null ? businessPeriod(row.reportDate) : { year: row.year, month: row.month };
      periodKeys.add(`${period.year}-${period.month}`);
    });

    const periods = Array.from(periodKeys)
      .map((key) => {
        const [year, month] = key.split("-").map(Number);
        return { year, month };
      })
      .sort((a, b) => b.year - a.year || b.month - a.month);

    return NextResponse.json({ periods }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error("Campaign performance periods error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
