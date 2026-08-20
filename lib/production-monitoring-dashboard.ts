export type ProductionMonitoringDashboardRecord = {
  campaignId: string;
  reportYear: number;
  reportMonth: number;
  metricType: string;
  target: number | null;
  mtd: number | null;
  updatedAt: Date;
};

export type ProductionMonitoringCampaignSummary = {
  campaignId: string;
  goal: number | null;
  actual: number | null;
  achievementPercent: number | null;
  metricType: string;
  recordCount: number;
  periodCount: number;
  lastUpdated: Date;
};

/** Campaign-ID aggregation for imported monitoring rows in an already-filtered period. */
export function summarizeProductionMonitoringForDashboard(
  records: ProductionMonitoringDashboardRecord[],
) {
  const grouped = new Map<string, {
    goal: number;
    actual: number;
    hasGoal: boolean;
    hasActual: boolean;
    metricTypes: Set<string>;
    periods: Set<string>;
    recordCount: number;
    lastUpdated: Date;
  }>();

  for (const record of records) {
    const current = grouped.get(record.campaignId) ?? {
      goal: 0,
      actual: 0,
      hasGoal: false,
      hasActual: false,
      metricTypes: new Set<string>(),
      periods: new Set<string>(),
      recordCount: 0,
      lastUpdated: record.updatedAt,
    };
    if (record.target != null) {
      current.goal += Number(record.target);
      current.hasGoal = true;
    }
    if (record.mtd != null) {
      current.actual += Number(record.mtd);
      current.hasActual = true;
    }
    current.metricTypes.add(record.metricType);
    current.periods.add(`${record.reportYear}-${record.reportMonth}`);
    current.recordCount += 1;
    if (record.updatedAt > current.lastUpdated) current.lastUpdated = record.updatedAt;
    grouped.set(record.campaignId, current);
  }

  return new Map<string, ProductionMonitoringCampaignSummary>([...grouped].map(([campaignId, value]) => {
    const goal = value.hasGoal && value.goal > 0 ? value.goal : null;
    const actual = value.hasActual ? value.actual : null;
    return [campaignId, {
      campaignId,
      goal,
      actual,
      achievementPercent: goal != null && actual != null ? (actual / goal) * 100 : null,
      metricType: value.metricTypes.size === 1 ? [...value.metricTypes][0] : "custom",
      recordCount: value.recordCount,
      periodCount: value.periods.size,
      lastUpdated: value.lastUpdated,
    }];
  }));
}

