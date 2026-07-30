import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  isBdoSgmConsolidatedWorksheet,
  parseBdoSgmConsolidatedWorksheet,
} from '../lib/bdo-sgm-consolidated-import';

const months = [
  ' January ', 'FEBRUARY', 'March', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

function fixtureWorkbook() {
  const parent = ['', '', ...months.flatMap((month) => [month, '']), 'TOTAL', '', '', 'TOTAL', '', '', 'TOTAL OF WHOLE YEAR', '', ''];
  const metrics = [
    ' nickname ', 'Names',
    ...months.flatMap(() => ['Final FC Total', 'FINAL  BC  TOTAL']),
    'Total FC', 'Total BC', 'Ranking',
    'Total FC', 'Total BC', 'Ranking',
    'TOTAL FC', 'TOTAL BC', 'RANKING',
  ];
  const agentOneMonths = [
    10, 0, '20', 5, null, 2, 4, 1, 6, 3, 8, 4,
    null, null, null, null, null, null, null, null, null, null, null, null,
  ];
  const agentTwoMonths = Array.from({ length: 24 }, (_, index) => index === 0 ? 0 : null);
  const rows = [
    ['Decorative report title'],
    [],
    parent,
    metrics,
    ['ALPHA', 'AGENT, ALPHA TEST', ...agentOneMonths, 48, 15, 1, 0, 0, 1, 999, 15, 1],
    ['ZERO', 'AGENT, ZERO TEST', ...agentTwoMonths, 0, 0, 2, 0, 0, 2, 0, 0, 2],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!merges'] = [];
  for (let column = 2; column < 26; column += 2) {
    worksheet['!merges'].push({ s: { r: 2, c: column }, e: { r: 2, c: column + 1 } });
  }
  worksheet['!merges'].push(
    { s: { r: 2, c: 26 }, e: { r: 2, c: 28 } },
    { s: { r: 2, c: 29 }, e: { r: 2, c: 31 } },
    { s: { r: 2, c: 32 }, e: { r: 2, c: 34 } },
  );
  return worksheet;
}

const worksheet = fixtureWorkbook();
assert.equal(isBdoSgmConsolidatedWorksheet(worksheet, ' hoh '), true);

const monthly = parseBdoSgmConsolidatedWorksheet(worksheet, 'HOH', new Date(2026, 1, 1), 'monthly');
assert.equal(monthly.detected, true);
assert.equal(monthly.format, 'BDO SGM Consolidated');
assert.equal(monthly.validAgentRows, 2);
assert.equal(monthly.records.length, 12);
assert.deepEqual(monthly.detectedCardLevels, ['FIRST_CARD', 'BUNDLE_CARD']);

const alpha = monthly.agents.find((agent) => agent.nickname === 'ALPHA')!;
assert.equal(alpha.fcMonths[0].value, 10);
assert.equal(alpha.fcMonths[1].value, 20);
assert.equal(alpha.fcMonths[2].available, false);
assert.equal(alpha.bcMonths[0].value, 0);
assert.equal(alpha.bcMonths[0].available, true);
assert.equal(alpha.wholeYearTotalFc, 48);
assert.equal(alpha.wholeYearTotalBc, 15);
assert.equal(alpha.finalFcTotal, 20);
assert.equal(alpha.finalBcTotal, 5);
assert.equal(alpha.ranking, 1);
assert.equal(alpha.validationStatus, 'Warning');
assert.ok(alpha.warnings.some((warning) => warning.includes('Whole-Year FC mismatch')));

const zero = monthly.agents.find((agent) => agent.nickname === 'ZERO')!;
assert.equal(zero.fcMonths[0].value, 0);
assert.equal(zero.fcMonths[0].available, true);
assert.equal(zero.fcMonths[1].available, false);
assert.equal(zero.wholeYearTotalFc, 0);

const februaryAlpha = monthly.records.filter(
  (record) => record.name === alpha.fullName && record.reportDate.getMonth() === 1,
);
assert.equal(februaryAlpha.length, 2);
assert.equal(februaryAlpha.find((record) => record.cardLevel === 'FIRST_CARD')?.count, 20);
assert.equal(februaryAlpha.find((record) => record.cardLevel === 'BUNDLE_CARD')?.count, 5);

const daily = parseBdoSgmConsolidatedWorksheet(worksheet, 'HOH', new Date(2026, 2, 15), 'daily');
const dailyAlpha = daily.agents.find((agent) => agent.nickname === 'ALPHA')!;
assert.equal(dailyAlpha.finalFcTotal, 30);
assert.equal(dailyAlpha.finalBcTotal, 7);
assert.equal(daily.records.filter((record) => record.name === dailyAlpha.fullName).length, 2);
assert.ok(daily.records.every((record) => record.reportDate.getDate() === 15));

const yearly = parseBdoSgmConsolidatedWorksheet(worksheet, 'HOH', new Date(2026, 0, 1), 'yearly');
const yearlyAlpha = yearly.agents.find((agent) => agent.nickname === 'ALPHA')!;
assert.equal(yearlyAlpha.finalFcTotal, 48);
assert.equal(yearlyAlpha.finalBcTotal, 15);
assert.equal(yearly.records.length, 4);

const realWorkbookPath = path.join(process.env.USERPROFILE || '', 'Downloads', '✔!CONSOLIDATED REPORTS.xlsx');
if (fs.existsSync(realWorkbookPath)) {
  const workbook = XLSX.readFile(realWorkbookPath, { cellDates: true, cellFormula: true });
  const result = parseBdoSgmConsolidatedWorksheet(workbook.Sheets.HOH, 'HOH', new Date(2026, 6, 1), 'monthly');
  assert.equal(result.detected, true);
  assert.equal(result.validAgentRows, 25);
  assert.equal(result.records.length, 300);
  assert.equal(result.periodTotals.wholeYearTotalFc, 31_825);
  assert.equal(result.periodTotals.wholeYearTotalBc, 20_229);
  assert.equal(result.periodTotals.finalFcTotal, 0);
  assert.equal(result.periodTotals.finalBcTotal, 0);
  assert.equal(result.agents[0].ranking, 1);
}

console.log('BDO SGM consolidated import parser tests passed.');
