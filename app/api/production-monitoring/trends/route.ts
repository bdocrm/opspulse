import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewProduction, getProductionSessionUser, productionCampaignScope } from "@/lib/production-access";

export async function GET(request: NextRequest) {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const businessUnitId = request.nextUrl.searchParams.get("businessUnitId")?.trim();
  if (!businessUnitId) return NextResponse.json({ error: "Business unit is required." }, { status: 400 });
  const metricType = request.nextUrl.searchParams.get("metricType")?.trim().toLowerCase();
  const records = await prisma.productionMonitoring.findMany({
    where: { businessUnitId, ...(metricType ? { metricType } : {}), ...productionCampaignScope(user) },
    include: { campaign: { select: { id: true, campaignName: true } }, businessUnit: { select: { id: true, businessUnitName: true } } },
    orderBy: [{ reportYear: "asc" }, { reportMonth: "asc" }],
    take: 120,
  });
  if (!records.length) return NextResponse.json({ records: [] });
  return NextResponse.json({
    campaign: records[0].campaign,
    businessUnit: records[0].businessUnit,
    records: records.map((record) => ({
      id: record.id, reportYear: record.reportYear, reportMonth: record.reportMonth,
      metricType: record.metricType, metricUnit: record.metricUnit, target: record.target,
      week1: record.week1, week2: record.week2, week3: record.week3, week4: record.week4, week5: record.week5,
      mtd: record.mtd, achievement: record.achievement, runRate: record.runRate,
      workingDays: record.workingDays, daysLapse: record.daysLapse, dateUpdated: record.dateUpdated?.toISOString() ?? null,
    })),
  });
}
