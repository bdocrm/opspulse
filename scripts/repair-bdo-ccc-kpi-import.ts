import * as fs from "fs";
import { PrismaClient } from "@prisma/client";
import { calculateKpiAchievements } from "../lib/kpi-performance";
import { parseKpiWorkbook } from "../lib/kpi-workbook";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const workbookPath = process.argv.find((argument) => /\.xlsx?$/i.test(argument));
  if (!workbookPath || !fs.existsSync(workbookPath)) {
    throw new Error("Pass the existing BDO CCC KPI workbook path.");
  }

  const originalFileName = workbookPath.replace(/\\/g, "/").split("/").at(-1)!;
  const [batch, targetCampaign] = await Promise.all([
    prisma.kpiImportBatch.findFirst({
      where: { originalFileName },
      orderBy: { createdAt: "desc" },
    }),
    prisma.campaign.findFirst({
      where: { campaignName: { equals: "BDO CCC", mode: "insensitive" } },
    }),
  ]);
  if (!batch || !targetCampaign) {
    throw new Error("The source import batch or BDO CCC campaign was not found.");
  }

  const records = await prisma.collectorKpiRecord.findMany({
    where: { importBatchId: batch.id },
  });
  const parsed = parseKpiWorkbook(
    fs.readFileSync(workbookPath),
    originalFileName,
    batch.periodEnd?.getFullYear() || new Date().getFullYear()
  );
  const parsedBySource = new Map(
    parsed.records.map((record) => [`${record.sourceSheet}|${record.sourceRow}`, record])
  );
  const missing = records.filter(
    (record) => !parsedBySource.has(`${record.sourceSheet}|${record.sourceRow}`)
  );
  const employeeIds = [...new Set(records.map((record) => record.employeeId))];
  const [productionDetails, productionMetrics, targetRecords, targetAgents] = await Promise.all([
    prisma.productionDetail.count({ where: { agentId: { in: employeeIds } } }),
    prisma.productionMetricRecord.count({ where: { agentId: { in: employeeIds } } }),
    prisma.collectorKpiRecord.count({ where: { campaignId: targetCampaign.id } }),
    prisma.user.count({ where: { campaignId: targetCampaign.id, role: "AGENT" } }),
  ]);

  const audit = {
    mode: apply ? "apply" : "dry-run",
    sourceBatchId: batch.id,
    sourceCampaignId: batch.campaignId,
    targetCampaignId: targetCampaign.id,
    importedRecords: records.length,
    importedAgents: employeeIds.length,
    parsedRows: parsed.records.length,
    unmatchedSourceRows: missing.length,
    productionDetails,
    productionMetrics,
    existingTargetRecords: targetRecords,
    existingTargetAgents: targetAgents,
  };
  console.log(JSON.stringify(audit, null, 2));

  if (!apply) return;
  if (batch.campaignId === targetCampaign.id) {
    throw new Error("The import batch is already assigned to BDO CCC.");
  }
  if (missing.length || productionDetails || productionMetrics || targetRecords || targetAgents) {
    throw new Error("Safety checks failed; no database changes were made.");
  }

  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      const parsedRecord = parsedBySource.get(`${record.sourceSheet}|${record.sourceRow}`)!;
      const achievements = calculateKpiAchievements(parsedRecord);
      await tx.collectorKpiRecord.update({
        where: { id: record.id },
        data: {
          campaignId: targetCampaign.id,
          ...achievements,
        },
      });
    }
    await tx.kpiImportBatch.update({
      where: { id: batch.id },
      data: { campaignId: targetCampaign.id },
    });
    await tx.user.updateMany({
      where: {
        id: { in: employeeIds },
        campaignId: batch.campaignId,
        role: "AGENT",
      },
      data: { campaignId: targetCampaign.id },
    });
  }, { timeout: 120_000 });

  console.log("BDO CCC KPI import reassigned and exact Excel ACVT percentages restored.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
