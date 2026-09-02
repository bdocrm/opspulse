import { describe, expect, it } from "vitest";
import { resolveCampaignGoal } from "./campaign-achievement";

describe("resolveCampaignGoal", () => {
  it("uses the CEO-configured monthly goal before imported agent totals", () => {
    expect(resolveCampaignGoal({
      configuredGoal: 80_000_000,
      importedCampaignGoal: 40_000_000,
      fallbackGoal: 40_000_000,
    })).toBe(80_000_000);
  });

  it("falls back to an imported goal when the month has no configured goal", () => {
    expect(resolveCampaignGoal({
      configuredGoal: null,
      importedCampaignGoal: 40_000_000,
      fallbackGoal: 20_000_000,
    })).toBe(40_000_000);
  });

  it("returns null when no source contains a valid positive goal", () => {
    expect(resolveCampaignGoal({ configuredGoal: 0, importedCampaignGoal: null })).toBeNull();
  });
});
