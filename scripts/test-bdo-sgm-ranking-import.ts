import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  BDO_SGM_METRIC_TYPE,
  detectBdoSgmCardLevels,
  detectBdoSgmMonth,
  isBdoSgmCampaign,
  normalizeBdoSgmCardLevel,
  parseBdoSgmPivotCache,
  parseBdoSgmWorksheet,
} from '../lib/bdo-sgm-ranking-import';

function rankingRows() {
  return [
    ['ONLINE RANKING HOH'],
    ['Report Year', 2026],
    [],
    ['Card Level', 'BUNDLE CARD'],
    [],
    ['Count of Card Level', 'Column Labels'],
    [null, 'Row Labels', '01-JAN', '02-FEB', 'Mar-2026', '04/2026', new Date(2026, 4, 1), '07-JUL', 'Grand Total'],
    [null, '  DELA   CRUZ, JUAN  SANTOS ', 1, null, '3', 0, 2, 4, 10],
    [null, 'REYES, MARIA', null, 5, null, null, null, null, 5],
    [null, 'BAD VALUE, AGENT', 'oops', 2, null, null, null, null, 2],
    [null, 'MISMATCH, AGENT', 1, 1, null, null, null, null, 5],
    [null, 'Grand Total', 2, 8, 3, 0, 2, 4, 19],
  ];
}

function roundTripWorkbook() {
  const workbook = XLSX.utils.book_new();
  const ranking = XLSX.utils.aoa_to_sheet(rankingRows());
  ranking.G8 = { t: 'n', f: '1+1', v: 2 };
  XLSX.utils.book_append_sheet(workbook, ranking, 'Ranking - Renamed');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Full Name', 'Count'],
    ['NOT A BDO RANKING ROW', 9],
  ]), 'Unrelated');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['CARDLEVEL', 'first card'],
    [],
    ['Name', '01/2027', 'Grand Total'],
    ['FUTURE, AGENT', '7', 7],
  ]), 'Future Months');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return XLSX.read(bytes, { type: 'buffer', cellDates: true, cellFormula: true });
}

function pivotCacheWorkbookBytes(): Uint8Array {
  const archive = XLSX.CFB.utils.cfb_new();
  const definition = [
    '<pivotCacheDefinition><cacheFields count="5">',
    '<cacheField name="Assigned Caller"><sharedItems><s v="AGENT, ONE"/></sharedItems></cacheField>',
    '<cacheField name="Card Level"><sharedItems><s v="1ST CARD"/><s v="BUNDLE CARD"/></sharedItems></cacheField>',
    '<cacheField name="Turn In Date"><sharedItems><d v="2026-01-05T00:00:00"/><d v="2026-02-05T00:00:00"/><d v="2026-07-05T00:00:00"/></sharedItems></cacheField>',
    '<cacheField name="TURN INS ACTUAL MONTH"><sharedItems><s v="01-JAN"/><s v="02-FEB"/><s v="07-JUL"/></sharedItems></cacheField>',
    '<cacheField name="Transmital Year"><sharedItems><n v="2026"/></sharedItems></cacheField>',
    '</cacheFields></pivotCacheDefinition>',
  ].join('');
  const records = [
    '<pivotCacheRecords count="6">',
    '<r><x v="0"/><x v="0"/><x v="0"/><x v="0"/><x v="0"/></r>',
    '<r><x v="0"/><x v="0"/><x v="0"/><x v="0"/><x v="0"/></r>',
    '<r><x v="0"/><x v="1"/><x v="0"/><x v="0"/><x v="0"/></r>',
    '<r><x v="0"/><x v="0"/><x v="1"/><x v="1"/><x v="0"/></r>',
    '<r><x v="0"/><x v="0"/><x v="2"/><x v="2"/><x v="0"/></r>',
    '<r><x v="0"/><x v="1"/><x v="2"/><x v="2"/><x v="0"/></r>',
    '</pivotCacheRecords>',
  ].join('');
  const pivotTable = [
    '<pivotTableDefinition><pivotFields count="5">',
    '<pivotField axis="axisRow"><items><item x="0"/></items></pivotField>',
    '<pivotField axis="axisPage"><items><item x="0"/><item x="1"/></items></pivotField>',
    '<pivotField axis="axisPage"><items><item x="0"/><item x="1"/><item h="1" x="2"/></items></pivotField>',
    '<pivotField axis="axisCol"><items><item x="0"/><item x="1"/><item h="1" x="2"/></items></pivotField>',
    '<pivotField/>',
    '</pivotFields><rowFields><field x="0"/></rowFields>',
    '<pageFields><pageField fld="1"/><pageField fld="2"/></pageFields>',
    '<dataFields><dataField name="Count of Card Level" fld="1" subtotal="count"/></dataFields>',
    '</pivotTableDefinition>',
  ].join('');
  XLSX.CFB.utils.cfb_add(archive, 'xl/pivotCache/pivotCacheDefinition1.xml', Buffer.from(definition));
  XLSX.CFB.utils.cfb_add(archive, 'xl/pivotCache/pivotCacheRecords1.xml', Buffer.from(records));
  XLSX.CFB.utils.cfb_add(archive, 'xl/pivotTables/pivotTable1.xml', Buffer.from(pivotTable));
  return XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' });
}

