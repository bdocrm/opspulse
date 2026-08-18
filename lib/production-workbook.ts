import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { calculateProductionAchievement } from "./production-metrics";
import { normalizeProductionName, productionDisplayName } from "./production-normalization";
import type {
  ParsedProductionRecord,
  ProductionMetricType,
  ProductionValidationIssue,
  ProductionWorkbookResult,
} from "../types/production-monitoring";

const MAX_ROWS_PER_SHEET = 10_000;
const MAX_COLUMNS_PER_SHEET = 200;

const MONTHS: Record<string, number> = {
  JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3,
  APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DECEMBER: 12,
};

type ColumnField =
  | "campaign" | "businessUnit" | "metricType" | "metricUnit" | "target"
  | "week1" | "week2" | "week3" | "week4" | "week5" | "mtd"
  | "achievement" | "runRate" | "workingDays" | "daysLapse" | "dateUpdated";

type Period = { year: number; month: number };

function normalizedWords(value: unknown) {
  return normalizeProductionName(value);
}

export function isOperationsManagerHeader(value: unknown) {
  const text = normalizedWords(value);
  return /^(OM|OMS|OM NAME|OMS NAME|OPERATIONS MANAGER|OPERATIONS MANAGERS)$/.test(text);
}

function identifyColumn(value: unknown): ColumnField | null {
  const text = normalizedWords(value);
  if (!text || isOperationsManagerHeader(text)) return null;
  if (/^(CAMPAIGN|CAMPAIGN NAME|ACCOUNT|PROGRAM)$/.test(text)) return "campaign";
  if (/^(BUSINESS UNIT|BUSSINESS UNIT|BUSINESSUNIT|BU|UNIT)$/.test(text)) return "businessUnit";
  if (/^(METRIC|METRIC TYPE|KPI TYPE)$/.test(text)) return "metricType";
  if (/^(METRIC UNIT|UNIT OF MEASURE|UOM)$/.test(text)) return "metricUnit";
  if (/^(TARGET|GOAL|MONTHLY TARGET)$/.test(text)) return "target";
  const week = text.match(/^(?:WEEK|WK)\s*([1-5])$/);
  if (week) return `week${week[1]}` as ColumnField;
  if (/^(MTD|MONTH TO DATE|MONTHLY ACTUAL|ACTUAL)$/.test(text)) return "mtd";
  if (/^(ACHIEVEMENT|ACHIEVEMENT RATE|ACHIEVED|ACHV)$/.test(text)) return "achievement";
  if (/^(RUNRATE|RUN RATE|RUNRATE PROJECTION|PROJECTED)$/.test(text)) return "runRate";
  if (/^(WORKING DAYS|WORK DAYS|TOTAL WORKING DAYS)$/.test(text)) return "workingDays";
  if (/^(DAYS LAPSE|DAYS LAPSED|ELAPSED DAYS|DAYS ELAPSED)$/.test(text)) return "daysLapse";
  if (/^(DATE UPDATED|LAST UPDATED|UPDATED DATE|AS OF)$/.test(text)) return "dateUpdated";
  return null;
}

function cellDisplay(cell: XLSX.CellObject | undefined) {
  if (!cell) return "";
  if (cell.w != null) return String(cell.w).trim();
  if (cell.v instanceof Date) return cell.v.toISOString();
  return cell.v == null ? "" : String(cell.v).trim();
}

function sheetMatrix(sheet: XLSX.WorkSheet) {
  if (!sheet["!ref"]) return [] as string[][];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rowCount = Math.min(range.e.r + 1, MAX_ROWS_PER_SHEET);
  const columnCount = Math.min(range.e.c + 1, MAX_COLUMNS_PER_SHEET);
  const rows = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) =>
      cellDisplay(sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject)
    )
  );
  for (const merge of sheet["!merges"] ?? []) {
    const value = rows[merge.s.r]?.[merge.s.c] ?? "";
    for (let row = merge.s.r; row <= Math.min(merge.e.r, rowCount - 1); row += 1) {
      for (let column = merge.s.c; column <= Math.min(merge.e.c, columnCount - 1); column += 1) {
        if (!rows[row]?.[column]) rows[row][column] = value;
      }
    }
  }
  return rows;
}

function detectHeader(row: string[]) {
  const fields = new Map<ColumnField, number>();
  let excludedManagerColumn = false;
  row.forEach((value, column) => {
    if (isOperationsManagerHeader(value)) {
      excludedManagerColumn = true;
      return;
    }
    const field = identifyColumn(value);
    if (field && !fields.has(field)) fields.set(field, column);
  });
  const productionColumns = [...fields.keys()].filter((field) =>
    ["target", "week1", "week2", "week3", "week4", "week5", "mtd", "achievement"].includes(field)
  ).length;
  if (fields.has("campaign") && fields.has("businessUnit") && productionColumns >= 2) {
    return { fields, excludedManagerColumn };
  }
  return null;
}

