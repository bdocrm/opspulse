import { prisma } from '../lib/prisma';

const CLASSIFICATION_NAMES = [
  'OLD',
  'SEMI OLD',
  'NEW',
  'OLD AVERAGE PER AGENT',
  'SEMI OLD AVERAGE PER AGENT',
  'NEW AVERAGE PER AGENT',
  'TOTAL AVERAGE PER AGENT',
];
const apply = process.argv.includes('--apply');

async function main() {
  const where = {
    worksheetSource: 'PL YTD Productivity',
    monitoringType: 'PL_PRODUCTIVITY',
    entityName: { in: CLASSIFICATION_NAMES },
  } as const;

  const rows = await prisma.dashboardImportRecord.findMany({
    where,
    select: { id: true, batchId: true, campaignId: true, entityName: true },
  });
  const campaignIds = [...new Set(rows.map((row) => row.campaignId))];
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, campaignName: true },
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'audit',
    matchedRecords: rows.length,
    labels: Object.fromEntries(CLASSIFICATION_NAMES.map((name) => [name, rows.filter((row) => row.entityName === name).length])),
    campaigns,
  }, null, 2));

  if (!apply || rows.length === 0) return;

  const batchIds = [...new Set(rows.map((row) => row.batchId))];
  await prisma.$transaction(async (tx) => {
    await tx.dashboardImportRecord.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    for (const batchId of batchIds) {
      const insertedCount = await tx.dashboardImportRecord.count({ where: { batchId } });
      await tx.dashboardImportBatch.update({ where: { id: batchId }, data: { insertedCount } });
    }
  });

  const remaining = await prisma.dashboardImportRecord.count({ where });
  console.log(JSON.stringify({ deletedRecords: rows.length, updatedBatches: batchIds.length, remaining }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
