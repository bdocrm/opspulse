export type RunRateDataStatus =
  | "valid"
  | "no_production_data"
  | "missing_team_goal"
  | "missing_agent_goal"
  | "invalid_period";

export type GoalLevel = "team" | "agent";

export interface WorkingDayProgress {
  elapsedWorkingDays: number;
  totalWorkingDays: number;
}

export interface RunRateMetrics extends WorkingDayProgress {
  mtdProduction: number | null;
  goal: number | null;
  projectedRunRate: number | null;
  achievementPercentage: number | null;
  runRateAchievementPercentage: number | null;
  dataStatus: RunRateDataStatus;
  warnings: string[];
}

export interface CalculateRunRateInput {
  mtdProduction: number | null;
  goal: number | null;
  month: number;
  year: number;
  configuredElapsedWorkingDays?: number | null;
  configuredTotalWorkingDays?: number | null;
  goalLevel?: GoalLevel;
  now?: Date;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function businessDaysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  const lastDay = new Date(year, month, 0).getDate();
  let result = 0;
  for (let day = 1; day <= lastDay; day++) {
    const weekday = new Date(year, month - 1, day).getDay();
    if (weekday !== 0 && weekday !== 6) result++;
  }
  return result;
}

export function elapsedBusinessDays(year: number, month: number, throughDay: number): number {
  const lastDay = new Date(year, month, 0).getDate();
  let result = 0;
  for (let day = 1; day <= Math.min(Math.max(throughDay, 0), lastDay); day++) {
    const weekday = new Date(year, month - 1, day).getDay();
    if (weekday !== 0 && weekday !== 6) result++;
  }
  return result;
}

export function resolveWorkingDayProgress(input: {
  month: number;
  year: number;
  configuredElapsedWorkingDays?: number | null;
  configuredTotalWorkingDays?: number | null;
  now?: Date;
}): WorkingDayProgress {
  const { month, year } = input;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { elapsedWorkingDays: 0, totalWorkingDays: 0 };
  }

  const calculatedTotal = businessDaysInMonth(year, month);
  const configuredTotal = finiteNonNegative(input.configuredTotalWorkingDays);
  const totalWorkingDays = configuredTotal && configuredTotal > 0
    ? Math.round(configuredTotal)
    : calculatedTotal;
  const now = input.now ?? new Date();
  const selectedPeriod = year * 12 + month;
  const currentPeriod = now.getFullYear() * 12 + now.getMonth() + 1;

  // A completed month is final: its projection must equal its actual production.
  if (selectedPeriod < currentPeriod) {
    return { elapsedWorkingDays: totalWorkingDays, totalWorkingDays };
  }
  if (selectedPeriod > currentPeriod) {
    return { elapsedWorkingDays: 0, totalWorkingDays };
  }

  const configuredElapsed = finiteNonNegative(input.configuredElapsedWorkingDays);
  const elapsedWorkingDays = configuredElapsed && configuredElapsed > 0
    ? Math.round(configuredElapsed)
    : elapsedBusinessDays(year, month, now.getDate());
  return {
    elapsedWorkingDays: Math.min(elapsedWorkingDays, totalWorkingDays),
    totalWorkingDays,
  };
}

