import { prisma } from "@/lib/prisma";

const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

export function bulkImportMonthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

export async function getBulkImportedCampaignIds(
  year: number,
  month: number,
  scopedCampaignIds?: string[]
) {
  if (scopedCampaignIds && scopedCampaignIds.length === 0) return [];

  const { start, end } = bulkImportMonthRange(year, month);
  const campaignFilter = scopedCampaignIds
    ? { campaignId: { in: scopedCampaignIds } }
    : {};

  const [productionImports, metricImports, dashboardImports] = await Promise.all([
    prisma.productionEntry.findMany({
      where: {
        ...campaignFilter,
        importFileName: { not: null },
        details: { some: {} },
        OR: [
          { date: { gte: start, lte: end } },
          {
            periodStart: { lte: end },
            periodEnd: { gte: start },
          },
        ],
      },
      select: { campaignId: true },
      distinct: ["campaignId"],
    }),
    prisma.productionMetricRecord.findMany({
      where: {
        ...campaignFilter,
        reportYear: year,
        reportMonth: month,
      },
      select: { campaignId: true },
      distinct: ["campaignId"],
    }),
    prisma.dashboardImportRecord.findMany({
      where: {
        ...campaignFilter,
        year,
        OR: [
          { month },
          {
            month: null,
            reportDate: { gte: start, lte: end },
          },
        ],
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
