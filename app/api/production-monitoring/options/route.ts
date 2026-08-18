import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, canViewProduction, getProductionSessionUser, productionCampaignScope } from "@/lib/production-access";

export async function GET() {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = productionCampaignScope(user);
  const [campaigns, businessUnits, periods, metricTypes] = await prisma.$transaction([
    prisma.campaign.findMany({
      where: { isActive: true, ...(scope.campaignId ? { id: scope.campaignId } : {}) },
      select: { id: true, campaignName: true },
      orderBy: { campaignName: "asc" },
    }),
    prisma.businessUnit.findMany({
      where: { isActive: true, ...(scope.campaignId ? { campaignId: scope.campaignId } : {}) },
      select: { id: true, campaignId: true, businessUnitName: true },
      orderBy: [{ campaign: { campaignName: "asc" } }, { businessUnitName: "asc" }],
    }),
    prisma.productionMonitoring.findMany({
      where: scope,
      distinct: ["reportYear", "reportMonth"],
      select: { reportYear: true, reportMonth: true },
      orderBy: [{ reportYear: "desc" }, { reportMonth: "desc" }],
    }),
    prisma.productionMetricTypeConfig.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
  ]);
  return NextResponse.json({ campaigns, businessUnits, periods, metricTypes, canAdmin: canAdminProduction(user) });
}
