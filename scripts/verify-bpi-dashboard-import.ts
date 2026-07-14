import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { isBpiDashboardWorkbook, parseBpiDashboardWorkbook } from '../lib/bpi-dashboard-import';
import { isBdoDashboardWorkbook } from '../lib/bdo-dashboard-import';
import { mapWorksheetCampaign } from '../lib/campaign-import-selection';

const workbook = XLSX.utils.book_new();
const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);

add('YTD Performance', [
  ['BPI Dashboard 2026'],
  ['', 'PA SIP Loans Outbound', 'PA SIP Loans Outbound', 'PA SIP Loans Outbound', 'PA SIP Loans Inbound', 'PA SIP Loans Inbound', 'PA SIP Loans Inbound', 'Personal Loans', 'Personal Loans', 'Personal Loans', 'Fulfillment', 'Fulfillment', 'Fulfillment'],
  ['Month', 'Target', 'Actual', 'Achievement', 'Target', 'Actual', 'Achievement', 'Target', 'Actual', 'Achievement', 'Target', 'Actual', 'Achievement'],
  ['January', 100, 80, 0.8, 90, 70, 0.777, 50, 25, 0.5, 40, 30, 0.75],
  ['February', 110, 99, 0.9, 95, 76, 0.8, 55, 44, 0.8, 45, 36, 0.8],
]);
add('Manpower Monitoring', [
  ['Particular', 'January 2026', 'February 2026'],
  ['Declared Seat Count', 100, 101],
  ['Actual Head Count', 95, 97],
]);
add('PA Agents Monitoring', [
  ['PA SIP Loans Outbound 2026'],
  ['Agent Name', 'Level', 'January', 'January', 'January', 'February', 'February', 'February'],
  ['Agent Name', 'Level', 'Goal', 'Actual', 'Achievement', 'Goal', 'Actual', 'Achievement'],
  ['Agent One', 'Core', 10, 8, 0.8, 12, 12, 1],
]);
add('PL YTD Productivity', [
  ['Personal Loans 2026'],
  ['Agent Name', 'January', 'January', 'January', 'January', 'January', 'January', 'February', 'February', 'February', 'February', 'February', 'February'],
  ['Agent Name', 'Transmitted Count', 'Transmitted Volume', 'Approvals Count', 'Approvals Volume', 'Booked Count', 'Booked Volume', 'Transmitted Count', 'Transmitted Volume', 'Approvals Count', 'Approvals Volume', 'Booked Count', 'Booked Volume'],
  ['PL Agent', 5, 50000, 4, 40000, 3, 30000, 6, 60000, 5, 50000, 4, 40000],
]);
add('PA HOH Monitoring', [
  ['PA SIP Loans Outbound 2026'],
  ['Agent Name', 'Level', 'January', 'January', 'January', 'February', 'February', 'February'],
  ['Agent Name', 'Level', 'Goal', 'Actual', 'Achievement', 'Goal', 'Actual', 'Achievement'],
  ['Agent One', 'Core', 10, 8, 0.8, 12, 12, 1],
]);
add('PL HOH Monitoring', [
  ['Personal Loans 2026'],
  ['Agent Name', 'January', 'January', 'January', 'January', 'February', 'February', 'February', 'February'],
  ['Agent Name', 'Level', 'Goal', 'Actual', 'Achievement', 'Level', 'Goal', 'Actual', 'Achievement'],
  ['PL Agent', 'Rookie', 10, 8, 0.8, 'Core', 12, 11, 0.9167],
]);

const campaigns = [
  { id: 'bl', campaignName: 'BPI BL' },
  { id: 'ff', campaignName: 'BPI FF' },
  { id: 'in', campaignName: 'BPI PA INBOUND' },
  { id: 'out', campaignName: 'BPI PA OUTBOUND' },
  { id: 'pl', campaignName: 'BPI PL' },
];

assert.equal(isBpiDashboardWorkbook(workbook), true);
const bdoWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(bdoWorkbook, XLSX.utils.aoa_to_sheet([['Agent', 'January'], ['Name', 'Goal']]), 'CI Agents Monitoring');
assert.equal(isBpiDashboardWorkbook(bdoWorkbook), false);
assert.equal(isBdoDashboardWorkbook(bdoWorkbook), true);
const parsed = parseBpiDashboardWorkbook(workbook, new Date(2026, 0, 1));
assert.equal(parsed.sheets.length, 6);
assert.equal(parsed.sheets.filter((sheet) => sheet.detectedType !== 'Unsupported').length, 6);
assert.deepEqual(new Set(parsed.detectedMonths), new Set(['Jan 2026', 'Feb 2026']));

const ytd = parsed.records.filter((record) => record.recordKind === 'ytd');
assert.equal(ytd.length, 8);
assert.deepEqual(new Set(ytd.map((record) => mapWorksheetCampaign(`${record.category} ${record.metric}`, campaigns).campaign.campaignName)), new Set(['BPI PA OUTBOUND', 'BPI PA INBOUND', 'BPI PL', 'BPI FF']));

const productivity = parsed.records.filter((record) => record.monitoringType === 'PL_PRODUCTIVITY');
assert.equal(productivity.length, 12);
assert.deepEqual(new Set(productivity.map((record) => record.metric)), new Set(['Transmitted Count', 'Transmitted Volume', 'Approvals Count', 'Approvals Volume', 'Booked Count', 'Booked Volume']));
assert.equal(productivity.every((record) => mapWorksheetCampaign(`${record.category} ${record.metric}`, campaigns).campaign.campaignName === 'BPI PL'), true);

const paRecords = parsed.records.filter((record) => record.monitoringType === 'PA_AGENT' || record.monitoringType === 'PA_HOH');
assert.equal(paRecords.length, 4);
assert.equal(paRecords.every((record) => mapWorksheetCampaign(`${record.category} ${record.worksheetSource}`, campaigns).campaign.campaignName === 'BPI PA OUTBOUND'), true);

const manpower = parsed.records.filter((record) => record.recordKind === 'manpower');
assert.equal(manpower.length, 4);
assert.equal(mapWorksheetCampaign(`${manpower[0].category} ${manpower[0].worksheetSource}`, campaigns).source, 'unresolved');

console.log(JSON.stringify({
  supportedWorksheets: parsed.sheets.length,
  records: parsed.records.length,
  ytdRecords: ytd.length,
  productivityRecords: productivity.length,
  paMonitoringRecords: paRecords.length,
  manpowerRecords: manpower.length,
  months: parsed.detectedMonths,
  metrics: parsed.detectedMetrics,
}, null, 2));