assert.equal(isBdoSgmCampaign('BDO SGM'), true);
assert.equal(isBdoSgmCampaign('  bdo sgm  '), true);
assert.equal(isBdoSgmCampaign(' bdo   sgm '), true);
assert.equal(isBdoSgmCampaign('BDO CIE'), false);
assert.equal(isBdoSgmCampaign('BDO SGM Online'), false);
assert.equal(normalizeBdoSgmCardLevel('1st CARD'), 'FIRST_CARD');
assert.equal(normalizeBdoSgmCardLevel('FIRST CARD'), 'FIRST_CARD');
assert.equal(normalizeBdoSgmCardLevel('bundle'), 'BUNDLE_CARD');
assert.equal(normalizeBdoSgmCardLevel('Supplementary Card'), null);
assert.deepEqual(detectBdoSgmCardLevels([['cArD lEvEl', 'bundle card']]).map((item) => item.normalized), ['BUNDLE_CARD']);

assert.deepEqual(detectBdoSgmMonth('JAN', 2026), { month: 0, year: 2026, label: 'JAN' });
assert.deepEqual(detectBdoSgmMonth('January', 2026), { month: 0, year: 2026, label: 'January' });
assert.deepEqual(detectBdoSgmMonth('Jan-2027', 2026), { month: 0, year: 2027, label: 'Jan-2027' });
assert.deepEqual(detectBdoSgmMonth('01/2027', 2026), { month: 0, year: 2027, label: '01/2027' });

const workbook = roundTripWorkbook();
const results = workbook.SheetNames.map((sheetName) => {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
  return parseBdoSgmWorksheet(rows, sheetName, new Date(2030, 11, 1));
});

