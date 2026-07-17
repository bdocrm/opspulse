import assert from 'node:assert/strict';
import { isMbPaMonthlyLayout, parseMbPaMonthlyRows } from '../lib/mb-pa-import';

const rows = [
  [null, null, 'JANUARY', null, null, null, null, null, null, null, null, null, 'JAN ACHIEVEMENT', 'FEBRUARY', null, null, null, null, null, null, null, null, null, 'FEB ACHIEVEMENT'],
  ['CODE', 'NAME', 'TRANS', null, null, 'BILLINGS', null, null, 'TOTAL', null, null, null, null, 'TRANS', null, null, 'BILLINGS', null, null, 'TOTAL'],
  [null, null, 'C2G', 'BT', 'BALCON', 'C2G', 'BT', 'BALCON', 'TOTAL TRANS', 'TOTAL BILLINGS', 'TIER', 'TARGET', '% ACHIEVEMENT', 'C2G', 'BT', 'BALCON', 'C2G', 'BT', 'BALCON', 'TOTAL TRANS', 'TOTAL BILLINGS', 'TIER', 'TARGET', '% ACHIEVEMENT'],
  ['sgcastillote', 'CASTILLOTE, SAMANTHA GAY .', 39, 2, 11, 11_492_124, 149_575, 428_748, 52, 12_070_447, 'Tier 1', 10_257_303, 1.18, 55, 8, 28, 9_622_998, 865_342, 2_495_204, 91, 12_983_544, 'Tier 1', 10_257_303, 1.27],
  ['addomingo', 'DOMINGO, AUDREY DELA TORRE', 45, 2, 22, 11_592_563, 206_000, 1_723_786, 69, 13_522_349, 'Tier 1', 10_257_303, 1.32, null, null, null, null, null, null, 0, 0, 'Tier 2', 4_000_000, '0%'],
];

const parsed = parseMbPaMonthlyRows(rows, new Date(2026, 6, 1));
assert.equal(isMbPaMonthlyLayout(rows), true);
assert.equal(isMbPaMonthlyLayout([['NAME', 'TRANSMITTED', 'VOLUME']]), false);
assert.ok(parsed);
assert.equal(parsed.entries.length, 4);

const january = parsed.entries.find((entry) => entry.name.startsWith('CASTILLOTE') && entry.reportDate.getMonth() === 0)!;
assert.equal(january.reportDate.getFullYear(), 2026);
assert.equal(january.reportDate.getMonth(), 0);
assert.deepEqual(
  [january.c2gTxn, january.btTxn, january.balconTxn, january.grandTotalTxn],
  [39, 2, 11, 52],
);
assert.deepEqual(
  [january.c2gVol, january.btVol, january.balconVol, january.grandTotalVol],
  [11_492_124, 149_575, 428_748, 12_070_447],
);
assert.equal(january.agentLevel, 'Tier 1');
assert.equal(january.monthlyGoal, 10_257_303);
assert.equal(january.monthlyAchievement, 1.18);

const february = parsed.entries.find((entry) => entry.name.startsWith('CASTILLOTE') && entry.reportDate.getMonth() === 1)!;
assert.equal(february.reportDate.getMonth(), 1);
assert.equal(february.grandTotalTxn, 91);
assert.equal(february.grandTotalVol, 12_983_544);

const zeroFebruary = parsed.entries.find((entry) => entry.name.startsWith('DOMINGO') && entry.reportDate.getMonth() === 1)!;
assert.equal(zeroFebruary.grandTotalTxn, 0);
assert.equal(zeroFebruary.grandTotalVol, 0);
assert.equal(zeroFebruary.monthlyAchievement, 0);

console.log('MB PA monthly import parser tests passed.');
