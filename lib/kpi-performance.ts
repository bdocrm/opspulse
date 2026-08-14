export const KPI_WEIGHTS = {
  qa: 0.25,
  aht: 0.2,
  adherence: 0.2,
  cm: 0.175,
  cd: 0.175,
} as const;

export type KpiMetric = keyof typeof KPI_WEIGHTS;
export type KpiStatus =
  | "EXCEEDS_TARGET"
  | "MEETS_TARGET"
  | "NEAR_TARGET"
  | "BELOW_TARGET"
  | "NO_DATA";

export interface KpiValueSet {
  actualQa: number | null;
  actualAht: number | null;
  actualAdherence: number | null;
  actualCm: number | null;
  actualCd: number | null;
  goalQa: number | null;
  goalAht: number | null;
  goalAdherence: number | null;
  goalCm: number | null;
  goalCd: number | null;
}

export interface KpiAchievements {
  achievementQa: number | null;
  achievementAht: number | null;
  achievementAdherence: number | null;
  achievementCm: number | null;
  achievementCd: number | null;
  overallScore: number | null;
}

function safeRatio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function lowerIsBetter(goal: number | null, actual: number | null, zeroIsPerfect = false) {
  if (goal == null || actual == null) return null;
  if (actual <= 0) return zeroIsPerfect ? 1 : null;
  return safeRatio(goal, actual);
}

export function calculateKpiAchievements(values: KpiValueSet): KpiAchievements {
  const achievementQa = safeRatio(values.actualQa, values.goalQa);
  const achievementAht = lowerIsBetter(values.goalAht, values.actualAht);
  const achievementAdherence = safeRatio(values.actualAdherence, values.goalAdherence);
  const achievementCm = lowerIsBetter(values.goalCm, values.actualCm, true);
  const achievementCd = lowerIsBetter(values.goalCd, values.actualCd, true);
  const byMetric: Record<KpiMetric, number | null> = {
    qa: achievementQa,
    aht: achievementAht,
    adherence: achievementAdherence,
    cm: achievementCm,
    cd: achievementCd,
  };
  const available = (Object.keys(byMetric) as KpiMetric[]).filter(
    (metric) => byMetric[metric] != null
  );
  const availableWeight = available.reduce((sum, metric) => sum + KPI_WEIGHTS[metric], 0);
  const overallScore = availableWeight
    ? available.reduce(
        (sum, metric) => sum + (byMetric[metric] as number) * KPI_WEIGHTS[metric],
        0
      ) / availableWeight
    : null;

  return {
    achievementQa,
    achievementAht,
    achievementAdherence,
    achievementCm,
    achievementCd,
    overallScore: Number.isFinite(overallScore ?? NaN) ? overallScore : null,
  };
}

export function getKpiStatus(achievement: number | null): KpiStatus {
  if (achievement == null || !Number.isFinite(achievement)) return "NO_DATA";
  if (achievement >= 1.05) return "EXCEEDS_TARGET";
  if (achievement >= 1) return "MEETS_TARGET";
  if (achievement >= 0.9) return "NEAR_TARGET";
  return "BELOW_TARGET";
}

export function validateKpiValues(values: KpiValueSet): string[] {
  const errors: string[] = [];
  const percentageChecks: Array<[string, number | null]> = [
    ["QA", values.actualQa],
    ["QA goal", values.goalQa],
    ["Adherence", values.actualAdherence],
    ["Adherence goal", values.goalAdherence],
  ];
  for (const [label, value] of percentageChecks) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      errors.push(`${label} must be between 0 and 100.`);
    }
  }
  const nonNegativeChecks: Array<[string, number | null]> = [
    ["AHT", values.actualAht],
    ["AHT goal", values.goalAht],
    ["CM", values.actualCm],
    ["CM goal", values.goalCm],
    ["CD", values.actualCd],
    ["CD goal", values.goalCd],
  ];
  for (const [label, value] of nonNegativeChecks) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${label} must be zero or greater.`);
    }
  }
  if (
    values.actualQa == null &&
    values.actualAht == null &&
    values.actualAdherence == null &&
    values.actualCm == null &&
    values.actualCd == null
  ) {
    errors.push("At least one actual KPI value is required.");
  }
  return errors;
}

export function normalizeEmployeeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9, ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function employeeNameKeys(value: string) {
  const normalized = normalizeEmployeeName(value);
  const keys = new Set([normalized.replace(/,/g, "").replace(/\s+/g, " ").trim()]);
  if (normalized.includes(",")) {
    const [last, ...rest] = normalized.split(",");
    const first = rest.join(" ").trim();
    if (last.trim() && first) keys.add(`${first} ${last.trim()}`.replace(/\s+/g, " "));
  }
  return [...keys].filter(Boolean);
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

export function employeeNameSimilarity(left: string, right: string) {
  const leftKeys = employeeNameKeys(left);
  const rightKeys = employeeNameKeys(right);
  let best = 0;
  for (const a of leftKeys) {
    for (const b of rightKeys) {
      if (a === b) return 1;
      const longest = Math.max(a.length, b.length);
      if (longest) best = Math.max(best, 1 - levenshtein(a, b) / longest);
    }
  }
  return best;
}

export function monthLabel(month: number, year: number, short = false) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
