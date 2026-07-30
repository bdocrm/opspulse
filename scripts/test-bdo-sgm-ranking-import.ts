import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  BDO_SGM_METRIC_TYPE,
  detectBdoSgmMonth,
  isBdoSgmCampaign,
  parseBdoSgmWorksheet,
} from '../lib/bdo-sgm-ranking-import';

function rankingRows() {
  return [
    ['ONLINE RANKING HOH'],
    ['Report Year', 2026],
    [],
    [],
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
    [],
    ['Name', '01/2027', 'Grand Total'],
    ['FUTURE, AGENT', '7', 7],
  ]), 'Future Months');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return XLSX.read(bytes, { type: 'buffer', cellDates: true, cellFormula: true });
}

assert.equal(isBdoSgmCampaign('BDO SGM'), true);
assert.equal(isBdoSgmCampaign('  bdo sgm  '), true);
assert.equal(isBdoSgmCampaign('BDO CIE'), false);
assert.equal(isBdoSgmCampaign('BDO SGM Online'), false);

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

const sameAgentMonths = ranking.records.filter((record) => record.name === 'DELA CRUZ, JUAN SANTOS');
assert.equal(new Set(sameAgentMonths.map((record) => record.reportDate.toISOString().slice(0, 7))).size, 5);

console.log(JSON.stringify({
  worksheetsScanned: results.length,
  validWorksheets: results.filter((result) => result.detected).length,
  validAgentRows: results.reduce((sum, result) => sum + result.validAgentRows, 0),
  monthlyRecords: results.reduce((sum, result) => sum + result.monthlyRecordsDetected, 0),
  invalidRows: results.reduce((sum, result) => sum + result.invalidRows, 0),
  warnings: results.reduce((sum, result) => sum + result.warningCount, 0),
}, null, 2));
