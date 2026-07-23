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
  ['February', 110, 99, 0.9, 95, 76, 0.8, 55, 44, 0.8, 45, null, 0.8],
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
  ['OLD', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
  ['SEMI OLD', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
  ['NEW', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
  ['OLD AVERAGE PER AGENT', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
  ['SEMI OLD AVERAGE PER AGENT', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
  ['NEW AVERAGE PER AGENT', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
  ['TOTAL AVERAGE PER AGENT', 100, 1000000, 90, 900000, 80, 800000, 110, 1100000, 95, 950000, 85, 850000],
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
assert.equal(ytd.length, 6);
assert.equal(ytd.some((record) => /^Fulfillment$/i.test(record.category || '')), false);
assert.deepEqual(new Set(ytd.map((record) => mapWorksheetCampaign(`${record.category} ${record.metric}`, campaigns).campaign.campaignName)), new Set(['BPI PA OUTBOUND', 'BPI PA INBOUND', 'BPI PL']));

const productivity = parsed.records.filter((record) => record.monitoringType === 'PL_PRODUCTIVITY');
assert.equal(productivity.length, 12);
assert.equal(productivity.some((record) => /^(?:OLD|SEMI OLD|NEW|(?:OLD|SEMI OLD|NEW|TOTAL) AVERAGE PER AGENT)$/.test(record.entityName || '')), false);
assert.deepEqual(new Set(productivity.map((record) => record.metric)), new Set(['Transmitted Count', 'Transmitted Volume', 'Approvals Count', 'Approvals Volume', 'Booked Count', 'Booked Volume']));
assert.equal(productivity.every((record) => mapWorksheetCampaign(`${record.category} ${record.metric}`, campaigns).campaign.campaignName === 'BPI PL'), true);

const paRecords = parsed.records.filter((record) => record.monitoringType === 'PA_AGENT' || record.monitoringType === 'PA_HOH');
assert.equal(paRecords.length, 4);
assert.equal(paRecords.every((record) => mapWorksheetCampaign(`${record.category} ${record.worksheetSource}`, campaigns).campaign.campaignName === 'BPI PA OUTBOUND'), true);

const manpower = parsed.records.filter((record) => record.recordKind === 'manpower');
assert.equal(manpower.length, 4);
assert.equal(mapWorksheetCampaign(`${manpower[0].category} ${manpower[0].worksheetSource}`, campaigns).source, 'unresolved');

const inboundWorkbook = XLSX.utils.book_new();
const inboundSheet = XLSX.utils.aoa_to_sheet([
  [null, 'YTD', null, 'JANUARY', null, 'FEBRUARY', null],
  ['AGENT', 'TRANSMITTAL', 'BOOKED VOLUME', 'TRANSMITTAL', 'BOOKED VOLUME', 'TRANSMITTAL', 'BOOKED VOLUME'],
  ['Inbound Agent', 30, 4_000_000, 10, 1_500_000, 20, 2_500_000],
  ['TOTAL', 30, 4_000_000, 10, 1_500_000, 20, 2_500_000],
  [],
  ['MONTH', 'GOAL'],
  ['JANUARY', 15_000_000],
  ['FEBRUARY', 20_000_000],
]);
inboundSheet['!merges'] = [
  XLSX.utils.decode_range('B1:C1'),
  XLSX.utils.decode_range('D1:E1'),
  XLSX.utils.decode_range('F1:G1'),
];
XLSX.utils.book_append_sheet(inboundWorkbook, inboundSheet, 'YTD');
assert.equal(isBpiDashboardWorkbook(inboundWorkbook, 'INBOUND YTD REPORT.xlsx'), true);
assert.equal(isBpiDashboardWorkbook(inboundWorkbook), false);
const inboundParsed = parseBpiDashboardWorkbook(inboundWorkbook, new Date(2026, 0, 1), 'INBOUND YTD REPORT.xlsx');
assert.equal(inboundParsed.records.length, 6);
assert.deepEqual(new Set(inboundParsed.records.map((record) => record.metric)), new Set(['Transmitted Count', 'Booked Volume']));
assert.deepEqual(
  inboundParsed.records.filter((record) => record.recordKind === 'ytd').map((record) => record.target),
  [15_000_000, 20_000_000]
);
assert.equal(
  inboundParsed.records.filter((record) => record.recordKind === 'agent_monitoring').every((record) => record.target == null),
  true
);
assert.equal(inboundParsed.records.every((record) => mapWorksheetCampaign(`${record.category} ${record.metric}`, campaigns).campaign.campaignName === 'BPI PA INBOUND'), true);

const plWorkbook = XLSX.utils.book_new();
const plJanuary = XLSX.utils.aoa_to_sheet([
  [null, 2026, null, null, 'JANUARY', null, null, null, null, null],
  [null, null, null, null, 'TRANSMITTED', null, 'APPROVALS', null, 'BOOKED', null],
  ['NUMBER', 'NAME', 'DATE HIRED', 'TYPE', 'COUNT', 'VOLUME', 'COUNT', 'VOLUME', 'COUNT', 'VOLUME'],
  [1, 'PL Agent', '2025-01-01', 'OLD', 5, 500_000, 4, 400_000, 3, 300_000],
]);
plJanuary['!merges'] = [
  XLSX.utils.decode_range('E1:J1'),
  XLSX.utils.decode_range('E2:F2'),
  XLSX.utils.decode_range('G2:H2'),
  XLSX.utils.decode_range('I2:J2'),
];
XLSX.utils.book_append_sheet(plWorkbook, plJanuary, 'JANUARY');
XLSX.utils.book_append_sheet(plWorkbook, XLSX.utils.aoa_to_sheet([
  ['SUMMARY'],
  [],
  ['TYPE', 'PLAN VOLUME PER AGENT'],
  ['OLD', 5_400_000],
  ['SEMI OLD', 4_000_000],
  ['NEW', 2_000_000],
]), 'SUMMARY');
assert.equal(isBpiDashboardWorkbook(plWorkbook, 'PERSONAL LOANS_YTD PRODUCTIVITY 2026.xlsx'), true);
const plParsed = parseBpiDashboardWorkbook(plWorkbook, new Date(2026, 0, 1), 'PERSONAL LOANS_YTD PRODUCTIVITY 2026.xlsx');
assert.equal(plParsed.records.length, 6);
assert.equal(plParsed.records.find((record) => record.metric === 'Booked Volume')?.target, 5_400_000);
assert.equal(plParsed.records.find((record) => record.metric === 'Booked Volume')?.achievement, 300_000 / 5_400_000);

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
