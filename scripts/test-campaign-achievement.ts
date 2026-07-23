import assert from "node:assert/strict";
import {
  calculateCampaignAchievement,
  summarizeCampaignAchievements,
} from "../lib/campaign-achievement";

const campaigns = [
  calculateCampaignAchievement({
    campaignId: "complete",
    campaignName: "BPI PA INBOUND",
    production: 150,
    goal: 100,
    agentCount: 2,
    recordCount: 4,
  }),
  calculateCampaignAchievement({
    campaignId: "zero",
    campaignName: "BPI PL",
    production: 0,
    goal: 200,
    agentCount: 1,
    recordCount: 2,
  }),
  calculateCampaignAchievement({
    campaignId: "missing-goal",
    campaignName: "BPI BL",
    production: 50,
    goal: null,
    agentCount: 1,
    recordCount: 1,
  }),
  calculateCampaignAchievement({
    campaignId: "no-production",
    campaignName: "BPI PA OUTBOUND",
    production: 0,
    goal: 300,
    agentCount: 3,
    recordCount: 0,
    hasCampaignConfiguration: true,
  }),
  calculateCampaignAchievement({
    campaignId: "no-data",
    campaignName: "Unconfigured",
    production: 0,
    goal: null,
    agentCount: 0,
    recordCount: 0,
  }),
];

assert.equal(campaigns[0].achievementPercent, 150);
assert.equal(campaigns[0].dataStatus, "complete");
assert.equal(campaigns[1].achievementPercent, 0);
assert.equal(campaigns[1].dataStatus, "zero-production");
assert.equal(campaigns[2].achievementPercent, null);
assert.equal(campaigns[2].goalStatus, "missing");
assert.equal(campaigns[2].dataStatus, "missing-goal");
assert.equal(campaigns[3].dataStatus, "no-production-records");
assert.equal(campaigns[4].dataStatus, "no-imported-data");

const summary = summarizeCampaignAchievements(campaigns);
assert.equal(summary.campaignCount, 5);
assert.equal(summary.campaignsWithProduction, 2);
assert.equal(summary.campaignsWithoutProduction, 3);
assert.equal(summary.campaignsWithoutGoal, 2);
assert.equal(summary.totalProduction, 200);
assert.equal(summary.totalGoal, 600);
assert.ok(Math.abs(Number(summary.overallAchievementPercent) - 100 / 3) < 1e-10);
assert.equal(summary.averageAchievementPercent, 50);
assert.equal(summary.highestCampaign?.campaignId, "complete");
assert.equal(summary.lowestCampaign?.campaignId, "no-production");

console.log(JSON.stringify({ campaigns, summary }, null, 2));