export function detectProductionPeriod(value: unknown, fallbackYear?: number): Period | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = normalizedWords(text);
  const monthToken = Object.keys(MONTHS).find((token) => new RegExp(`\\b${token}\\b`).test(normalized));
  if (!monthToken) return null;
  const yearMatch = text.match(/\b(20\d{2})\b/) ?? text.match(/(?:^|\D)(\d{2})(?:\D|$)/);
  const year = yearMatch
    ? (Number(yearMatch[1]) < 100 ? 2000 + Number(yearMatch[1]) : Number(yearMatch[1]))
    : fallbackYear;
  if (!year || year < 2000 || year > 2100) return null;
  return { month: MONTHS[monthToken], year };
}

function periodFromRow(row: string[], fallbackYear?: number) {
  const compact = row.filter((value) => String(value).trim());
  // Month labels are often merged across most of the worksheet. The matrix
  // expands merged cells, so repeated copies must not make this look like a
  // regular wide data row.
  const firstCell = normalizedWords(row[0]);
  if (compact.length > 4 && !/^(MONTH|REPORTING MONTH|REPORTING PERIOD)$/.test(firstCell)) return null;
  const joined = Array.from(new Set(compact)).join(" ");
  return detectProductionPeriod(joined, fallbackYear);
}

function parseDate(value: string) {
  const text = value.trim().replace(/^as\s+of\s+/i, "");
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

function numericValue(
  raw: string,
  percent: boolean,
  fieldLabel: string,
  issues: ProductionValidationIssue[]
) {
  const text = raw.trim();
  if (!text || /^(?:-|--|N\/?A|NA|NO DATA|NOT AVAILABLE|NULL)$/i.test(text)) return null;
  if (/^#(?:DIV\/0|VALUE|REF|NAME|NUM|NULL)!?$/i.test(text)) {
    issues.push({ level: "WARNING", code: "FORMULA_RESULT_UNAVAILABLE", message: `${fieldLabel} contains an unavailable spreadsheet formula result.` });
    return null;
  }
  if (/[+\-*/=]/.test(text.replace(/^[-+]?\d+(?:\.\d+)?$/, "")) && !/^\([\d,.%\s]+\)$/.test(text)) {
    issues.push({ level: "ERROR", code: "INVALID_NUMBER", message: `${fieldLabel} is not a valid numeric value.` });
    return null;
  }
  const repeatedPercent = /%{2,}/.test(text);
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[,%$₱PHP\s]/gi, "").replace(/[()]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    issues.push({ level: "ERROR", code: "INVALID_NUMBER", message: `${fieldLabel} is not a valid numeric value.` });
    return null;
  }
  if (repeatedPercent) {
    issues.push({ level: "WARNING", code: "PERCENT_FORMAT_NORMALIZED", message: `${fieldLabel} contained repeated percent symbols and was normalized.` });
  }
  let result = negative ? -value : value;
  if (text.includes("%") || (percent && Math.abs(result) > 1)) result /= 100;
  return result;
}

function inferMetricType(row: string[], fields: Map<ColumnField, number>): ProductionMetricType {
  const explicit = normalizedWords(row[fields.get("metricType") ?? -1]).toLowerCase();
  if (["percentage", "volume", "count", "currency", "ratio", "custom"].includes(explicit)) {
    return explicit as ProductionMetricType;
  }
  const unit = normalizedWords(row[fields.get("metricUnit") ?? -1]);
  const relevant = ["target", "week1", "week2", "week3", "week4", "week5", "mtd"]
    .map((field) => row[fields.get(field as ColumnField) ?? -1] ?? "");
  const targetText = relevant[0].trim();
  const targetNumeric = Number(targetText.replace(/[,\s]/g, ""));
  if (relevant.some((value) => value.includes("%")) || unit === "%") return "percentage";
  if (relevant.some((value) => /(?:₱|PHP)/i.test(value)) || /^(PHP|PESO|PESOS)$/.test(unit)) return "currency";
  if (Number.isFinite(targetNumeric) && targetNumeric > 0 && targetNumeric <= 1) return "percentage";
  if (/COUNT|ACCOUNTS|CASES|CALLS|TRANSACTIONS|ITEMS/.test(unit)) return "count";
  return Number.isFinite(targetNumeric) ? "volume" : "custom";
}

function latestNonNull(values: Array<number | null>) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return null;
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(0.01, Math.abs(right) * 0.01);
}

