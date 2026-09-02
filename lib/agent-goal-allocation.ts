export type AgentPerformance = {
  goal: number;
  actual: number;
  achievement: number;
};

export type MonthlyProductionRankRow = {
  achievement: number;
  actual: number;
  secondary?: number;
  name: string;
};

/**
 * Ranks a selected month's imported agent results by actual production.
 * Achievement and name are deterministic tie-breakers only.
 */
export function compareMonthlyProductionRank(left: MonthlyProductionRankRow, right: MonthlyProductionRankRow) {
  return Number(right.actual || 0) - Number(left.actual || 0)
    || Number(right.secondary || 0) - Number(left.secondary || 0)
    || Number(right.achievement || 0) - Number(left.achievement || 0)
    || left.name.localeCompare(right.name);
}

/**
 * Resolves each agent's goal from agent-level imported/configured data only.
 * A campaign goal is a team target and must never be divided among agents:
 * doing so mixes a team denominator with an agent's imported monthly actual.
 */
export function resolveImportedAgentGoals(
  performance: Record<string, AgentPerformance>,
  configuredGoals: Record<string, number | null | undefined> = {},
): Record<string, AgentPerformance> {
  const entries = Object.entries(performance);
  const importedGoals = Object.fromEntries(entries.map(([agentId, row]) => {
    const importedGoal = Number(row.goal || 0);
    const configuredGoal = Number(configuredGoals[agentId] || 0);
    return [agentId, importedGoal > 0 ? importedGoal : configuredGoal > 0 ? configuredGoal : 0];
  }));

  return Object.fromEntries(entries.map(([agentId, row]) => {
    const goal = importedGoals[agentId];
    return [agentId, {
      ...row,
      goal,
      achievement: goal > 0 ? (Number(row.actual || 0) / goal) * 100 : 0,
    }];
  }));
}

type ImportedPerformanceRecord = {
  monitoringType: string | null;
  metric: string;
};

/** Monthly productivity sheets expose funnel metrics side-by-side. Only the
 * final Booked Volume is the performance actual; summing every count and
 * volume produces an invalid, greatly inflated currency value.
 */
export function isPrimaryImportedPerformanceRecord(record: ImportedPerformanceRecord, campaignName = "") {
  const metric = record.metric.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/^bpi\b/i.test(campaignName)) {
    if (/^(?:transmitted|approvals) (?:count|volume)$/.test(metric)) return false;
    if (/^booked count$/.test(metric)) return false;
    if (/^booked volume$/.test(metric)) return true;
  }
  if (record.monitoringType === "PL_PRODUCTIVITY" || record.monitoringType === "PA_INBOUND_PRODUCTIVITY") {
    return metric === "booked volume";
  }
  return true;
}

/** Returns the most frequently imported positive target. This is used only to
 * recover older imports where the workbook's per-type plan was not copied onto
 * the Booked Volume row. Ties prefer the lower target rather than inflating it.
 */
export function mostCommonImportedTarget(values: Array<number | null | undefined>) {
  const counts = new Map<number, number>();
  for (const value of values) {
    const target = Number(value || 0);
    if (!Number.isFinite(target) || target <= 0) continue;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftTarget, leftCount], [rightTarget, rightCount]) =>
      rightCount - leftCount || leftTarget - rightTarget
    )[0]?.[0] ?? 0;
}

export function shouldIncludeImportedReportAgent(
  campaignHasImportedReport: boolean,
  actualValues: unknown[],
) {
  if (!campaignHasImportedReport) return true;
  return actualValues.some((value) => {
    const actual = Number(value || 0);
    return Number.isFinite(actual) && actual > 0;
  });
}
