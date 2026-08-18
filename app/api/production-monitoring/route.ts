import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canViewProduction,
  getProductionSessionUser,
  hasProductionCampaignAccess,
  productionCampaignScope,
} from "@/lib/production-access";
import { getProductionStatus } from "@/lib/production-metrics";

const SORT_FIELDS = new Set(["campaign", "businessUnit", "target", "mtd", "achievement", "runRate", "dateUpdated"]);
const STATUS_VALUES = new Set(["ON_TRACK", "NEAR_TARGET", "AT_RISK", "BELOW_TARGET", "NO_DATA"]);

function statusWhere(status: string | null): Prisma.ProductionMonitoringWhereInput {
  if (!status || !STATUS_VALUES.has(status)) return {};
  if (status === "ON_TRACK") return { achievement: { gte: 1 } };
  if (status === "NEAR_TARGET") return { achievement: { gte: 0.9, lt: 1 } };
  if (status === "AT_RISK") return { achievement: { gte: 0.75, lt: 0.9 } };
  if (status === "BELOW_TARGET") return { achievement: { lt: 0.75 } };
  return { achievement: null };
}

function recordOrder(sortBy: string, direction: Prisma.SortOrder): Prisma.ProductionMonitoringOrderByWithRelationInput[] {
  if (sortBy === "campaign") return [{ campaign: { campaignName: direction } }, { businessUnit: { businessUnitName: "asc" } }];
  if (sortBy === "businessUnit") return [{ businessUnit: { businessUnitName: direction } }];
  if (["target", "mtd", "achievement", "runRate", "dateUpdated"].includes(sortBy)) {
    return [{ [sortBy]: direction } as Prisma.ProductionMonitoringOrderByWithRelationInput];
  }
  return [{ campaign: { campaignName: "asc" } }, { businessUnit: { businessUnitName: "asc" } }];
}

export async function GET(request: NextRequest) {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const month = Number(params.get("month"));
  const year = Number(params.get("year"));
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Choose a valid reporting month and year." }, { status: 400 });
  }
  const campaignId = params.get("campaignId")?.trim() || null;
  if (campaignId && !hasProductionCampaignAccess(user, campaignId)) return NextResponse.json({ error: "You do not have access to that campaign." }, { status: 403 });
  const businessUnitId = params.get("businessUnitId")?.trim() || null;
  const metricType = params.get("metricType")?.trim().toLowerCase() || null;
  const search = params.get("search")?.trim().slice(0, 100) || null;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("limit")) || 25));
  const sortBy = SORT_FIELDS.has(params.get("sortBy") || "") ? params.get("sortBy") as string : "campaign";
  const sortDirection: Prisma.SortOrder = params.get("sortDirection") === "desc" ? "desc" : "asc";
  const and: Prisma.ProductionMonitoringWhereInput[] = [
    productionCampaignScope(user),
    statusWhere(params.get("status")),
  ];
  if (campaignId) and.push({ campaignId });
  if (businessUnitId) and.push({ businessUnitId });
  if (metricType && metricType !== "all") and.push({ metricType });
  if (search) and.push({ OR: [
    { campaign: { campaignName: { contains: search, mode: "insensitive" } } },
    { businessUnit: { businessUnitName: { contains: search, mode: "insensitive" } } },
  ] });
  const where: Prisma.ProductionMonitoringWhereInput = { reportYear: year, reportMonth: month, AND: and };
  const [total, records, summaryRows] = await prisma.$transaction([
    prisma.productionMonitoring.count({ where }),
    prisma.productionMonitoring.findMany({
      where,
      include: { campaign: { select: { id: true, campaignName: true } }, businessUnit: { select: { id: true, businessUnitName: true } } },
      orderBy: recordOrder(sortBy, sortDirection),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.productionMonitoring.findMany({ where, select: { campaignId: true, businessUnitId: true, metricType: true, target: true, mtd: true, achievement: true } }),
  ]);
  const metricGroups = new Map<string, typeof summaryRows>();
  for (const row of summaryRows) metricGroups.set(row.metricType, [...(metricGroups.get(row.metricType) ?? []), row]);
  const metricSummaries = [...metricGroups.entries()].map(([type, rows]) => {
    const targets = rows.map((row) => row.target).filter((value): value is number => value != null);
    const mtdValues = rows.map((row) => row.mtd).filter((value): value is number => value != null);
    const achievements = rows.map((row) => row.achievement).filter((value): value is number => value != null);
    const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      metricType: type,
      recordCount: rows.length,
      target: type === "percentage" || type === "ratio" ? average(targets) : targets.reduce((sum, value) => sum + value, 0),
      mtd: type === "percentage" || type === "ratio" ? average(mtdValues) : mtdValues.reduce((sum, value) => sum + value, 0),
      averageAchievement: average(achievements),
    };
  });
  const statusCounts = { ON_TRACK: 0, NEAR_TARGET: 0, AT_RISK: 0, BELOW_TARGET: 0, NO_DATA: 0 };
  summaryRows.forEach((row) => { statusCounts[getProductionStatus(row.achievement)] += 1; });
  return NextResponse.json({
    records: records.map((record) => ({
      id: record.id,
      campaignId: record.campaignId,
      campaignName: record.campaign.campaignName,
      businessUnitId: record.businessUnitId,
      businessUnitName: record.businessUnit.businessUnitName,
      reportYear: record.reportYear,
      reportMonth: record.reportMonth,
      metricType: record.metricType,
      metricUnit: record.metricUnit,
      target: record.target,
      week1: record.week1,
      week2: record.week2,
      week3: record.week3,
      week4: record.week4,
      week5: record.week5,
      mtd: record.mtd,
      achievement: record.achievement,
      runRate: record.runRate,
      workingDays: record.workingDays,
      daysLapse: record.daysLapse,
      dateUpdated: record.dateUpdated?.toISOString() ?? null,
      status: getProductionStatus(record.achievement),
    })),
    summary: {
      campaigns: new Set(summaryRows.map((row) => row.campaignId)).size,
      businessUnits: new Set(summaryRows.map((row) => row.businessUnitId)).size,
      records: summaryRows.length,
      statusCounts,
      metricSummaries,
    },
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
