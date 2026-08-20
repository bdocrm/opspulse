import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { summarizeProductionMonitoringForDashboard } from "../lib/production-monitoring-dashboard";
import { normalizeProductionName } from "../lib/production-normalization";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.productionMonitoring.findMany({
    where: { reportYear: 2026, reportMonth: 8 },
    select: {
      campaignId: true,
      sourceAccount: true,
      sourceCampaign: true,
      reportYear: true,
      reportMonth: true,
      metricType: true,
      target: true,
      mtd: true,
      updatedAt: true,
      campaign: { select: { campaignName: true } },
    },
    orderBy: [{ sourceAccount: "asc" }, { sourceCampaign: "asc" }],
  });
  const summaries = summarizeProductionMonitoringForDashboard(rows);
  const medicardRows = rows.filter((row) => normalizeProductionName(row.sourceAccount) === "MEDICARD");
  const onlineRows = rows.filter((row) => normalizeProductionName(row.sourceCampaign) === "ONLINE");

  assert.ok(medicardRows.length > 1, "verification requires multiple MEDICARD source campaigns");
  assert.equal(new Set(medicardRows.map((row) => row.sourceCampaign)).size, new Set(medicardRows.map((row) => row.campaignId)).size, "every distinct MEDICARD source campaign must have one distinct campaign ID");
  assert.equal(medicardRows.some((row) => row.campaign.campaignName === "MEDICARD"), false, "no MEDICARD child may remain collapsed into the parent");
  assert.ok(onlineRows.length > 0, "Online source data must exist for verification");
  assert.equal(new Set(onlineRows.map((row) => row.campaign.campaignName)).size, 1);
  assert.equal(onlineRows[0].campaign.campaignName, "BDO Online");

  for (const row of rows) {
    const summary = summaries.get(row.campaignId);
    assert.ok(summary, `dashboard summary missing ${row.campaign.campaignName}`);
    assert.equal(summary?.goal, row.target, `goal mismatch for ${row.campaign.campaignName}`);
    assert.equal(summary?.actual, row.mtd, `actual mismatch for ${row.campaign.campaignName}`);
  }

  const duplicateNames = await prisma.$queryRaw<Array<{ normalized: string; count: number }>>`
    SELECT UPPER(REGEXP_REPLACE(TRIM("campaignName"), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized,
           COUNT(*)::int AS count
    FROM "Campaign"
    GROUP BY 1
    HAVING COUNT(*) > 1
  `;
  assert.deepEqual(duplicateNames, [], "normalized duplicate campaign records are not allowed");

  const medicardCampaigns = await prisma.campaign.findMany({
    where: { campaignName: { startsWith: "MEDICARD " } },
    select: { id: true, campaignName: true, _count: { select: { productionMonitoringRecords: true, userAssignments: true } } },
    orderBy: { campaignName: "asc" },
  });
  assert.equal(medicardCampaigns.length, 9);
  assert.ok(medicardCampaigns.every((campaign) => campaign._count.productionMonitoringRecords > 0));
  assert.ok(medicardCampaigns.every((campaign) => campaign._count.userAssignments > 0), "collector access must be inherited by dynamic campaigns");
  const medicardMappings = await prisma.campaignMapping.findMany({
    where: { normalizedSourceAccount: "MEDICARD", status: "ACTIVE" },
    select: { normalizedSourceCampaign: true, opsviewCampaignId: true },
  });
  assert.equal(medicardMappings.length, 9, "future imports need one active saved mapping per MEDICARD source campaign");
  assert.equal(new Set(medicardMappings.map((mapping) => mapping.opsviewCampaignId)).size, 9);

  console.log(JSON.stringify({
    period: "2026-08",
    sourceRows: rows.length,
    dashboardCampaignCards: summaries.size,
    medicardSourceCampaigns: medicardRows.length,
    medicardCampaignIds: new Set(medicardRows.map((row) => row.campaignId)).size,
    onlineCampaign: onlineRows[0].campaign.campaignName,
    cards: rows.map((row) => ({
      source: `${row.sourceAccount} / ${row.sourceCampaign}`,
      campaignId: row.campaignId,
      campaign: row.campaign.campaignName,
      goal: summaries.get(row.campaignId)?.goal,
      actual: summaries.get(row.campaignId)?.actual,
      records: summaries.get(row.campaignId)?.recordCount,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
