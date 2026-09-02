import { describe, expect, it } from "vitest";
import {
  compareMonthlyProductionRank,
  isPrimaryImportedPerformanceRecord,
  mostCommonImportedTarget,
  resolveImportedAgentGoals,
  shouldIncludeImportedReportAgent,
} from "./agent-goal-allocation";

describe("compareMonthlyProductionRank", () => {
  it("puts the highest monthly actual first even when its achievement is lower", () => {
    const rows = [
      { name: "Higher actual", achievement: 150, actual: 3_000_000 },
      { name: "Top achievement", achievement: 200, actual: 2_000_000 },
    ].sort(compareMonthlyProductionRank);

    expect(rows.map((row) => row.name)).toEqual(["Higher actual", "Top achievement"]);
  });

  it("uses achievement and then name to keep actual ties stable", () => {
    const rows = [
      { name: "Zulu", achievement: 100, actual: 2_000_000 },
      { name: "Alpha", achievement: 100, actual: 2_000_000 },
      { name: "Highest actual", achievement: 100, actual: 3_000_000 },
    ].sort(compareMonthlyProductionRank);

    expect(rows.map((row) => row.name)).toEqual(["Highest actual", "Alpha", "Zulu"]);
  });
});

describe("resolveImportedAgentGoals", () => {
  it("does not manufacture agent goals from the campaign goal", () => {
    const result = resolveImportedAgentGoals({
      a: { goal: 0, actual: 750_000, achievement: 0 },
      b: { goal: 0, actual: 250_000, achievement: 0 },
    });

    expect(result.a.goal).toBe(0);
    expect(result.b.goal).toBe(0);
    expect(result.a.achievement).toBe(0);
    expect(result.b.achievement).toBe(0);
  });

  it("retains exact agent goals from the imported performance rows", () => {
    const result = resolveImportedAgentGoals({
      a: { goal: 40, actual: 40, achievement: 100 },
      b: { goal: 0, actual: 30, achievement: 0 },
      c: { goal: 0, actual: 15, achievement: 0 },
    });

    expect(result.a.goal).toBe(40);
    expect(result.b.goal).toBe(0);
    expect(result.c.goal).toBe(0);
  });

  it("uses an imported agent target from another row in the same month", () => {
    const result = resolveImportedAgentGoals({
      a: { goal: 0, actual: 20, achievement: 0 },
      b: { goal: 0, actual: 80, achievement: 0 },
    }, { a: 20, b: 80 });

    expect(result.a.goal).toBe(20);
    expect(result.b.goal).toBe(80);
    expect(result.a.achievement).toBe(100);
    expect(result.b.achievement).toBe(100);
  });
});

describe("mostCommonImportedTarget", () => {
  it("recovers the common target from the same imported month", () => {
    expect(mostCommonImportedTarget([2_000_000, 2_000_000, null, 1_500_000])).toBe(2_000_000);
  });

  it("ignores blank, zero, and invalid targets", () => {
    expect(mostCommonImportedTarget([null, 0, Number.NaN])).toBe(0);
  });
});

describe("shouldIncludeImportedReportAgent", () => {
  it("removes zero-production agents when an imported report is selected", () => {
    expect(shouldIncludeImportedReportAgent(true, [0, null])).toBe(false);
    expect(shouldIncludeImportedReportAgent(true, [0, 25])).toBe(true);
  });

  it("does not hide configured agents from campaigns without imported reports", () => {
    expect(shouldIncludeImportedReportAgent(false, [0])).toBe(true);
  });
});

describe("isPrimaryImportedPerformanceRecord", () => {
  it("uses only Booked Volume from a monthly PL productivity funnel", () => {
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "PL_PRODUCTIVITY", metric: "Booked Volume" })).toBe(true);
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "PL_PRODUCTIVITY", metric: "Transmitted Volume" })).toBe(false);
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "PL_PRODUCTIVITY", metric: "Approvals Count" })).toBe(false);
  });

  it("keeps the single performance metric used by other imported dashboards", () => {
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "PA_AGENT", metric: "PA Performance" })).toBe(true);
  });

  it("always uses Booked Volume for BPI funnel reports", () => {
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "LEGACY_BPI", metric: "Transmitted Volume" }, "BPI PL")).toBe(false);
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "LEGACY_BPI", metric: "Approvals Volume" }, "BPI PA INBOUND")).toBe(false);
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "LEGACY_BPI", metric: "Booked Count" }, "BPI PA OUTBOUND")).toBe(false);
    expect(isPrimaryImportedPerformanceRecord({ monitoringType: "LEGACY_BPI", metric: "Booked Volume" }, "BPI PA OUTBOUND")).toBe(true);
  });
});