function sanitizedHash(record: Omit<ParsedProductionRecord, "rowKey" | "sourceHash" | "issues">) {
  const { sourceSheet: _sourceSheet, sourceRow: _sourceRow, ...productionValues } = record;
  return createHash("sha256").update(JSON.stringify(productionValues)).digest("hex");
}

function parseSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  fileName: string,
  fallback?: Period
) {
  const rows = sheetMatrix(sheet);
  const sheetPeriod = detectProductionPeriod(sheetName, fallback?.year);
  let period = sheetPeriod ?? fallback ?? null;
  let columns: Map<ColumnField, number> | null = null;
  let currentCampaign = "";
  let excludedManagerColumn = false;
  const detectedWeeks = new Set<number>();
  const records: ParsedProductionRecord[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const detectedPeriod = periodFromRow(row, fallback?.year);
    if (detectedPeriod) {
      period = detectedPeriod;
      columns = null;
      currentCampaign = "";
      continue;
    }
    const header = detectHeader(row);
    if (header) {
      columns = header.fields;
      for (let week = 1; week <= 5; week += 1) {
        if (columns.has(`week${week}` as ColumnField)) detectedWeeks.add(week);
      }
      excludedManagerColumn ||= header.excludedManagerColumn;
      currentCampaign = "";
      continue;
    }
    if (!columns) continue;

    const businessUnitSource = String(row[columns.get("businessUnit") as number] ?? "").replace(/\s+/g, " ").trim();
    if (!businessUnitSource || /^(TOTAL|GRAND TOTAL|SUMMARY|BUSINESS UNIT)$/i.test(businessUnitSource)) continue;
    const explicitCampaign = String(row[columns.get("campaign") as number] ?? "").replace(/\s+/g, " ").trim();
    if (explicitCampaign) currentCampaign = explicitCampaign;

    const issues: ProductionValidationIssue[] = [];
    const metricType = inferMetricType(row, columns);
    const percentMetric = metricType === "percentage";
    const raw = (field: ColumnField) => String(row[columns?.get(field) ?? -1] ?? "");
    const value = (field: ColumnField, label: string, forcePercent = percentMetric) =>
      numericValue(raw(field), forcePercent, label, issues);
    const target = value("target", "Target");
    const weeks = [1, 2, 3, 4, 5].map((week) => value(`week${week}` as ColumnField, `Week ${week}`));
    const explicitMtd = value("mtd", "MTD");
    const nonNullWeeks = weeks.filter((week): week is number => week != null);
    const latestWeek = latestNonNull(weeks);
    const weeklySum = nonNullWeeks.length ? nonNullWeeks.reduce((sum, week) => sum + week, 0) : null;
    const monotonic = nonNullWeeks.every((week, index) => index === 0 || week >= nonNullWeeks[index - 1]);
    const fallbackMtd = percentMetric || monotonic ? latestWeek : weeklySum;
    const mtd = explicitMtd ?? fallbackMtd;
    const importedAchievement = value("achievement", "Achievement", true);
    const calculatedAchievement = calculateProductionAchievement({ target, mtd, metricType });
    const achievement = importedAchievement ?? calculatedAchievement;
    const runRate = value("runRate", "Run rate");
    const workingDaysValue = value("workingDays", "Working days", false);
    const daysLapseValue = value("daysLapse", "Days lapse", false);
    const workingDays = workingDaysValue == null ? null : Math.trunc(workingDaysValue);
    const daysLapse = daysLapseValue == null ? null : Math.trunc(daysLapseValue);
    const dateText = raw("dateUpdated");
    const dateUpdated = parseDate(dateText);
    const datePeriod = dateUpdated ? { year: new Date(dateUpdated).getUTCFullYear(), month: new Date(dateUpdated).getUTCMonth() + 1 } : null;
    const recordPeriod = period ?? datePeriod ?? fallback ?? null;

    if (!currentCampaign) issues.push({ level: "ERROR", code: "MISSING_CAMPAIGN", message: "Campaign is missing and cannot be inherited from a previous data row." });
    if (target == null) issues.push({ level: "ERROR", code: "MISSING_TARGET", message: "Target is missing or invalid." });
    if (!recordPeriod) issues.push({ level: "ERROR", code: "MISSING_PERIOD", message: "Reporting month could not be detected; select a fallback period." });
    if (dateText && !dateUpdated) issues.push({ level: "WARNING", code: "INVALID_DATE", message: "Date updated could not be parsed and was left blank." });
    if (workingDays != null && workingDays < 0) issues.push({ level: "ERROR", code: "INVALID_WORKING_DAYS", message: "Working days cannot be negative." });
    if (daysLapse != null && daysLapse < 0) issues.push({ level: "ERROR", code: "INVALID_DAYS_LAPSE", message: "Days lapse cannot be negative." });
    if (workingDays != null && daysLapse != null && daysLapse > workingDays) issues.push({ level: "WARNING", code: "DAYS_LAPSE_EXCEEDS_WORKING_DAYS", message: "Days lapse is greater than working days." });
    if (explicitMtd != null && latestWeek != null) {
      const candidates = percentMetric ? [latestWeek] : [latestWeek, weeklySum].filter((candidate): candidate is number => candidate != null);
      if (!candidates.some((candidate) => nearlyEqual(explicitMtd, candidate))) {
        issues.push({ level: "WARNING", code: "MTD_MISMATCH", message: "Imported MTD differs from both the latest weekly value and the weekly total; the source MTD was preserved." });
      }
    }
    if (importedAchievement != null && calculatedAchievement != null && !nearlyEqual(importedAchievement, calculatedAchievement)) {
      issues.push({ level: "WARNING", code: "ACHIEVEMENT_MISMATCH", message: "Imported achievement differs from MTD divided by target; the source achievement was preserved." });
    }

    const metricUnitSource = raw("metricUnit").trim();
    const metricUnit = metricUnitSource || (metricType === "percentage" ? "%" : metricType === "currency" ? "PHP" : metricType === "count" ? "Items" : metricType === "volume" ? "Units" : null);
    const base = {
      campaignSource: productionDisplayName(currentCampaign),
      campaignNormalized: normalizeProductionName(currentCampaign),
      businessUnitSource: productionDisplayName(businessUnitSource),
      businessUnitNormalized: normalizeProductionName(businessUnitSource),
      reportYear: recordPeriod?.year ?? null,
      reportMonth: recordPeriod?.month ?? null,
      metricType,
      metricUnit,
      target,
      week1: weeks[0], week2: weeks[1], week3: weeks[2], week4: weeks[3], week5: weeks[4],
      mtd, achievement, runRate, workingDays, daysLapse, dateUpdated,
      sourceSheet: sheetName,
      sourceRow: rowIndex + 1,
    };
    records.push({
      rowKey: `${sheetName}:${rowIndex + 1}`,
      ...base,
      sourceHash: sanitizedHash(base),
      issues,
    });
  }
  return { records, excludedManagerColumn, detectedWeeks: [...detectedWeeks].sort() };
}

