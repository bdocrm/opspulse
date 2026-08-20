import assert from "node:assert/strict";
import { buildCampaignMappingKey, uniqueCampaignMappingPairs } from "../lib/campaign-mapping";
import { buildCampaignMappings } from "../lib/production-import";
import { canCreateCampaignMappings, hasProductionCampaignAccess } from "../lib/production-access";
import { normalizeProductionName } from "../lib/production-normalization";
import { resolveCampaignEvidence } from "../lib/campaign-import-mapping";

const campaign = (id: string, name: string, isActive = true) => ({
  id, campaignName: name, normalizedName: normalizeProductionName(name), isActive,
  goalType: "count", monthlyGoal: 0, supplementaryGoal: 0, kpiMetric: "count",
  workingDays: 22, daysLapsed: 0, createdAt: new Date(), updatedAt: new Date(), productionAliases: [],
});
const record = (account: string, sourceCampaign: string) => ({
  rowKey: `${account}:${sourceCampaign}`, campaignSource: account, campaignNormalized: account.trim().replace(/\s+/g, " ").toUpperCase(),
  businessUnitSource: sourceCampaign, businessUnitNormalized: sourceCampaign.trim().replace(/\s+/g, " ").toUpperCase(),
  reportYear: 2026, reportMonth: 8, metricType: "count" as const, metricUnit: null, target: 1,
  week1: 1, week2: null, week3: null, week4: null, week5: null, mtd: 1, achievement: 1,
  runRate: null, workingDays: null, daysLapse: null, dateUpdated: null, sourceSheet: "Data", sourceRow: 2,
  sourceHash: "hash", issues: [],
});

assert.equal(buildCampaignMappingKey(" XSELL ", "SUPPLE  INVI"), buildCampaignMappingKey("xsell", " supple invi "));
assert.equal(uniqueCampaignMappingPairs([
  { sourceAccount: "XSELL", sourceCampaign: "ONLINE" },
  { sourceAccount: "BLUE 123", sourceCampaign: "ONLINE" },
]).length, 2, "same campaign label under different accounts must remain distinct");

const campaigns = [campaign("27", "SUPPLEMENTARY INVITE"), campaign("42", "BLUE 123 ONLINE CAMPAIGN")];
const saved = [
  { id: "m1", sourceAccount: "XSELL", normalizedSourceAccount: "XSELL", sourceCampaign: "SUPPLE INVI", normalizedSourceCampaign: "SUPPLE INVI", sourceSystem: "PRODUCTION_MONITORING", opsviewCampaignId: "27", opsviewCampaign: campaigns[0], status: "ACTIVE", mappingType: "MANUAL", notes: null, createdById: "u", updatedById: "u", createdAt: new Date(), updatedAt: new Date(), lastUsedAt: null, usageCount: 0 },
] as any;
const existing = buildCampaignMappings([record("XSELL", "SUPPLE INVI")], campaigns as any, saved);
assert.equal(existing[0].resolution, "EXPLICIT");
assert.equal(existing[0].matchedCampaignId, "27");

const accountScoped = buildCampaignMappings([
  record("XSELL", "ONLINE"),
  record("BLUE 123", "ONLINE"),
], campaigns as any, [
  { ...saved[0], id: "m2", sourceCampaign: "ONLINE", normalizedSourceCampaign: "ONLINE", opsviewCampaignId: "27", opsviewCampaign: campaigns[0] },
  { ...saved[0], id: "m3", sourceAccount: "BLUE 123", normalizedSourceAccount: "BLUE 123", sourceCampaign: "ONLINE", normalizedSourceCampaign: "ONLINE", opsviewCampaignId: "42", opsviewCampaign: campaigns[1] },
] as any);
assert.deepEqual(accountScoped.map((mapping) => mapping.matchedCampaignId), ["27", "42"]);

const unknown = buildCampaignMappings([record("XSELL", "UNLISTED")], campaigns as any, []);
assert.equal(unknown[0].matchedCampaignId, null, "suggestions must never auto-map");
assert.equal(unknown[0].requiresReview, true);

const inactive = [{ ...saved[0], opsviewCampaign: { ...campaigns[0], isActive: false } }];
assert.equal(buildCampaignMappings([record("XSELL", "SUPPLE INVI")], campaigns as any, inactive as any)[0].resolution, "INVALID");

