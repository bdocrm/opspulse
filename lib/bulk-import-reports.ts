import { prisma } from "@/lib/prisma";

export async function getBulkImportedCampaignIds(scopedCampaignIds?: string[]) {
  if (scopedCampaignIds && scopedCampaignIds.length === 0) return [];

  const campaignFilter = scopedCampaignIds
    ? { campaignId: { in: scopedCampaignIds } }
    : {};

  const [productionImports, metricImports, dashboardImports] = await Promise.all([
    prisma.productionEntry.findMany({
      where: {
        ...campaignFilter,
        importFileName: { not: null },
        details: { some: {} },
      },
      select: { campaignId: true },
      distinct: ["campaignId"],
    }),
    prisma.productionMetricRecord.findMany({
      where: {
        ...campaignFilter,
      },
      select: { campaignId: true },
      distinct: ["campaignId"],
    }),
    prisma.dashboardImportRecord.findMany({
      where: {
        ...campaignFilter,
      },
      select: { campaignId: true },
      distinct: ["campaignId"],
    }),
  ]);

  return Array.from(
    new Set([
      ...productionImports.map((row) => row.campaignId),
      ...metricImports.map((row) => row.campaignId),
      ...dashboardImports.map((row) => row.campaignId),
    ])
  );
}
