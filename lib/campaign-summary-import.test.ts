import { describe, expect, it } from "vitest";
import { parseCampaignSummaryWorksheet } from "./campaign-summary-import";
import { resolveCampaignEvidence, resolveRecordCampaign } from "./campaign-import-mapping";

const names = ["MEDICARD", "MEDICARD PPN", "MEDICARD DENTAL", "MEDICARD DENTAL BO", "CBC", "CBC PA", "CBC ACQUI", "MB ACQ", "RBSC", "BDO SUPPLE", "BDO SUPPLE INVI", "BO"];
const campaigns = names.map(campaignName => ({ id: campaignName, campaignName }));
const date = new Date("2026-08-01T00:00:00Z");

describe("campaign summary matching", () => {
  it("imports exact campaign names independently of shorter names and shared aliases", () => {
    const result = parseCampaignSummaryWorksheet([
      ["Campaign", "Goal", "MTD"],
      ...names.map(name => [name, 100, 50]),
    ], "Sheet1", campaigns, date)!;
    expect(result.invalidRows).toBe(0);
    expect(result.entries.map(row => row.campaignId)).toEqual(names);
  });

  it.each(["MEDICARD PPN", "MEDICARD DENTAL BO", "CBC ACQUI", "BDO SUPPLE INVI"])("prioritizes the exact worksheet name %s", name => {
    expect(resolveCampaignEvidence([name], campaigns).campaign.id).toBe(name);
  });

  it.each(["RBSC", "CBC PA", "CBC ACQUI", "MEDICARD PPN", "UNKNOWN"])("does not redirect an unselected campaign %s into the single selected campaign", name => {
    const result = parseCampaignSummaryWorksheet([["Campaign", "MTD"], [name, 50]], "Sheet1", [{ id: "mb", campaignName: "MB ACQ" }], date)!;
    expect(result.entries).toHaveLength(0);
    expect(result.invalidRows).toBe(1);
    expect(result.warnings[0]).toContain("ask an administrator to assign");
    expect(result.errors).toHaveLength(1);
  });

  it("accepts explicit known aliases without guessing from a partial campaign name", () => {
    expect(resolveRecordCampaign("Virtual Card", campaigns.concat({ id: "vc", campaignName: "BDO VC" }))?.id).toBe("vc");
    expect(resolveRecordCampaign("MEDICARD PPN EXTRA", campaigns)).toBeNull();
  });

  it("rejects duplicate normalized names instead of choosing an arbitrary campaign", () => {
    expect(resolveRecordCampaign("RBSC", [{ id: "a", campaignName: "RBSC" }, { id: "b", campaignName: "rbsc" }])).toBeNull();
  });
});
