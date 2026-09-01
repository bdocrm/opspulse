import { describe, it, expect } from "vitest";
import {
  computeMTD,
  achievementPct,
  daysLapsed,
  runRate,
  rrAchievementPct,
  getWorkingDaysInMonth,
  getWorkingDaysElapsed,
  weekBucket,
  groupByWeek,
  kpiColor,
  kpiColorClass,
  kpiColorHex,
  periodLabel,
  WORKING_DAYS_DEFAULT,
} from "@/utils/kpi";

const row = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-05-01",
  transmittals: 0,
  activations: 0,
  approvals: 0,
  booked: 0,
  qualityRate: null,
  conversionRate: null,
  volume: 0,
  transaction: 0,
  ...overrides,
});

describe("computeMTD", () => {
  it("aggregates every production field for ALL KPI", () => {
    const rows = [
      row({ transmittals: 10, activations: 2, approvals: 8, booked: 6, volume: 100, transaction: 4 }),
      row({ transmittals: 5, activations: 1, approvals: 4, booked: 3, volume: 50, transaction: 2 }),
    ];
    expect(computeMTD(rows, "allKpi")).toBe(195);
  });

  it("sums counting metrics", () => {
    const rows = [
      row({ transmittals: 5 }),
      row({ transmittals: 10 }),
      row({ transmittals: 15 }),
    ];
    expect(computeMTD(rows, "transmittals")).toBe(30);
  });

  it("averages rate metrics", () => {
    const rows = [
      row({ qualityRate: 80 }),
      row({ qualityRate: 100 }),
      row({ qualityRate: 90 }),
    ];
    expect(computeMTD(rows, "qualityRate")).toBe(90);
  });

  it("returns 0 for empty rows", () => {
    expect(computeMTD([], "transmittals")).toBe(0);
  });
});

describe("achievementPct", () => {
  it("computes percentage of goal", () => {
    expect(achievementPct(50, 100)).toBe(50);
    expect(achievementPct(120, 100)).toBe(120);
  });

  it("returns 0 when goal is 0", () => {
    expect(achievementPct(50, 0)).toBe(0);
  });
});

describe("daysLapsed", () => {
  it("counts unique dates", () => {
    const rows = [
      row({ date: "2026-05-01" }),
      row({ date: "2026-05-01" }),
      row({ date: "2026-05-02" }),
    ];
    expect(daysLapsed(rows)).toBe(2);
  });
});

describe("getWorkingDaysInMonth", () => {
  it("May 2026 has 21 working days", () => {
    // May 2026: Fridays are 1,8,15,22,29; weekends excluded. 31 days -> 21 weekdays
    expect(getWorkingDaysInMonth(2026, 4)).toBe(21);
  });

  it("February of a leap year", () => {
    // Feb 2024 has 29 days, Feb 1 = Thursday. 21 weekdays
    expect(getWorkingDaysInMonth(2024, 1)).toBe(21);
  });
});

describe("getWorkingDaysElapsed", () => {
  it("counts weekdays up to the given day inclusive", () => {
    // 2026-05-11 is a Monday. Weekdays: 1(Fri),4,5,6,7,8,11 -> 7
    expect(getWorkingDaysElapsed(new Date(2026, 4, 11))).toBe(7);
  });
});

describe("runRate", () => {
  it("projects MTD across full month", () => {
    // mtd=10, elapsed=5, working=22 -> (10/5)*22 = 44
    expect(runRate(10, 5, 22)).toBe(44);
  });

  it("defaults working days to 22", () => {
    expect(runRate(10, 5)).toBe((10 / 5) * WORKING_DAYS_DEFAULT);
  });

  it("calculates elapsed from reference date when not provided", () => {
    expect(runRate(10, 0, 22, new Date(2026, 4, 11))).toBe((10 / 7) * 22);
  });

  it("returns 0 when elapsed is 0", () => {
    expect(runRate(10, 0, 22)).toBe(0);
  });
});

describe("rrAchievementPct", () => {
  it("computes run-rate achievement", () => {
    expect(rrAchievementPct(88, 200)).toBe(44);
  });

  it("returns 0 when goal is 0", () => {
    expect(rrAchievementPct(50, 0)).toBe(0);
  });
});

describe("weekBucket", () => {
  it("buckets days by week", () => {
    expect(weekBucket(1)).toBe("W1");
    expect(weekBucket(7)).toBe("W1");
    expect(weekBucket(8)).toBe("W2");
    expect(weekBucket(15)).toBe("W3");
    expect(weekBucket(22)).toBe("W4");
    expect(weekBucket(29)).toBe("W5");
  });
});

describe("groupByWeek", () => {
  it("groups ALL KPI without including percentage rates", () => {
    const rows = [
      row({ date: "2026-05-01", transmittals: 2, approvals: 1, booked: 1, volume: 10, qualityRate: 99 }),
      row({ date: "2026-05-08", activations: 3, transaction: 4, conversionRate: 80 }),
    ];
    const result = groupByWeek(rows, "allKpi");
    expect(result.W1).toBe(14);
    expect(result.W2).toBe(7);
  });

  it("groups counting metric by week", () => {
    const rows = [
      row({ date: "2026-05-01", transmittals: 5 }),
      row({ date: "2026-05-02", transmittals: 5 }),
      row({ date: "2026-05-08", transmittals: 10 }),
      row({ date: "2026-05-25", transmittals: 100 }),
      row({ date: "2026-05-30", transmittals: 200 }),
    ];
    const result = groupByWeek(rows, "transmittals");
    expect(result.W1).toBe(10);
    expect(result.W2).toBe(10);
    expect(result.W4).toBe(100);
    expect(result.W5).toBe(200);
    expect(result.W3).toBe(0);
  });
});

describe("kpiColor", () => {
  it("maps thresholds to colors", () => {
    expect(kpiColor(50)).toBe("red");
    expect(kpiColor(80)).toBe("yellow");
    expect(kpiColor(99)).toBe("yellow");
    expect(kpiColor(100)).toBe("green");
    expect(kpiColor(150)).toBe("green");
  });
});

describe("kpiColorClass", () => {
  it("returns tailwind class per color", () => {
    expect(kpiColorClass(50)).toContain("red");
    expect(kpiColorClass(90)).toContain("yellow");
    expect(kpiColorClass(100)).toContain("green");
  });
});

describe("kpiColorHex", () => {
  it("returns hex per color", () => {
    expect(kpiColorHex(50)).toBe("#ef4444");
    expect(kpiColorHex(90)).toBe("#eab308");
    expect(kpiColorHex(100)).toBe("#22c55e");
  });
});

describe("periodLabel", () => {
  it("capitalizes the label", () => {
    expect(periodLabel("daily")).toBe("Daily");
    expect(periodLabel("monthly")).toBe("Monthly");
  });
});