const ranking = results[0];
assert.equal(ranking.detected, true);
assert.equal(ranking.format, 'BDO SGM Ranking');
assert.equal(ranking.headerRow, 7);
assert.equal(ranking.validAgentRows, 4);
assert.equal(ranking.monthlyRecordsDetected, 9);
assert.equal(ranking.invalidRows, 1);
assert.equal(ranking.records.filter((record) => record.name === 'Grand Total').length, 0);
assert.equal(ranking.records.every((record) => record.metricType === BDO_SGM_METRIC_TYPE), true);
assert.equal(ranking.records.every((record) => record.cardLevel === 'BUNDLE_CARD'), true);
assert.equal(ranking.records.every((record) => record.cardLevelLabel === 'BUNDLE CARD'), true);
assert.equal(ranking.records.every((record) => record.sourceSheet === 'Ranking - Renamed'), true);
assert.equal(ranking.records.some((record) => record.count === 0), true);
assert.equal(ranking.records.some((record) => record.name === 'DELA CRUZ, JUAN SANTOS' && record.reportDate.getMonth() === 4 && record.count === 2), true);
assert.equal(ranking.records.some((record) => record.name === 'REYES, MARIA' && record.reportDate.getMonth() === 1 && record.count === 5), true);
assert.equal(ranking.records.some((record) => record.name === 'BAD VALUE, AGENT' && record.reportDate.getMonth() === 1 && record.count === 2), true);
assert.equal(ranking.issues.some((issue) => issue.row === 10 && /Invalid value/.test(issue.reason) && !issue.warning), true);
assert.equal(ranking.issues.some((issue) => issue.row === 11 && /does not match/.test(issue.reason) && issue.warning), true);
assert.equal(ranking.records.filter((record) => record.name === 'MISMATCH, AGENT').every((record) => record.validationErrors?.some((warning) => /does not match/.test(warning))), true);
assert.deepEqual(ranking.detectedMonths, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-07']);

assert.equal(results[1].detected, false);
assert.equal(results[1].rowsScanned, 0);
assert.equal(results[2].detected, false);
assert.equal(results[3].detected, true);
assert.equal(results[3].records.length, 1);
assert.equal(results[3].records[0].reportDate.getFullYear(), 2027);
assert.equal(results[3].records[0].reportDate.getMonth(), 0);
assert.equal(results[3].records[0].cardLevel, 'FIRST_CARD');

const pivotCache = parseBdoSgmPivotCache(
  pivotCacheWorkbookBytes(),
  'Pivot Report',
  new Date(2026, 0, 1)
);
assert.ok(pivotCache);
assert.deepEqual(pivotCache.detectedCardLevels, ['BUNDLE_CARD', 'FIRST_CARD']);
assert.deepEqual(pivotCache.detectedMonths, ['2026-01', '2026-02']);
assert.equal(pivotCache.records.length, 3);
assert.equal(pivotCache.records.filter((record) => record.cardLevel === 'FIRST_CARD').reduce((sum, record) => sum + record.count, 0), 3);
assert.equal(pivotCache.records.filter((record) => record.cardLevel === 'BUNDLE_CARD').reduce((sum, record) => sum + record.count, 0), 1);
assert.equal(pivotCache.records.every((record) => record.grandTotal === (record.cardLevel === 'FIRST_CARD' ? 3 : 1)), true);

const sameAgentMonths = ranking.records.filter((record) => record.name === 'DELA CRUZ, JUAN SANTOS');
assert.equal(new Set(sameAgentMonths.map((record) => record.reportDate.toISOString().slice(0, 7))).size, 5);

const bothSections = parseBdoSgmWorksheet([
  ['Card Level', 'BUNDLE CARD'],
  ['Row Labels', 'JAN', 'Grand Total'],
  ['SAME, COLLECTOR', 4, 4],
  [],
  ['CardLevel', '1ST CARD'],
  ['Row Labels', 'JAN', 'Grand Total'],
  ['SAME, COLLECTOR', '6', 6],
], 'Both Sections', new Date(2026, 0, 1));
assert.equal(bothSections.records.length, 2);
assert.deepEqual(bothSections.detectedCardLevels, ['BUNDLE_CARD', 'FIRST_CARD']);
assert.deepEqual(bothSections.records.map((record) => record.cardLevel).sort(), ['BUNDLE_CARD', 'FIRST_CARD']);
assert.equal(bothSections.records.some((record) => record.count === 4), true);
assert.equal(bothSections.records.some((record) => record.count === 6), true);

const missingCardLevel = parseBdoSgmWorksheet([
  ['Count of Card Level'],
  ['Row Labels', 'JAN', 'Grand Total'],
  ['VALID, NAME', 1, 1],
], 'Missing Card', new Date(2026, 0, 1));
assert.equal(missingCardLevel.detected, true);
assert.equal(missingCardLevel.records.length, 0);
assert.equal(missingCardLevel.errors.some((message) => /No supported Card Level/.test(message)), true);

const unsupportedCardLevel = parseBdoSgmWorksheet([
  ['Card Level', 'PLATINUM'],
  ['Row Labels', 'JAN', 'Grand Total'],
  ['VALID, NAME', 1, 1],
], 'Unsupported Card', new Date(2026, 0, 1));
assert.equal(unsupportedCardLevel.records.length, 0);
assert.equal(unsupportedCardLevel.errors.some((message) => /No supported Card Level|matched to a supported/.test(message)), true);

const missingHeader = parseBdoSgmWorksheet([
  ['Card Level', 'BUNDLE CARD'],
  ['Count of Card Level'],
], 'Missing Header', new Date(2026, 0, 1));
assert.equal(missingHeader.errors.some((message) => /table could not be located/.test(message)), true);

const missingCollector = parseBdoSgmWorksheet([
  ['Card Level', 'BUNDLE'],
  ['Row Labels', 'JAN', 'Grand Total'],
  ['', 2, 2],
  ['PRESENT, COLLECTOR', 0, 0],
], 'Missing Collector', new Date(2026, 0, 1));
assert.equal(missingCollector.records.length, 1);
assert.equal(missingCollector.records[0].count, 0);
assert.equal(missingCollector.invalidRows, 1);
assert.equal(missingCollector.issues.some((item) => /name is missing/.test(item.reason)), true);

console.log(JSON.stringify({
  worksheetsScanned: results.length,
  validWorksheets: results.filter((result) => result.detected).length,
  validAgentRows: results.reduce((sum, result) => sum + result.validAgentRows, 0),
  monthlyRecords: results.reduce((sum, result) => sum + result.monthlyRecordsDetected, 0),
  invalidRows: results.reduce((sum, result) => sum + result.invalidRows, 0),
  warnings: results.reduce((sum, result) => sum + result.warningCount, 0),
}, null, 2));
