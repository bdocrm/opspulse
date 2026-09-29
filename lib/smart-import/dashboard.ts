import type { RunRateMetrics } from "../run-rate-analytics";

export type SmartDashboardRecord = { campaignId: string; metricType: string; reportYear: number; reportMonth: number; target: number | null; mtd: number | null; achievement: number | null; runRate: number | null; rrAchievement: number | null; workingDays: number | null; daysLapse: number | null; dateUpdated: Date | null; updatedAt: Date; reportStatus: string | null };
export type DashboardConfig = { campaignId: string; goalType: string; unitType: string; aggregationMethod: string; goalDirection: string; isPrimary: boolean; label: string; decimalPrecision: number };
export function chooseDashboardRecords<T extends { campaignId: string; metricType: string }>(records: T[], configs: DashboardConfig[]) {
  const grouped = new Map<string, T[]>();
  for (const row of records) grouped.set(row.campaignId, [...(grouped.get(row.campaignId) ?? []), row]);
  return [...grouped.entries()].flatMap(([campaignId, rows]) => {
    const primary = configs.find(config => config.campaignId === campaignId && config.isPrimary);
    const types = new Set(rows.map(row => row.metricType));
    return primary ? rows.filter(row => row.metricType === primary.goalType) : types.size === 1 ? rows : [];
  });
}
export function smartRecordMetrics(row: SmartDashboardRecord): RunRateMetrics {
  return { mtdProduction: row.mtd, goal: row.target, achievementPercentage: row.achievement == null ? null : row.achievement * 100, projectedRunRate: row.runRate, runRateAchievementPercentage: row.rrAchievement == null ? null : row.rrAchievement * 100, totalWorkingDays: row.workingDays ?? 0, elapsedWorkingDays: row.daysLapse ?? 0, dataStatus: row.mtd == null ? "no_production_data" : row.target == null || row.target <= 0 ? "missing_team_goal" : "valid", warnings: row.mtd == null ? ["Current KPI value is pending."] : [] };
}
export function summarizeSmartDashboard(records: SmartDashboardRecord[], configs: DashboardConfig[]) {
  const selected = chooseDashboardRecords(records, configs);
  const groups = new Map<string, SmartDashboardRecord[]>();
  for (const row of selected) groups.set(row.campaignId, [...(groups.get(row.campaignId) ?? []), row]);
  return new Map([...groups].map(([campaignId, rows]) => {
    rows.sort((a, b) => a.reportYear - b.reportYear || a.reportMonth - b.reportMonth || (a.dateUpdated ?? a.updatedAt).getTime() - (b.dateUpdated ?? b.updatedAt).getTime());
    const latest = rows[rows.length - 1];
    const config = configs.find(item => item.campaignId === campaignId && item.goalType === latest.metricType);
    let metrics = smartRecordMetrics(latest);
    if (rows.length > 1 && ["SUM", "AVERAGE"].includes(config?.aggregationMethod ?? "")) {
      const aggregate = (field: "mtd" | "target" | "runRate") => {
        const values = rows.map(row => row[field]).filter((value): value is number => value != null);
        return values.length ? values.reduce((a, b) => a + b, 0) / (config?.aggregationMethod === "AVERAGE" ? values.length : 1) : null;
      };
      const mtd = aggregate("mtd"), goal = aggregate("target"), rr = aggregate("runRate");
      const achievement = goal != null && goal > 0 && mtd != null ? config?.goalDirection === "LOWER" ? mtd > 0 ? goal / mtd * 100 : null : mtd / goal * 100 : null;
      metrics = { ...metrics, mtdProduction: mtd, goal, projectedRunRate: rr, achievementPercentage: achievement, runRateAchievementPercentage: rr != null && goal != null && goal > 0 ? config?.goalDirection === "LOWER" ? rr > 0 ? goal / rr * 100 : null : rr / goal * 100 : null };
    } else if (rows.length > 1 && ["CUSTOM", "WEIGHTED_AVERAGE"].includes(config?.aggregationMethod ?? "")) {
      metrics = { ...metrics, mtdProduction: null, goal: null, projectedRunRate: null, achievementPercentage: null, runRateAchievementPercentage: null, warnings: ["This KPI requires weights or a custom aggregation; individual monthly values remain available."] };
    }
    return [campaignId, { metrics, metricType: latest.metricType, unitType: config?.unitType ?? "CUSTOM", reportDate: latest.dateUpdated, reportStatus: latest.reportStatus }] as const;
  }));
}
