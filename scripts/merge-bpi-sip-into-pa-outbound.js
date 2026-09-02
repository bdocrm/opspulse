const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SOURCE_NAME = 'BPI SIP LOANS';
const TARGET_NAME = 'BPI PA OUTBOUND';

async function countRows(tx, table, campaignId, column = 'campaignId') {
  const rows = await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${column}" = $1`,
    campaignId,
  );
  return rows[0].count;
}

async function main() {
  const source = await prisma.campaign.findFirst({ where: { campaignName: SOURCE_NAME } });
  const target = await prisma.campaign.findFirst({ where: { campaignName: TARGET_NAME } });
  if (!target) throw new Error(`${TARGET_NAME} does not exist.`);
  if (!source) {
    console.log(JSON.stringify({ status: 'already_merged', targetCampaignId: target.id }, null, 2));
    return;
  }
  if (source.id === target.id) throw new Error('Source and target campaigns resolve to the same ID.');

  const result = await prisma.$transaction(async (tx) => {
    const sourceRecords = await countRows(tx, 'DashboardImportRecord', source.id);
    const targetRecordsBefore = await countRows(tx, 'DashboardImportRecord', target.id);
    const sourceBatches = await countRows(tx, 'DashboardImportBatch', source.id);
    const sourceAssignments = await countRows(tx, 'UserCampaign', source.id);

    const unexpectedTables = [
      ['Attendance', 'campaignId'], ['BusinessUnit', 'campaignId'], ['BusinessUnitAlias', 'campaignId'],
      ['CampaignAlias', 'campaignId'], ['CampaignGoal', 'campaignId'], ['CampaignMetric', 'campaignId'],
      ['CollectorKpiRecord', 'campaignId'], ['DailySales', 'campaignId'], ['KpiImportBatch', 'campaignId'],
      ['ProductionDetail', 'campaignId'], ['ProductionEntry', 'campaignId'], ['ProductionMetricRecord', 'campaignId'],
      ['ProductionMonitoring', 'campaignId'], ['User', 'campaignId'], ['CampaignMapping', 'opsviewCampaignId'],
    ];
    for (const [table, column] of unexpectedTables) {
      const count = await countRows(tx, table, source.id, column);
      if (count > 0) throw new Error(`Refusing merge: ${table}.${column} still has ${count} source rows.`);
    }

    const deletedDuplicates = await tx.$executeRawUnsafe(`
      DELETE FROM "DashboardImportRecord" target_record
      USING "DashboardImportRecord" source_record
      WHERE target_record."campaignId" = $2
        AND source_record."campaignId" = $1
        AND target_record."worksheetSource" = source_record."worksheetSource"
        AND target_record."recordKind" = source_record."recordKind"
        AND target_record."entityName" = source_record."entityName"
        AND target_record."category" = source_record."category"
        AND target_record."product" = source_record."product"
        AND target_record."metric" = source_record."metric"
        AND target_record."year" = source_record."year"
        AND target_record."month" IS NOT DISTINCT FROM source_record."month"
        AND target_record."reportPeriodType" = source_record."reportPeriodType"
    `, source.id, target.id);

    const movedRecords = await tx.$executeRawUnsafe(
      'UPDATE "DashboardImportRecord" SET "campaignId" = $2 WHERE "campaignId" = $1',
      source.id,
      target.id,
    );
    const movedBatches = await tx.$executeRawUnsafe(`
      UPDATE "DashboardImportBatch"
      SET "campaignId" = $2,
          "selectedCampaignIds" = REPLACE(COALESCE("selectedCampaignIds", ''), $1, $2)
      WHERE "campaignId" = $1
    `, source.id, target.id);

    const removedDuplicateAssignments = await tx.$executeRawUnsafe(`
      DELETE FROM "UserCampaign" source_assignment
      USING "UserCampaign" target_assignment
      WHERE source_assignment."campaignId" = $1
        AND target_assignment."campaignId" = $2
        AND source_assignment."userId" = target_assignment."userId"
    `, source.id, target.id);
    const movedAssignments = await tx.$executeRawUnsafe(
      'UPDATE "UserCampaign" SET "campaignId" = $2 WHERE "campaignId" = $1',
      source.id,
      target.id,
    );

    await tx.campaign.update({
      where: { id: target.id },
      data: { kpiMetric: 'volume' },
    });
    await tx.$executeRawUnsafe(
      'UPDATE "CampaignGoal" SET "kpiMetric" = \'volume\' WHERE "campaignId" = $1',
      target.id,
    );
    await tx.campaign.delete({ where: { id: source.id } });
    await tx.campaignAlias.upsert({
      where: { normalizedAlias: 'BPI SIP LOANS' },
      update: { campaignId: target.id, alias: SOURCE_NAME },
      create: { campaignId: target.id, alias: SOURCE_NAME, normalizedAlias: 'BPI SIP LOANS' },
    });

    const targetRecordsAfter = await countRows(tx, 'DashboardImportRecord', target.id);
    return {
      sourceRecords,
      targetRecordsBefore,
      deletedDuplicates,
      movedRecords,
      sourceBatches,
      movedBatches,
      sourceAssignments,
      removedDuplicateAssignments,
      movedAssignments,
      targetRecordsAfter,
    };
  }, { timeout: 30_000 });

  console.log(JSON.stringify({
    status: 'merged',
    sourceCampaignId: source.id,
    targetCampaignId: target.id,
    ...result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

