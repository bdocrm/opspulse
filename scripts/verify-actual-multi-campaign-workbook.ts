import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseCampaignSummaryWorksheet } from "../lib/campaign-summary-import";
import {
  calculateCampaignAchievement,
  summarizeCampaignAchievements,
} from "../lib/campaign-achievement";

const fileName = "OM Dashboard 2025.xlsx";
const workbook = XLSX.readFile(fileName, {
  cellDates: true,
  cellFormula: true,
});

const campaigns = [
  "BPI PA OUTBOUND", "BPI PA INBOUND", "BPI PL", "BPI BL",
  "MB ACQ", "MB PL", "MB PA", "BDO SGM", "BDO CIE",
  "BDO SUPPLE", "BDO VC", "BDO NTH CARD", "AXA", "AXA CLP",
  "CBC", "CBC HPL", "MEDICARD",
].map((campaignName, index) => ({ id: String(index + 1), campaignName }));
const monthlySheets = workbook.SheetNames.slice(0, 12);
const mappedCampaigns = new Set<string>();
const detectedHeaders = new Set<string>();
let validRows = 0;
const importedRows = new Map<string, NonNullable<ReturnType<typeof parseCampaignSummaryWorksheet>>["entries"][number]>();
for (const sheetName of monthlySheets) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
  const parsed = parseCampaignSummaryWorksheet(
    rows,
    sheetName,
    campaigns,
    new Date(2025, monthlySheets.indexOf(sheetName), 1)
  );
  assert.ok(parsed, `${sheetName} was not detected as a Campaign Summary worksheet`);
  parsed.detectedHeaders.forEach((header) => detectedHeaders.add(header));
  parsed.detectedCampaigns.forEach((campaign) => mappedCampaigns.add(campaign));
  validRows += parsed.entries.length;
  for (const entry of parsed.entries) {
    const key = `${entry.campaignId}|${entry.reportDate.getFullYear()}|${entry.reportDate.getMonth() + 1}`;
    if (!importedRows.has(key)) importedRows.set(key, entry);
  }
}

assert.ok(workbook.SheetNames.length > 1);
assert.ok(mappedCampaigns.size > 1);
assert.ok(validRows > monthlySheets.length);
assert.ok(detectedHeaders.has("Campaign"));
assert.ok(detectedHeaders.has("GOAL"));
assert.ok(detectedHeaders.has("MTD"));
assert.ok(detectedHeaders.has("Achievement"));

const aliasFixture = parseCampaignSummaryWorksheet(
  [
    ["Campaign Name", "Team Goal", "Actual Collection", "Achievement"],
    ["  bpi   pa inbound  ", "₱1,000.00", "1,250.50", "125.05%"],
    [],
  ],
  "July",
  campaigns,
  new Date(2026, 6, 1)
);
assert.equal(aliasFixture?.entries.length, 1);
assert.equal(aliasFixture?.entries[0].campaignName, "BPI PA INBOUND");
assert.equal(aliasFixture?.entries[0].monthlyGoal, 1000);
assert.equal(aliasFixture?.entries[0].monthlyActual, 1250.5);
assert.ok(Math.abs(Number(aliasFixture?.entries[0].monthlyAchievement) - 1.2505) < 1e-10);

const julyAchievements = [...importedRows.values()]
  .filter((entry) => entry.reportDate.getMonth() === 6)
  .map((entry) =>
    calculateCampaignAchievement({
      campaignId: entry.campaignId,
      campaignName: entry.campaignName,
      production: Number(entry.monthlyActual || 0),
      goal: entry.monthlyGoal ?? null,
      agentCount: 1,
      recordCount: 1,
    })
  );
const julySummary = summarizeCampaignAchievements(julyAchievements);
assert.ok(julyAchievements.length > 10);
assert.equal(julySummary.campaignCount, julyAchievements.length);
assert.ok(julySummary.campaignsWithProduction > 1);
assert.ok(julySummary.highestCampaign);
assert.ok(julySummary.lowestCampaign);

console.log(
  JSON.stringify(
    {
      fileName,
      worksheetsDetected: workbook.SheetNames,
      worksheetsAccepted: monthlySheets,
      detectedHeaders: [...detectedHeaders],
      records: validRows,
      mappedCampaigns: [...mappedCampaigns].sort(),
      julyCampaignAchievement: {
        campaigns: julyAchievements.length,
        campaignsWithProduction: julySummary.campaignsWithProduction,
        totalProduction: julySummary.totalProduction,
        totalGoal: julySummary.totalGoal,
        overallAchievementPercent: julySummary.overallAchievementPercent,
      },
    },
    null,
    2
  )
);
