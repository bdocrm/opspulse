import assert from "node:assert/strict";
import { aggregateRunRateMetrics, calculateRunRateMetrics } from "../lib/run-rate-analytics";
import { parseImportNumber } from "../lib/import-number";
import { normalizeMetricHeader } from "../lib/metric-import-mapping";

const campaign = calculateRunRateMetrics({
  mtdProduction: 500_000,
  goal: 1_200_000,
  month: 7,
  year: 2026,
  configuredElapsedWorkingDays: 10,
  configuredTotalWorkingDays: 20,
  now: new Date(2026, 6, 15),
});
assert.equal(campaign.projectedRunRate, 1_000_000);
assert.ok(Math.abs(Number(campaign.runRateAchievementPercentage) - 83.3333333333) < 0.0001);

const agent = calculateRunRateMetrics({
  mtdProduction: 50_000,
  goal: 250_000,
  month: 7,
  year: 2026,
  configuredElapsedWorkingDays: 5,
  configuredTotalWorkingDays: 20,
  goalLevel: "agent",
  now: new Date(2026, 6, 8),
});
assert.equal(agent.projectedRunRate, 200_000);
assert.equal(agent.runRateAchievementPercentage, 80);

assert.equal(parseImportNumber("₱500,000").value, 500_000);
assert.equal(parseImportNumber("$1,200,000.50").value, 1_200_000.5);
assert.equal(parseImportNumber("85.4%").value, 85.4);
assert.equal(parseImportNumber("(2,500)").value, -2_500);
assert.equal(parseImportNumber("No Data").value, null);

const missingTeamGoal = calculateRunRateMetrics({
  mtdProduction: 500_000,
  goal: null,
  month: 7,
  year: 2026,
  configuredElapsedWorkingDays: 10,
  configuredTotalWorkingDays: 20,
  now: new Date(2026, 6, 15),
});
assert.equal(missingTeamGoal.projectedRunRate, 1_000_000);
assert.equal(missingTeamGoal.runRateAchievementPercentage, null);
assert.equal(missingTeamGoal.dataStatus, "missing_team_goal");

const missingAgentGoal = calculateRunRateMetrics({
  mtdProduction: 50_000,
  goal: 0,
  month: 7,
  year: 2026,
  configuredElapsedWorkingDays: 5,
  configuredTotalWorkingDays: 20,
  goalLevel: "agent",
  now: new Date(2026, 6, 8),
});
assert.equal(missingAgentGoal.projectedRunRate, 200_000);
assert.equal(missingAgentGoal.dataStatus, "missing_agent_goal");

assert.equal(normalizeMetricHeader(" BPI-PA_OUTBOUND "), "bpi pa outbound");

const secondCampaign = calculateRunRateMetrics({
  mtdProduction: 100_000,
  goal: 200_000,
  month: 7,
  year: 2026,
  configuredElapsedWorkingDays: 10,
  configuredTotalWorkingDays: 20,
  now: new Date(2026, 6, 15),
});
const combined = aggregateRunRateMetrics([campaign, secondCampaign]);
assert.equal(combined.projectedRunRate, 1_200_000);
assert.equal(combined.goal, 1_400_000);
assert.ok(Math.abs(Number(combined.runRateAchievementPercentage) - 85.7142857143) < 0.0001);

const pastMonth = calculateRunRateMetrics({
  mtdProduction: 500_000,
  goal: 1_200_000,
  month: 6,
  year: 2026,
  configuredElapsedWorkingDays: 5,
  configuredTotalWorkingDays: 20,
  now: new Date(2026, 6, 15),
});
assert.equal(pastMonth.elapsedWorkingDays, 20);
assert.equal(pastMonth.projectedRunRate, 500_000);

const future = calculateRunRateMetrics({
  mtdProduction: null,
  goal: 1_200_000,
  month: 8,
  year: 2026,
  now: new Date(2026, 6, 15),
});
assert.equal(future.dataStatus, "invalid_period");
assert.equal(future.projectedRunRate, null);

const zeroGoal = calculateRunRateMetrics({
  mtdProduction: 100,
  goal: 0,
  month: 7,
  year: 2026,
  configuredElapsedWorkingDays: 1,
  configuredTotalWorkingDays: 20,
  now: new Date(2026, 6, 1),
});
assert.equal(zeroGoal.runRateAchievementPercentage, null);
assert.ok(!Number.isNaN(Number(zeroGoal.projectedRunRate)));

console.log("Run-rate analytics tests passed.");
