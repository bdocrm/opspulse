const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MONTH_LOOKUP = new Map<string, number>(MONTH_NAMES.flatMap((name, index) => [
  [name.toUpperCase(), index + 1] as const,
  [name.slice(0, 3).toUpperCase(), index + 1] as const,
]));

export function normalizeMonthValue(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getUTCMonth() + 1;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^(?:0?[1-9]|1[0-2])$/.test(text)) return Number(text);
  const direct = MONTH_LOOKUP.get(text.toUpperCase());
  if (direct) return direct;
  const dateMatch = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (dateMatch) return normalizeMonthValue(Number(dateMatch[2]));
  const word = text.toUpperCase().match(/\b([A-Z]{3,9})\b/)?.[1];
  return word ? MONTH_LOOKUP.get(word) ?? null : null;
}

export function normalizeMonthSelection(value: unknown): number[] {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(values.map(normalizeMonthValue).filter((month): month is number => month != null))).sort((a, b) => a - b);
}

export function monthName(month: number, short = false) {
  const name = MONTH_NAMES[month - 1] ?? "Unknown";
  return short ? name.slice(0, 3) : name;
}

export function monthSelectionLabel(months: number[]) {
  const normalized = normalizeMonthSelection(months);
  if (normalized.length === 12) return "All Months";
  if (normalized.length === 1) return monthName(normalized[0]);
  return normalized.length ? `${normalized.length} Months Selected` : "Select Months";
}

export function monthSelectionRange(year: number, months: number[]) {
  const normalized = normalizeMonthSelection(months);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !normalized.length) return null;
  const first = normalized[0];
  const last = normalized.at(-1)!;
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return {
    dateFrom: `${year}-${String(first).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(last).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function isSelectedPeriod(year: number, month: number | null | undefined, selectedYear: number, selectedMonths: number[]) {
  return month != null && year === selectedYear && selectedMonths.includes(month);
}

export function dataCoverage(availableMonths: number[]) {
  const available = normalizeMonthSelection(availableMonths);
  return { available, count: available.length, total: 12, percent: Math.round((available.length / 12) * 100) };
}

export const ALL_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