export function calculateRunRateMetrics(input: CalculateRunRateInput): RunRateMetrics {
  const warnings: string[] = [];
  const workingDays = resolveWorkingDayProgress(input);
  const production = finiteNonNegative(input.mtdProduction);
  const goal = finiteNonNegative(input.goal);
  const validPeriod = workingDays.totalWorkingDays > 0;
  const now = input.now ?? new Date();
  const isFuture = input.year * 12 + input.month > now.getFullYear() * 12 + now.getMonth() + 1;
  const missingGoalStatus: RunRateDataStatus = input.goalLevel === "agent"
    ? "missing_agent_goal"
    : "missing_team_goal";

  if (!validPeriod || isFuture) {
    warnings.push(isFuture ? "The selected reporting period is in the future." : "The selected reporting period is invalid.");
    return {
      ...workingDays,
      mtdProduction: production,
      goal: goal && goal > 0 ? goal : null,
      projectedRunRate: null,
      achievementPercentage: null,
      runRateAchievementPercentage: null,
      dataStatus: "invalid_period",
      warnings,
    };
  }

  if (production == null) {
    warnings.push("No production data exists for the selected reporting period.");
    return {
      ...workingDays,
      mtdProduction: null,
      goal: goal && goal > 0 ? goal : null,
      projectedRunRate: null,
      achievementPercentage: null,
      runRateAchievementPercentage: null,
      dataStatus: "no_production_data",
      warnings,
    };
  }

  const projectedRunRate = workingDays.elapsedWorkingDays > 0
    ? (production / workingDays.elapsedWorkingDays) * workingDays.totalWorkingDays
    : null;
  if (projectedRunRate == null) warnings.push("Elapsed working days are unavailable.");

  if (goal == null || goal <= 0) {
    warnings.push(input.goalLevel === "agent" ? "The agent goal is missing or zero." : "The team goal is missing or zero.");
    return {
      ...workingDays,
      mtdProduction: production,
      goal: null,
      projectedRunRate,
      achievementPercentage: null,
      runRateAchievementPercentage: null,
      dataStatus: missingGoalStatus,
      warnings,
    };
  }

  return {
    ...workingDays,
    mtdProduction: production,
    goal,
    projectedRunRate,
    achievementPercentage: (production / goal) * 100,
    runRateAchievementPercentage: projectedRunRate == null ? null : (projectedRunRate / goal) * 100,
    dataStatus: "valid",
    warnings,
  };
}

export function aggregateRunRateMetrics(metrics: RunRateMetrics[], goalLevel: GoalLevel = "team"): RunRateMetrics {
  const withProduction = metrics.filter((metric) => metric.mtdProduction != null && metric.dataStatus !== "invalid_period");
  if (!withProduction.length) {
    const invalidPeriod = metrics.length > 0 && metrics.every((metric) => metric.dataStatus === "invalid_period");
    return {
      mtdProduction: null,
      goal: null,
      elapsedWorkingDays: 0,
      totalWorkingDays: 0,
      projectedRunRate: null,
      achievementPercentage: null,
      runRateAchievementPercentage: null,
      dataStatus: invalidPeriod ? "invalid_period" : "no_production_data",
      warnings: invalidPeriod
        ? [...new Set(metrics.flatMap((metric) => metric.warnings))]
        : ["No production data exists for the selected reporting period."],
    };
  }

  const missingGoal = withProduction.some((metric) => metric.goal == null || metric.goal <= 0);
  const projectedValues = withProduction.map((metric) => metric.projectedRunRate).filter((value): value is number => value != null);
  const production = withProduction.reduce((sum, metric) => sum + Number(metric.mtdProduction), 0);
  const goal = missingGoal ? null : withProduction.reduce((sum, metric) => sum + Number(metric.goal), 0);
  const projected = projectedValues.length === withProduction.length
    ? projectedValues.reduce((sum, value) => sum + value, 0)
    : null;

  return {
    mtdProduction: production,
    goal,
    elapsedWorkingDays: withProduction.reduce((sum, metric) => sum + metric.elapsedWorkingDays, 0),
    totalWorkingDays: withProduction.reduce((sum, metric) => sum + metric.totalWorkingDays, 0),
    projectedRunRate: projected,
    achievementPercentage: goal && goal > 0 ? (production / goal) * 100 : null,
    runRateAchievementPercentage: goal && goal > 0 && projected != null ? (projected / goal) * 100 : null,
    dataStatus: missingGoal ? (goalLevel === "agent" ? "missing_agent_goal" : "missing_team_goal") : "valid",
    warnings: [...new Set(withProduction.flatMap((metric) => metric.warnings))],
  };
}
