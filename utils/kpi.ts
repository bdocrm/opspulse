// ---------- KPI computation helpers ----------

export type KpiMetricKey =
  | "transmittals"
  | "activations"
  | "approvals"
  | "booked"
  | "qualityRate"
  | "conversionRate"
  | "volume"
  | "transaction";

export const WORKING_DAYS_DEFAULT = 22;

export interface DailySalesRow {
  date: string | Date;
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  qualityRate: number | null;
  conversionRate: number | null;
}

/**
 * Calculate the number of working days (Mon-Fri) in a given month/year
 */
export function getWorkingDaysInMonth(year: number, month: number): number {
  let count = 0;
  const lastDay = new Date(year, month + 1, 0).getDate();
  
  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }
  
  return count;
}

/**
 * Calculate the number of working days (Mon-Fri) that have elapsed up to a given date (inclusive)
 */
export function getWorkingDaysElapsed(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfMonth = date.getDate();
  
  let count = 0;
  for (let day = 1; day <= dayOfMonth; day++) {
    const checkDate = new Date(year, month, day);
    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }
  
  return count;
}

/**
 * Compute the MTD value for a given metric by summing daily rows in the selected month.
 * For rate metrics (qualityRate, conversionRate) we average instead of sum.
 * 
 * NOTE: For accurate rate metrics, these should ideally be weighted by volume.
 * Example: If day 1 has 100% quality on 1 item, and day 2 has 50% quality on 1000 items,
 * the correct average is ~50%, not 75%.
 */
export function computeMTD(rows: DailySalesRow[], metric: KpiMetricKey): number {
  if (rows.length === 0) return 0;
  const isRate = metric === "qualityRate" || metric === "conversionRate";
  const values = rows.map((r) => (r[metric] as number) ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  return isRate ? total / rows.length : total;
}

/** Achievement % = (MTD / monthlyGoal) * 100 */
export function achievementPct(mtd: number, goal: number): number {
  if (goal === 0) return 0;
  return (mtd / goal) * 100;
}

/** Number of distinct working days that have elapsed (unique dates in data) */
export function daysLapsed(rows: DailySalesRow[]): number {
  const unique = new Set(rows.map((r) => new Date(r.date).toDateString()));
  return unique.size;
}

/**
 * RunRate = (MTD / WorkingDaysElapsed) * TotalWorkingDaysInMonth
 * This properly accounts for partial months
 */
export function runRate(
  mtd: number,
  elapsed: number = 0,
  workingDays: number = WORKING_DAYS_DEFAULT,
  referenceDate?: Date
): number {
  // If no elapsed days provided but reference date given, calculate from date
  let daysElapsedActual = elapsed;
  if (daysElapsedActual === 0 && referenceDate) {
    daysElapsedActual = getWorkingDaysElapsed(referenceDate);
  }
  
  if (daysElapsedActual === 0) return 0;
  return (mtd / daysElapsedActual) * workingDays;
}

/** RR Achievement = (RunRate / monthlyGoal) * 100 */
export function rrAchievementPct(rr: number, goal: number): number {
  if (goal === 0) return 0;
  return (rr / goal) * 100;
}

// ---------- Weekly buckets ----------

export type WeekBucket = "W1" | "W2" | "W3" | "W4" | "W5";

export function weekBucket(day: number): WeekBucket {
  if (day <= 7) return "W1";
  if (day <= 14) return "W2";
  if (day <= 21) return "W3";
  if (day <= 28) return "W4";
  return "W5";
}

export function groupByWeek(
  rows: DailySalesRow[],
  metric: KpiMetricKey
): Record<WeekBucket, number> {
  const buckets: Record<WeekBucket, number[]> = {
    W1: [],
    W2: [],
    W3: [],
    W4: [],
    W5: [],
  };

  rows.forEach((r) => {
    const d = new Date(r.date).getDate();
    const b = weekBucket(d);
    buckets[b].push((r[metric] as number) ?? 0);
  });

  const isRate = metric === "qualityRate" || metric === "conversionRate";

  const result: Record<string, number> = {};
  for (const [k, arr] of Object.entries(buckets)) {
    if (arr.length === 0) {
      result[k] = 0;
    } else {
      const total = arr.reduce((a, b) => a + b, 0);
      result[k] = isRate ? total / arr.length : total;
    }
  }
  return result as Record<WeekBucket, number>;
}

// ---------- Color rule ----------

export type KpiColor = "red" | "yellow" | "green";

export function kpiColor(pct: number): KpiColor {
  if (pct >= 100) return "green";
  if (pct >= 80) return "yellow";
  return "red";
}

export function kpiColorClass(pct: number): string {
  const c = kpiColor(pct);
  if (c === "green") return "text-green-500 bg-green-500/10";
  if (c === "yellow") return "text-yellow-500 bg-yellow-500/10";
  return "text-red-500 bg-red-500/10";
}

export function kpiColorHex(pct: number): string {
  const c = kpiColor(pct);
  if (c === "green") return "#22c55e";
  if (c === "yellow") return "#eab308";
  return "#ef4444";
}

// ---------- Filter period ----------

export type FilterPeriod = "daily" | "weekly" | "monthly" | "yearly";

export function periodLabel(period: FilterPeriod): string {
  return period.charAt(0).toUpperCase() + period.slice(1);
}
