import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, canViewProduction, getProductionSessionUser, productionCampaignScope, productionCampaignIds } from "@/lib/production-access";
import { memoize } from "@/lib/cache";

// Dropdown/options payload. Changes rarely, so a short server-side TTL avoids
// recomputing these four queries on every autofill/picker interaction.
const OPTIONS_TTL_MS = 30_000;

export async function GET() {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = productionCampaignScope(user);

  const campaignIds = productionCampaignIds(user).slice().sort();
  const cacheKey = `pm-options:${user.id}:${campaignIds.join(",")}`;

  const data = await memoize(cacheKey, OPTIONS_TTL_MS, async () => {
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
    return { campaigns, businessUnits, periods, metricTypes };
  });

  return NextResponse.json({ ...data, canAdmin: canAdminProduction(user) });
}
