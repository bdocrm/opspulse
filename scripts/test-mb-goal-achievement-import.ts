import assert from 'node:assert/strict';
import { isMbGoalAchievementLayout, parseMbGoalAchievementRows } from '../lib/mb-goal-achievement-import';
import { resolveCampaignEvidence } from '../lib/campaign-import-mapping';

const rows = [
  [null, null, null, null, null, null, 'JANUARY', null, null, null, null, null, null, null, null, 'FEBRUARY'],
  [null, null, null, null, null, null, 'TARGET', null, 'ACTUAL', null, '%', null, 'SCORE', null, null, 'TARGET'],
  [null, 'AGENT_FULLNAME', 'AGENT_CODE', 'STATUS', 'DATE ON BOARD', 'TENURE', 'NTB', 'SUPPLE', 'NTB', 'SUPPLE', 'NTB', 'SUPPLE', 'NTB', 'SUPPLE', 'ACHIEVEMENT', 'NTB'],
  [null, 'CABUNOC, RENELL BALELA', 'TAGC', 'ACTIVE', '2021-04-15', 'ELITE 2', 52, 26, 57, 20, '109.6%', '76.92%', '98.65%', '7.69%', '106.35%', 52],
  [null, 'ANG, ROSVERG A', 'TAZC', 'ACTIVE', '2025-11-14', 'START UP 2', 15, 7, 22, 19, '146.67%', '271.43%', '132%', '27.14%', '159.14%', 26],
];

assert.equal(isMbGoalAchievementLayout(rows), true);
assert.equal(isMbGoalAchievementLayout([['AGENT_FULLNAME', 'JANUARY', 'TARGET']]), false);

const parsed = parseMbGoalAchievementRows(rows, new Date(2026, 0, 1));
assert.ok(parsed);
assert.equal(parsed.entries.length, 4);

const january = parsed.entries.find((entry) => entry.name.startsWith('CABUNOC') && entry.reportDate.getMonth() === 0)!;
assert.equal(january.agentCode, 'TAGC');
assert.equal(january.agentType, 'ACTIVE');
assert.equal(january.agentLevel, 'ELITE 2');
assert.equal(january.dateHired?.getFullYear(), 2021);
assert.equal(january.ntb, 57);
assert.equal(january.supplementary, 20);
assert.equal(january.monthlyGoal, 52);
assert.equal(january.monthlyAchievement, 1.0635);
const ntbMetric = january.normalizedMetrics.find((metric) => metric.metricType === 'ntb')!;
assert.deepEqual(
  { ...ntbMetric, achievement: undefined },
  { metricType: 'ntb', count: 57, volume: null, goal: 52, actual: 57, achievement: undefined },
);
assert.ok(Math.abs((ntbMetric.achievement || 0) - 1.096) < 1e-10);
const supplementaryScore = january.normalizedMetrics.find((metric) => metric.metricType === 'supplementary_score')!;
assert.equal(supplementaryScore.metricType, 'supplementary_score');
assert.ok(Math.abs((supplementaryScore.actual || 0) - 0.0769) < 1e-10);

const february = parsed.entries.find((entry) => entry.name.startsWith('CABUNOC') && entry.reportDate.getMonth() === 1)!;
assert.equal(february.ntb, undefined);
assert.equal(february.monthlyGoal, 52);
assert.deepEqual(
  february.normalizedMetrics.find((metric) => metric.metricType === 'ntb'),
  { metricType: 'ntb', count: null, volume: null, goal: 52, actual: null, achievement: null },
);

const campaigns = [
  { id: 'acq', campaignName: 'MB ACQ' },
  { id: 'pl', campaignName: 'MB PL' },
  { id: 'pa', campaignName: 'MB PA' },
];
assert.equal(resolveCampaignEvidence(['Acqui'], campaigns).campaign.id, 'acq');
assert.equal(resolveCampaignEvidence(['PL'], campaigns).campaign.id, 'pl');
assert.equal(resolveCampaignEvidence(['MBPA 2026'], campaigns).campaign.id, 'pa');
assert.equal(
  resolveCampaignEvidence(['PL'], [...campaigns, { id: 'bpi-pl', campaignName: 'BPI PL' }]).source,
  'unresolved',
);

const plRows = [
  [null, 'AGENT_FULLNAME', null, null, 'JANUARY'],
  [null, null, null, null, 'TARGET', null, null, null, 'ACTUAL', null, null, null, '%', null, null, null, 'SCORE', null, null, null, 'ACHIEVEMENT'],
  [null, null, 'STATUS', 'TENURE', 'DISBURSED TXN', 'DISBURSED VOL', 'GROSS TURN INS TXN', 'GROSS TURN INS VOL', 'DISBURSED TXN', 'DISBURSED VOL', 'GROSS TURN INS TXN', 'GROSS TURN INS VOL', 'DISBURSED TXN', 'DISBURSED VOL', 'GROSS TURN INS TXN', 'GROSS TURN INS VOL', 'DISBURSED TXN', 'DISBURSED VOL', 'GROSS TURN INS TXN', 'GROSS TURN INS VOL'],
  [null, 'AGENT ONE', 'ACTIVE', 'CORE', 10, 750_000, 55, 4_091_103, 8, 600_000, 42, 3_100_000, 0.8, 0.8, 0.7636, 0.7577, 0.4, 0.4, 0.3818, 0.3788, 0.39],
];
const plParsed = parseMbGoalAchievementRows(plRows, new Date(2026, 0, 1));
assert.ok(plParsed);
assert.equal(plParsed.entries.length, 1);
const plEntry = plParsed.entries[0];
assert.equal(plEntry.volume, 600_000);
assert.deepEqual(
  plEntry.normalizedMetrics.find((metric) => metric.metricType === 'disbursed_volume'),
  { metricType: 'disbursed_volume', count: null, volume: 600_000, goal: 750_000, actual: 600_000, achievement: 0.8 },
);
assert.equal(plEntry.normalizedMetrics.find((metric) => metric.metricType === 'gross_turn_ins_transactions')?.count, 42);

const exactPlRows = [
  [null, null, null, null, null, null, 'JANUARY'],
  [null, null, null, null, null, null, 'TARGET', null, 'ACTUAL', null, '%', null, 'SCORE'],
  [null, 'AGENT_FULLNAME', 'AGENT_CODE', 'STATUS', 'DATE ON BOARD', 'TENURE', 'TRANS', 'VOL', 'TRANS', 'VOL', 'TRANS', 'VOL', 'TRANS .20%', 'VOL .80%', 'ACHIEVEMENT'],
  [null, 'PEREZ, JUSTINE', 'TBCQ', 'ACTIVE', '2025-07-02', 'CORE_DEPO', 6, 900_000, 5, 1_379_000, 0.83, 1.53, 0.17, 1.23, 1.39],
];
const exactPlParsed = parseMbGoalAchievementRows(exactPlRows, new Date(2026, 0, 1));
assert.ok(exactPlParsed);
assert.equal(exactPlParsed.entries.length, 1);
assert.deepEqual(exactPlParsed.entries[0].normalizedMetrics, [
  { metricType: 'transactions', count: 5, volume: null, goal: 6, actual: 5, achievement: 0.83 },
  { metricType: 'transactions_score', actual: 0.17 },
  { metricType: 'volume', count: null, volume: 1_379_000, goal: 900_000, actual: 1_379_000, achievement: 1.53 },
  { metricType: 'volume_score', actual: 1.23 },
  { metricType: 'overall', count: null, volume: null, goal: null, actual: null, achievement: 1.39 },
]);

console.log('MB goal/achievement import parser tests passed.');