const large = Array.from({ length: 50_000 }, (_, index) => record(`ACCOUNT ${index % 5}`, `CAMPAIGN ${index % 45}`));
assert.equal(buildCampaignMappings(large, campaigns as any, []).length, 45);

const knownDestinations = [
  campaign("sgm", "BDO SGM"), campaign("online", "BDO ONLINE"), campaign("nth", "BDO NTH CARD"),
  campaign("vc", "BDO VC"), campaign("supple", "BDO SUPPLE"), campaign("gaoc", "GAOC"),
  campaign("mobility", "AC MOBILITY"), campaign("bankard", "RBSC / BANKARD"),
];
const knownExpectations = [
  ["BLUE 123", "SGM", "sgm"], ["BLUE 123", "ONLINE", "online"],
  ["XSELL", "NTH CARD", "nth"], ["XSELL", "VIRTUAL", "vc"], ["XSELL", "SUPPLE INVI", "supple"],
  ["GAOC", "GAOC", "gaoc"], ["ACMOBILITY", "AC MOBILITY", "mobility"], ["RBSCXSLGFI", "BANKARD", "bankard"],
] as const;
for (const [account, source, destinationId] of knownExpectations) {
  const resolved = buildCampaignMappings([record(account, source)], knownDestinations as any, [])[0];
  assert.equal(resolved.resolution, "KNOWN_ALIAS", `${account} / ${source} should use its backend system rule`);
  assert.equal(resolved.matchedCampaignId, destinationId);
  assert.equal(resolved.newDepartmentName, null);
}
for (const [account, source, canonical] of [["GAOC", "GAOC", "GAOC"], ["ACMOBILITY", "AC MOBILITY", "AC MOBILITY"], ["RBSCXSLGFI", "BANKARD", "RBSC / BANKARD"]] as const) {
  const resolved = buildCampaignMappings([record(account, source)], [], [])[0];
  assert.equal(resolved.resolution, "NEW_DEPARTMENT");
  assert.equal(resolved.newDepartmentName, canonical);
}
const missingExistingXsell = buildCampaignMappings([record("XSELL", "VIRTUAL")], [], [])[0];
assert.equal(missingExistingXsell.resolution, "NEEDS_REVIEW");
assert.equal(missingExistingXsell.newDepartmentName, null, "known existing XSELL destinations must never be auto-created");
const dynamicMedicard = buildCampaignMappings(
  [record("MEDICARD", "NEW SOURCE CAMPAIGN")],
  [campaign("medicard", "MEDICARD")] as any,
  [],
)[0];
assert.equal(dynamicMedicard.resolution, "NEW_DEPARTMENT");
assert.equal(dynamicMedicard.newDepartmentName, "MEDICARD NEW SOURCE CAMPAIGN");
assert.notEqual(dynamicMedicard.matchedCampaignId, "medicard", "a distinct source campaign must never collapse into its parent account");
const existingDynamicMedicard = buildCampaignMappings(
  [record("MEDICARD", "NEW SOURCE CAMPAIGN")],
  [campaign("medicard", "MEDICARD"), campaign("child", "MEDICARD NEW SOURCE CAMPAIGN")] as any,
  [],
)[0];
assert.equal(existingDynamicMedicard.matchedCampaignId, "child");
const standaloneOnline = buildCampaignMappings(
  [record("UNSCOPED", "Online")],
  [campaign("online", "BDO Online")] as any,
  [],
)[0];
assert.equal(standaloneOnline.matchedCampaignId, "online");
assert.equal(resolveCampaignEvidence(["Online"], [
  { id: "online", campaignName: "BDO Online" },
  { id: "sgm", campaignName: "BDO SGM" },
]).campaign.id, "online", "single-label imports must resolve Online to BDO Online");
assert.equal(resolveCampaignEvidence(["PPN"], [
  { id: "ppn", campaignName: "MEDICARD PPN" },
  { id: "dental", campaignName: "MEDICARD DENTAL" },
]).campaign.id, "ppn", "dynamic scoped campaigns should resolve by a unique exact suffix");
assert.equal(canCreateCampaignMappings({ id: "collector", role: "COLLECTOR", campaignIds: ["27"] }), true);
assert.equal(canCreateCampaignMappings({ id: "agent", role: "AGENT", campaignIds: ["27"] }), false);
assert.equal(hasProductionCampaignAccess({ id: "collector", role: "COLLECTOR", campaignIds: ["27"] }, "42"), false);
console.log("Campaign mapping tests passed.");
