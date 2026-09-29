import type { Config, Issue, Numbers } from "./types";

export function calculate(source: Numbers, config: Config) {
  const calculated: Partial<Numbers> = {};
  const issues: Issue[] = [];
  const weeks = [source.week1, source.week2, source.week3, source.week4, source.week5];
  const presentWeeks = weeks.filter((value): value is number => value != null);
  // Partial weeks are not enough to reconstruct a complete MTD value.
  if (config.calculationMethod === "SUM" && !["PERCENTAGE", "RATE", "SCORE"].includes(config.unitType) && presentWeeks.length === 5) calculated.mtd = presentWeeks.reduce((a, b) => a + b, 0);
  if (config.calculationMethod === "AVERAGE" && presentWeeks.length === 5) calculated.mtd = presentWeeks.reduce((a, b) => a + b, 0) / 5;
  const mtd = source.mtd ?? calculated.mtd ?? null;
  if (config.calculationMethod !== "CUSTOM" && mtd != null && source.target != null && source.target > 0) {
    if (config.goalDirection === "HIGHER") calculated.achievement = mtd / source.target;
    else if (mtd > 0) calculated.achievement = source.target / mtd;
  }
  const additive = config.calculationMethod === "SUM" && ["COUNT", "CURRENCY", "CUSTOM"].includes(config.unitType);
  if (additive && mtd != null && source.daysLapse != null && source.daysLapse > 0 && source.workingDays != null && source.workingDays > 0) {
    calculated.runRate = mtd / source.daysLapse * source.workingDays;
    if (source.target != null && source.target > 0) calculated.rrAchievement = config.goalDirection === "LOWER" ? calculated.runRate > 0 ? source.target / calculated.runRate : null : calculated.runRate / source.target;
  }
  for (const [field, value] of Object.entries(calculated)) {
    if (value == null) continue;
    const original = source[field as keyof Numbers];
    if (!Number.isFinite(value)) { delete calculated[field as keyof Numbers]; continue; }
    if (original != null && Math.abs(original - value) > config.tolerance) issues.push({ code: "CALCULATION_MISMATCH", field, level: "WARNING", message: `${field}: source ${original} differs from calculation ${value} (tolerance ${config.tolerance}). Source value is retained.` });
  }
  return { calculated, issues, values: Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value ?? calculated[key as keyof Numbers] ?? null])) as Numbers };
}
