import * as XLSX from "xlsx";
import { validateKpiValues, type KpiValueSet } from "./kpi-performance";

const MONTHS: Record<string, number> = {
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPT: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
};

type KpiField = keyof KpiValueSet;
type ColumnField = "employeeName" | "employeeCode" | "tenure" | KpiField;

export interface ParsedKpiRow extends KpiValueSet {
  rowKey: string;
  employeeName: string;
  employeeCode: string | null;
  tenure: string | null;
  month: number;
  year: number;
  sourceSheet: string;
  sourceRow: number;
  errors: string[];
  warnings: string[];
}

export interface KpiWorkbookResult {
  fileName: string;
  worksheets: Array<{
    name: string;
    month: number | null;
    supported: boolean;
    recordCount: number;
    error?: string;
  }>;
  records: ParsedKpiRow[];
}

function normalizedWords(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectKpiWorksheetMonth(sheetName: string) {
  const tokens = normalizedWords(sheetName).split(" ").filter(Boolean);
  for (const token of tokens) {
    if (MONTHS[token]) return MONTHS[token];
  }
  return null;
}

function inferYear(fileName: string, sheetName: string, rows: string[][], fallbackYear: number) {
  const sources = [fileName, sheetName, ...rows.slice(0, 12).flat()];
  for (const source of sources) {
    const match = String(source).match(/\b(20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return fallbackYear;
}

function cellDisplay(cell: XLSX.CellObject | undefined) {
  if (!cell) return "";
  if (cell.w != null) return String(cell.w).trim();
  if (cell.v != null) return String(cell.v).trim();
  return "";
}

function sheetMatrix(sheet: XLSX.WorkSheet) {
  const ref = sheet["!ref"];
  if (!ref) return [] as string[][];
  const range = XLSX.utils.decode_range(ref);
  const rowCount = Math.min(range.e.r + 1, 10000);
  const columnCount = Math.min(range.e.c + 1, 200);
  const rows = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) =>
      cellDisplay(sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject)
    )
  );
  for (const merge of sheet["!merges"] ?? []) {
    const value = rows[merge.s.r]?.[merge.s.c] ?? "";
    for (let row = merge.s.r; row <= Math.min(merge.e.r, rowCount - 1); row += 1) {
      for (let column = merge.s.c; column <= Math.min(merge.e.c, columnCount - 1); column += 1) {
        if (!rows[row][column]) rows[row][column] = value;
      }
    }
  }
  return rows;
}

function metricField(header: string): KpiField | null {
  const text = normalizedWords(header);
  if (/\b(ACHIEVEMENT|ACHIEVED|ACVT|ACHV|SCORE)\b/.test(text)) return null;
  let metric: "Qa" | "Aht" | "Adherence" | "Cm" | "Cd" | null = null;
  if (/\b(ADHERENCE|ADH)\b/.test(text)) metric = "Adherence";
  else if (/\bAHT\b/.test(text)) metric = "Aht";
  else if (/\b(QA|QUALITY)\b/.test(text)) metric = "Qa";
  else if (/\bCM\b/.test(text)) metric = "Cm";
  else if (/\bCD\b/.test(text)) metric = "Cd";
  if (!metric) return null;
  const goal = /\b(GOAL|TARGET|STANDARD|BENCHMARK)\b/.test(text);
  return `${goal ? "goal" : "actual"}${metric}` as KpiField;
}

function identifyField(header: string): ColumnField | null {
  const text = normalizedWords(header);
  if (!text) return null;
  if (/\b(EMPLOYEE|AGENT|COLLECTOR|ASSOCIATE)\b.*\b(ID|CODE|NUMBER|NO)\b/.test(text)) {
    return "employeeCode";
  }
  if (
    /\b(EMPLOYEE|AGENT|COLLECTOR|ASSOCIATE)\b.*\b(NAME|FULLNAME)\b/.test(text) ||
    /\bNAME OF (EMPLOYEE|AGENT|COLLECTOR|ASSOCIATE)S?\b/.test(text) ||
    ["EMPLOYEE", "EMPLOYEE NAME", "AGENT", "AGENT NAME", "COLLECTOR", "COLLECTOR NAME", "NAME"].includes(text)
  ) {
    return "employeeName";
  }
  if (/\b(TENURE|CLASSIFICATION|EMPLOYEE TYPE|AGENT TYPE)\b/.test(text)) return "tenure";
  return metricField(text);
}

function headerForColumn(rows: string[][], headerRow: number, column: number) {
  const pieces: string[] = [];
  for (let row = Math.max(0, headerRow - 3); row <= headerRow; row += 1) {
    const value = rows[row]?.[column]?.trim();
    if (value && !pieces.includes(value)) pieces.push(value);
  }
  return pieces.join(" ");
}

function locateColumns(rows: string[][]) {
  const maxHeaderRow = Math.min(rows.length - 1, 35);
  for (let headerRow = 0; headerRow <= maxHeaderRow; headerRow += 1) {
    const fields = new Map<ColumnField, number>();
    const columnCount = rows[headerRow]?.length ?? 0;
    for (let column = 0; column < columnCount; column += 1) {
      const field = identifyField(headerForColumn(rows, headerRow, column));
      if (field && !fields.has(field)) fields.set(field, column);
    }
    const kpiCount = [...fields.keys()].filter((field) => field.startsWith("actual") || field.startsWith("goal")).length;
    if (fields.has("employeeName") && kpiCount >= 3) return { headerRow, fields };
  }
  return null;
}

function parseNumber(value: string, field: KpiField) {
  const text = value.trim();
  if (!text || /^(N\/?A|NA|-|--|NULL)$/i.test(text)) return null;
  const isPercent = text.includes("%");
  const negativeByParentheses = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[%,$\s]/g, "").replace(/[()]/g, "");
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return Number.NaN;
  let result = negativeByParentheses ? -numeric : numeric;
  if (!isPercent && (field.endsWith("Qa") || field.endsWith("Adherence")) && result > 0 && result <= 1) {
    result *= 100;
  }
  return result;
}

function cleanEmployeeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isDecorativeEmployee(value: string) {
  const text = normalizedWords(value);
  return !text || /^(TOTAL|GRAND TOTAL|AVERAGE|AVG|SUMMARY|EMPLOYEE|AGENT|COLLECTOR|NAME)$/.test(text);
}

function parseSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  month: number,
  fileName: string,
  fallbackYear: number
) {
  const rows = sheetMatrix(sheet);
  const columns = locateColumns(rows);
  if (!columns) {
    return { records: [] as ParsedKpiRow[], error: "Could not identify the employee and KPI headers." };
  }
  const year = inferYear(fileName, sheetName, rows, fallbackYear);
  const records: ParsedKpiRow[] = [];
  const seen = new Set<string>();
  for (let rowIndex = columns.headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const employeeName = cleanEmployeeName(row[columns.fields.get("employeeName") as number] ?? "");
    if (isDecorativeEmployee(employeeName)) continue;
    const values = {} as Record<KpiField, number | null>;
    const parseErrors: string[] = [];
    const kpiFields: KpiField[] = [
      "actualQa", "actualAht", "actualAdherence", "actualCm", "actualCd",
      "goalQa", "goalAht", "goalAdherence", "goalCm", "goalCd",
    ];
    for (const field of kpiFields) {
      const column = columns.fields.get(field);
      const raw = column == null ? "" : row[column] ?? "";
      const parsed = parseNumber(raw, field);
      if (Number.isNaN(parsed)) {
        parseErrors.push(`${field.replace(/([A-Z])/g, " $1").toLowerCase()} is not a valid number.`);
        values[field] = null;
      } else {
        values[field] = parsed;
      }
    }
    const employeeCodeColumn = columns.fields.get("employeeCode");
    const tenureColumn = columns.fields.get("tenure");
    const errors = [...parseErrors, ...validateKpiValues(values)];
    const warnings: string[] = [];
    const missingGoals = ["goalQa", "goalAht", "goalAdherence", "goalCm", "goalCd"].filter(
      (field) => values[field as KpiField] == null
    );
    if (missingGoals.length) warnings.push(`${missingGoals.length} KPI goal value(s) are missing.`);
    const duplicateKey = `${normalizedWords(employeeName)}:${year}:${month}`;
    if (seen.has(duplicateKey)) errors.push("Duplicate employee in this workbook period.");
    seen.add(duplicateKey);
    records.push({
      rowKey: `${sheetName}:${rowIndex + 1}`,
      employeeName,
      employeeCode: employeeCodeColumn == null ? null : String(row[employeeCodeColumn] ?? "").trim() || null,
      tenure: tenureColumn == null ? null : String(row[tenureColumn] ?? "").trim() || null,
      month,
      year,
      sourceSheet: sheetName,
      sourceRow: rowIndex + 1,
      ...values,
      errors,
      warnings,
    });
  }
  return { records };
}

export function parseKpiWorkbook(buffer: Buffer, fileName: string, fallbackYear: number): KpiWorkbookResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellFormula: false,
    cellNF: true,
    dense: false,
  });
  const records: ParsedKpiRow[] = [];
  const worksheets = workbook.SheetNames.map((name) => {
    const month = detectKpiWorksheetMonth(name);
    if (!month) return { name, month: null, supported: false, recordCount: 0 };
    const parsed = parseSheet(workbook.Sheets[name], name, month, fileName, fallbackYear);
    records.push(...parsed.records);
    return {
      name,
      month,
      supported: true,
      recordCount: parsed.records.length,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  });
  return { fileName, worksheets, records };
}
