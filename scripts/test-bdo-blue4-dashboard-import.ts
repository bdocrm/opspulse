import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { detectBdoWorksheet, isBdoDashboardWorkbook, parseBdoDashboardWorkbook } from '../lib/bdo-dashboard-import';
import { canonicalCampaignName } from '../lib/campaign-import-mapping';

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  [null, 'CASH INSTALLMENT', null, null, 'VIRTUAL CARD'],
  ['Month', 'VOL', 'TARGET', 'ACHVT', 'VOL', 'TARGET', 'ACHVT'],
  ['January', '40M', 50_000_000, null, 100, 200, null],
  ['June', 'NO FINAL REPORT FROM BDO', null, null, null, null, null],
]), ' YTD  Performance ');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  [null, null, 'DATE HIRED', 'AVERAGE', 'JANUARY', 'FEBRUARY'],
  [1, 'DOE, JANE Q.', new Date(2024, 0, 15), 1.1, 1.2, 'SICK LEAVE'],
  [2, 'SMITH, JOHN', 45292, 0.9, '#DIV/0!', 0.8],
]), 'CI SCORECARD');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  [2026, 'January'],
  ['Agent', 'Level', 'Goal', 'Actual', 'Achievement'],
  ['DOE, JANE Q.', 'CORE', 100, 120, null],
  ['RONDINA, NATHANIEL CAADLAWON', 'CORE', 100, 'CORE', null],
]), 'CI Agents Monitoring');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  [2026, 'January'],
  ['VIRTUAL', 'Goal', 'Actual', 'Achievement'],
  ['DOE, JANE Q.', 10, 12, null],
]), 'Cross Sell Agents Monitoring');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  [2026, 'January'],
  ['Agent', 'Level', 'Goal', 'Actual', 'Achievement'],
  ['DOE, JANE Q.', 'CORE', 50, 40, null],
]), 'CI HOH Monitoring');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  [2026, 'January'],
  ['NTH CARD', 'Goal', 'Actual', 'Achievement'],
  ['DOE, JANE Q.', 20, 18, null],
]), 'CROSS SELL HOH Monitoring');

assert.equal(detectBdoWorksheet('  ci   scorecard '), 'CI SCORECARD');
assert.equal(isBdoDashboardWorkbook(workbook), true);
const unrelated = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(unrelated, XLSX.utils.aoa_to_sheet([['x']]), 'YTD Performance');
assert.equal(isBdoDashboardWorkbook(unrelated), false, 'one coincidental sheet must not trigger this importer');
assert.equal(canonicalCampaignName('Cash Installment Easy'), 'BDO CIE');
assert.equal(canonicalCampaignName('XSELL / VIRTUAL'), 'BDO VC');
assert.equal(canonicalCampaignName('XSELL/NTH CARD'), 'BDO NTH CARD');
assert.equal(canonicalCampaignName('SUPPLE'), 'BDO SUPPLE');

const parsed = parseBdoDashboardWorkbook(workbook, new Date(2026, 0, 1));
assert.equal(parsed.workbookYear, 2026, 'Date Hired must not become the report year');
assert.equal(parsed.sheets.find((sheet) => sheet.sheetName === 'CI SCORECARD')?.detectedType, 'CI SCORECARD');
assert.equal(parsed.records.find((record) => record.metric === 'CASH INSTALLMENT' && record.month === 1)?.actual, 40_000_000);
const noReport = parsed.records.find((record) => record.month === 6 && record.remark === 'NO FINAL REPORT FROM BDO');
assert.ok(noReport, 'NO FINAL REPORT must be preserved');
assert.equal(noReport.actual, undefined, 'missing source data must not be coerced to zero');
const leave = parsed.records.find((record) => record.recordKind === 'scorecard' && record.remark === 'SICK LEAVE');
assert.ok(leave, 'scorecard leave status must be preserved');
assert.equal(leave.actual, undefined);
assert.ok(parsed.records.some((record) => record.recordKind === 'scorecard' && record.dateHired instanceof Date));
assert.ok(parsed.issues.some((issue) => issue.rawValue === '#DIV/0!'));
assert.ok(parsed.issues.some((issue) => issue.rawValue === 'CORE'), 'text in a numeric cell must generate a warning');
assert.ok(parsed.records.some((record) => record.monitoringType === 'CI_AGENT' && record.achievement === 1.2));
assert.ok(parsed.records.some((record) => record.monitoringType === 'CROSS_SELL_AGENT' && record.product === 'VIRTUAL'));
assert.ok(parsed.records.some((record) => record.monitoringType === 'CI_HOH'));
assert.ok(parsed.records.some((record) => record.monitoringType === 'CROSS_SELL_HOH' && record.product === 'NTH CARD'));

console.log(`BDO Blue 4 dashboard parser tests passed (${parsed.records.length} normalized records).`);
