import assert from "node:assert/strict";
import { summarizeProductionMonitoringForDashboard } from "../lib/production-monitoring-dashboard";

const now = new Date("2026-08-20T00:00:00.000Z");
const summaries = summarizeProductionMonitoringForDashboard([
  { campaignId: "medicard-ppn", reportYear: 2026, reportMonth: 7, metricType: "percentage", target: 0.85, mtd: 0.95, updatedAt: now },
  { campaignId: "medicard-ppn", reportYear: 2026, reportMonth: 8, metricType: "percentage", target: 0.85, mtd: 0.98, updatedAt: now },
  { campaignId: "medicard-dental", reportYear: 2026, reportMonth: 8, metricType: "percentage", target: null, mtd: 0.91, updatedAt: now },
  { campaignId: "bdo-online", reportYear: 2026, reportMonth: 8, metricType: "volume", target: 3300, mtd: 608, updatedAt: now },
]);

assert.equal(summaries.size, 3, "one card must be produced per canonical campaign ID");
assert.equal(summaries.get("medicard-ppn")?.recordCount, 2);
assert.equal(summaries.get("medicard-ppn")?.periodCount, 2);
assert.equal(summaries.get("medicard-ppn")?.goal, 1.7);
assert.equal(summaries.get("medicard-ppn")?.actual, 1.93);
assert.equal(summaries.get("medicard-dental")?.goal, null, "missing goal must not become zero");
assert.equal(summaries.get("medicard-dental")?.actual, 0.91, "production remains visible without a goal");
assert.equal(summaries.get("bdo-online")?.goal, 3300);
assert.equal(summaries.get("bdo-online")?.actual, 608);
console.log("Production monitoring dashboard aggregation tests passed.");