export function parseProductionWorkbook(
  buffer: Buffer,
  fileName: string,
  fallback?: Period
): ProductionWorkbookResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    WTF: false,
  });
  const records: ParsedProductionRecord[] = [];
  const worksheets: ProductionWorkbookResult["worksheets"] = [];
  let managerColumnFound = false;
  const detectedWeeks = new Set<number>();
  for (const sheetName of workbook.SheetNames) {
    const parsed = parseSheet(workbook.Sheets[sheetName], sheetName, fileName, fallback);
    records.push(...parsed.records);
    managerColumnFound ||= parsed.excludedManagerColumn;
    parsed.detectedWeeks.forEach((week) => detectedWeeks.add(week));
    const periods = Array.from(new Set(parsed.records
      .filter((record) => record.reportYear && record.reportMonth)
      .map((record) => `${record.reportYear}-${String(record.reportMonth).padStart(2, "0")}`)));
    worksheets.push({
      name: sheetName,
      supported: parsed.records.length > 0,
      recordCount: parsed.records.length,
      periods,
      detectedWeeks: parsed.detectedWeeks,
      ...(parsed.records.length ? {} : { error: "No recognizable production monitoring section was found." }),
    });
  }
  const reportingPeriods = Array.from(new Map(records
    .filter((record) => record.reportYear && record.reportMonth)
    .map((record) => [`${record.reportYear}-${record.reportMonth}`, { year: record.reportYear as number, month: record.reportMonth as number }])).values())
    .sort((left, right) => left.year - right.year || left.month - right.month);
  const naturalKeys = new Set<string>();
  for (const record of records) {
    const key = [record.campaignNormalized, record.businessUnitNormalized, record.reportYear, record.reportMonth, record.metricType].join(":");
    if (naturalKeys.has(key)) {
      record.issues.push({ level: "ERROR", code: "DUPLICATE_IN_WORKBOOK", message: "This campaign, business unit, period, and metric appears more than once in the workbook." });
    } else {
      naturalKeys.add(key);
    }
  }
  return {
    fileName,
    worksheets,
    reportingPeriods,
    detectedWeeks: [...detectedWeeks].sort(),
    excludedFields: managerColumnFound ? ["Operations Manager columns"] : [],
    records,
  };
}
