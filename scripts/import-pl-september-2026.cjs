// Narrow, source-preserving repair. Preview by default; --apply writes only
// BPI PL September 2026, and refuses existing production for that period.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const { parseFile } = require('../lib/smart-import/parser');
const { reconcile } = require('../lib/smart-import/reconciliation');
const { compressRawRow, unpackRawRow } = require('../lib/smart-import/raw-storage');
const db = new PrismaClient({ log: [] });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
async function main() {
  const source = process.argv[2];
  assert(source, 'Pass the source workbook path');
  const bytes = fs.readFileSync(source), fileName = path.basename(source);
  assert.equal(fileName, 'ALLIANZ_BPI PL_YTD BOOKED VOLUME REPORT.xlsx');
  const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Sheet1']);
  const sheet = workbook.Sheets.Sheet1;
  assert.equal(sheet.B3.v, 'AGENT NAME');
  assert.equal(sheet.L3.v, 'Sep');
  assert.match(sheet.C3.v, /2026/);
  assert.equal(sheet.B136.v, 'Grand Total');
  assert.equal(sheet.O14.v, 'Sep');
  assert.equal(sheet.P14.v, 656);
  assert.equal(sheet.Q14.v, 98232998);
  const records = [];
  for (let row = 4; row < 136; row++) {
    const name = sheet[`B${row}`]?.v, cell = sheet[`L${row}`];
    if (!cell || cell.v == null || cell.v === '') continue; // Blank is not zero.
    assert.equal(cell.t, 'n', `Invalid September value at L${row}`);
    assert.equal(typeof name, 'string');
    assert(!/^#|total|summary/i.test(name), `Unresolved agent at B${row}`);
    records.push({ name, sourceRow: row, actual: cell.v });
  }
  assert.equal(new Set(records.map(r => r.name)).size, records.length);
  assert.equal(records.length, 22);
  const actual = records.reduce((sum, r) => sum + r.actual, 0);
  assert.equal(actual, sheet.L136.v);
  assert.equal(actual, sheet.Q14.v);
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: '262f60f1-9268-4722-be9c-7e84920383aa' } });
  assert.equal(campaign.campaignName, 'BPI PL');
  assert(campaign.isActive);
  const actor = await db.user.findUniqueOrThrow({ where: { id: 'ca703d8a-65dc-4745-860c-d7fb463dc572' }, include: { campaignAssignments: true } });
  assert.equal(actor.name, 'Timothy Germedia');
  assert.equal(actor.role, 'COLLECTOR');
  assert(actor.campaignAssignments.some(a => a.campaignId === campaign.id));
  const scope = { campaignId: campaign.id, year: 2026, month: 9 };
  const existing = await db.dashboardImportRecord.findMany({ where: scope, orderBy: { id: 'asc' } });
  const previous = await db.productionImport.findFirst({ where: { fileHash, status: 'COMPLETED', importedById: actor.id } });
  if (previous) {
    assert.equal(existing.length, 22);
    assert.equal(existing.reduce((s, r) => s + r.actual, 0), actual);
    for (const r of records) assert(existing.some(e => e.entityName === r.name && e.actual === r.actual && e.sourceRow === r.sourceRow && e.metric === 'Booked Volume'));
    const parsed = parseFile(bytes, fileName, 'xlsx');
    let raw = await db.productionImportRawRow.findMany({ where: { importId: previous.id }, orderBy: { sourceRow: 'asc' } });
    if (!reconcile(parsed.inspection, raw.map(r => unpackRawRow(r.rawPayload))).passed) {
      assert(process.argv.includes('--apply'), 'Raw-row precision repair requires --apply');
      const output = path.join(process.env.TEMP, 'opsview-pl-september-2026');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'before-raw-precision-repair.json'), JSON.stringify(raw));
      await db.$transaction(async tx => {
        for (const row of parsed.rows) await tx.productionImportRawRow.update({ where: { importId_sourceSheet_sourceRow: { importId: previous.id, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow } }, data: { rawPayload: compressRawRow(row) } });
        await tx.productionImportIssue.create({ data: { importId: previous.id, level: 'INFO', code: 'RAW_PRECISION_VERIFIED', message: 'Compressed raw-row storage preserves exact source decimals without JSON numeric transport rounding.', rawData: { actorId: actor.id, sourceHash: fileHash } } });
      }, { timeout: 30000 });
      raw = await db.productionImportRawRow.findMany({ where: { importId: previous.id }, orderBy: { sourceRow: 'asc' } });
    }
    assert(reconcile(parsed.inspection, raw.map(r => unpackRawRow(r.rawPayload))).passed);
    assert.equal(crypto.createHash('sha256').update(previous.originalFile).digest('hex'), fileHash);
    const output = path.join(process.env.TEMP, 'opsview-pl-september-2026');
    const preview = JSON.parse(fs.readFileSync(path.join(output, 'preview.json')));
    const unrelated = await db.dashboardImportRecord.findMany({ where: { NOT: scope }, orderBy: { id: 'asc' } });
    assert.equal(digest(unrelated), preview.unchangedHash);
    const result = { status: 'IMPORTED_AND_VERIFIED', importId: previous.id, records: existing.length, actual, originalFileVerified: true, rawSourceVerified: true, unrelatedRecordsUnchanged: unrelated.length, changed: 0 };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    return;
  }
  assert.equal(existing.length, 0, 'Existing September dashboard data must be reviewed first');
  const otherSources = await Promise.all([
    db.productionMonitoring.count({ where: { campaignId: campaign.id, reportYear: 2026, reportMonth: 9 } }),
    db.productionMetricRecord.count({ where: { campaignId: campaign.id, reportYear: 2026, reportMonth: 9 } }),
    db.productionEntry.count({ where: { campaignId: campaign.id, date: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } } }),
  ]);
  assert(otherSources.every(n => n === 0), 'Other September production exists');
  const parsed = parseFile(bytes, fileName, 'xlsx');
  const reconciliation = reconcile(parsed.inspection, parsed.rows);
  assert(reconciliation.passed, 'Raw source preservation did not reconcile');
  const unchangedWhere = { NOT: scope };
  const before = await db.dashboardImportRecord.findMany({ where: unchangedWhere, orderBy: { id: 'asc' } });
  const preview = { fileName, fileHash, campaign: campaign.campaignName, year: 2026, month: 9, records: records.length, actual, transactions: 656, rawRows: parsed.rows.length, sourceReconciled: reconciliation.passed, unchangedRecords: before.length, unchangedHash: digest(before), recordsPreview: records };
  const output = path.join(process.env.TEMP, 'opsview-pl-september-2026');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'preview.json'), JSON.stringify(preview, null, 2));
  console.log(JSON.stringify({ ...preview, recordsPreview: undefined, mode: process.argv.includes('--apply') ? 'APPLY' : 'PREVIEW', auditDirectory: output }));
  if (!process.argv.includes('--apply')) return;
  const backup = path.join(output, `before-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ createdAt: new Date(), scope, existing, unchangedHash: digest(before), dashboardRecords: before }));
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`WORKBOOK_DASHBOARD:${campaign.id}`}, 0))::text`;
    assert.equal(await tx.dashboardImportRecord.count({ where: scope }), 0, 'September changed after preview');
    const currentActor = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, include: { campaignAssignments: true } });
    assert.equal(currentActor.role, 'COLLECTOR');
    assert(currentActor.campaignAssignments.some(a => a.campaignId === campaign.id));
    const now = new Date(), period = new Date('2026-09-01T00:00:00Z');
    const batch = await tx.dashboardImportBatch.create({ data: { campaignId: campaign.id, fileName, importMode: 'SOURCE_VERIFIED_SEPTEMBER', duplicateMode: 'skip', reportPeriodType: 'monthly', reportDate: period, workbookYear: 2026, totalWorksheets: 1, supportedSheets: 1, selectedCampaignIds: JSON.stringify([campaign.id]), detectedWorksheets: JSON.stringify(['Sheet1']), insertedCount: 22, importedById: actor.id, status: 'COMPLETED', completedAt: now } });
    const projection = { state: 'COMPLETED', campaignId: campaign.id, campaignIds: [campaign.id], dashboardBatchId: batch.id, sourceSheet: 'Sheet1', records: 22, actual, transactions: 656, periods: ['2026-09'], sourceCells: { agents: 'B4:B135', actuals: 'L4:L135', grandTotal: 'L136', summary: 'O14:R14' }, operation: 'User supplied PL September source in chat; agent-assisted import', periodScope: 'September only; all other months retained as raw source' };
    const imported = await tx.productionImport.create({ data: { fileName, fileHash, fileType: 'xlsx', originalFile: bytes, engine: 'SMART_V1', status: 'COMPLETED', importedById: actor.id, reportingPeriods: ['2026-09'], recordsDetected: 22, recordsImported: 22, confirmedAt: now, completedAt: now, inspection: json({ ...parsed.inspection, metadata: { ...parsed.inspection.metadata, dashboardProjection: projection } }), reconciliation: json({ ...reconciliation, committedRecords: 22, businessStatus: 'COMPLETED' }) } });
    await tx.productionImportRawRow.createMany({ data: parsed.rows.map(r => ({ importId: imported.id, sourceSheet: r.sourceSheet, sourceRow: r.sourceRow, rawPayload: compressRawRow(r) })) });
    await tx.dashboardImportRecord.createMany({ data: records.map(r => ({ batchId: batch.id, campaignId: campaign.id, worksheetSource: 'Sheet1', sourceRow: r.sourceRow, recordKind: 'agent_monitoring', monitoringType: 'PL_YTD_BOOKED_AGENT', entityName: r.name, category: 'Personal Loans', product: 'Volume', metric: 'Booked Volume', month: 9, year: 2026, reportPeriodType: 'monthly', reportDate: period, actual: r.actual, sourceFile: fileName, importedById: actor.id, remark: JSON.stringify({ smartImportId: imported.id, sourceCell: `Sheet1!L${r.sourceRow}`, agentCell: `Sheet1!B${r.sourceRow}`, operation: projection.operation }) })) });
    await tx.productionImportIssue.create({ data: { importId: imported.id, sourceSheet: 'Sheet1', level: 'INFO', code: 'SOURCE_VERIFIED_SEPTEMBER_IMPORTED', message: 'Agent-assisted September-only PL import reconciled to both workbook totals; original workbook and all raw rows retained.', rawData: { actorId: actor.id, ...projection, fileHash, unchangedHash: digest(before) } } });
    const after = await tx.dashboardImportRecord.findMany({ where: unchangedWhere, orderBy: { id: 'asc' } });
    assert.equal(digest(after), digest(before), 'Unrelated dashboard records changed');
    return { importId: imported.id, dashboardBatchId: batch.id };
  }, { timeout: 30000, isolationLevel: 'Serializable' });
  const saved = await db.dashboardImportRecord.findMany({ where: scope });
  assert.equal(saved.length, 22);
  assert.equal(saved.reduce((sum, r) => sum + r.actual, 0), actual);
  const retained = await db.productionImport.findUniqueOrThrow({ where: { id: result.importId }, select: { originalFile: true } });
  assert.equal(crypto.createHash('sha256').update(retained.originalFile).digest('hex'), fileHash);
  const storedRaw = await db.productionImportRawRow.findMany({ where: { importId: result.importId }, orderBy: { sourceRow: 'asc' } });
  assert(reconcile(parsed.inspection, storedRaw.map(r => unpackRawRow(r.rawPayload))).passed);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...result, ...preview, recordsPreview: undefined, backup, verified: true }, null, 2));
  console.log(JSON.stringify({ status: 'IMPORTED_AND_VERIFIED', ...result, records: saved.length, actual, originalFileVerified: true, rawSourceVerified: true, unrelatedRecordsUnchanged: before.length }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
