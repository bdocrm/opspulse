import * as XLSX from 'xlsx';
import { parseImportNumber } from './import-number';

export const BDO_SGM_METRIC_TYPE = 'transmittals';

const AGENT_HEADER_ALIASES = new Set([
  'row labels',
  'agent',
  'agent name',
  'agent fullname',
  'collector',
  'collector name',
  'employee name',
  'full name',
  'name',
]);

const NON_AGENT_LABELS = /^(?:row labels|column labels|count of card level|grand total|sub-?total|total|summary|overall|ranking|rank)$/i;
const MONTHS = new Map([
  ['jan', 0], ['january', 0],
  ['feb', 1], ['february', 1],
  ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3],
  ['may', 4],
  ['jun', 5], ['june', 5],
  ['jul', 6], ['july', 6],
  ['aug', 7], ['august', 7],
  ['sep', 8], ['sept', 8], ['september', 8],
  ['oct', 9], ['october', 9],
  ['nov', 10], ['november', 10],
  ['dec', 11], ['december', 11],
]);

export interface BdoSgmMonthColumn {
  column: number;
  month: number;
  year: number;
  label: string;
}

export interface BdoSgmRankingRecord {
  name: string;
  count: number;
  volume: number;
  metricType: typeof BDO_SGM_METRIC_TYPE;
  sourceSheet: string;
  reportDate: Date;
  rowIdx: number;
  validationErrors?: string[];
  normalizedMetrics: Array<{
    metricType: typeof BDO_SGM_METRIC_TYPE;
    count: number;
  }>;
}

export interface BdoSgmImportIssue {
  worksheet: string;
  row: number;
  reason: string;
  warning: boolean;
}

export interface BdoSgmWorksheetParseResult {
  detected: boolean;
  format: 'BDO SGM Ranking' | 'Unsupported';
  headerRow: number | null;
  records: BdoSgmRankingRecord[];
  issues: BdoSgmImportIssue[];
  warnings: string[];
  errors: string[];
  rowsScanned: number;
  validAgentRows: number;
  monthlyRecordsDetected: number;
  skippedBlankCells: number;
  invalidRows: number;
  warningCount: number;
  detectedMonths: string[];
}

export function isBdoSgmCampaign(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'BDO SGM';
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlank(value: unknown): boolean {
  return value == null || normalizeText(value) === '';
}

function excelSerialDate(value: number): Date | null {
  if (value < 30000 || value > 60000) return null;
  const parsed = XLSX.SSF.parse_date_code(value);
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d) : null;
}

function contextYear(rows: unknown[][], headerRow: number, fallbackYear: number): number {
  let detected = fallbackYear;
  for (let row = 0; row <= headerRow; row++) {
    for (const value of rows[row] || []) {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        detected = value.getFullYear();
        continue;
      }
      if (typeof value === 'number') {
        const date = excelSerialDate(value);
        if (date) detected = date.getFullYear();
        else if (Number.isInteger(value) && value >= 2000 && value <= 2100) detected = value;
        continue;
      }
      const years = normalizeText(value).match(/\b20\d{2}\b/g);
      if (years?.length) detected = Number(years[years.length - 1]);
    }
  }
  return detected;
}

export function detectBdoSgmMonth(value: unknown, fallbackYear: number): Omit<BdoSgmMonthColumn, 'column'> | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      month: value.getMonth(),
      year: value.getFullYear(),
      label: normalizeText(value),
    };
  }
  if (typeof value === 'number') {
    const parsed = excelSerialDate(value);
    if (!parsed) return null;
    return {
      month: parsed.getMonth(),
      year: parsed.getFullYear(),
      label: normalizeText(value),
    };
  }

  const raw = normalizeText(value);
  if (!raw || /^grand\s*total$/i.test(raw)) return null;
  const numericMonth = raw.match(/^(0?[1-9]|1[0-2])\s*[/.]\s*(20\d{2})$/);
  if (numericMonth) {
    return {
      month: Number(numericMonth[1]) - 1,
      year: Number(numericMonth[2]),
      label: raw,
    };
  }

  const lower = raw.toLowerCase();
  const monthToken = lower.match(/\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/);
  if (!monthToken) return null;
  const month = MONTHS.get(monthToken[1]);
  if (month === undefined) return null;
  const year = lower.match(/\b(20\d{2})\b/);
  return {
    month,
    year: year ? Number(year[1]) : fallbackYear,
    label: raw,
  };
}

function findHeader(rows: unknown[][], fallbackYear: number) {
  for (let row = 0; row < rows.length; row++) {
    const values = rows[row] || [];
    const agentColumn = values.findIndex((value) => AGENT_HEADER_ALIASES.has(normalizeLabel(value)));
    if (agentColumn < 0) continue;
    const year = contextYear(rows, row, fallbackYear);
    const monthColumns: BdoSgmMonthColumn[] = [];
    let grandTotalColumn = -1;
    for (let column = 0; column < values.length; column++) {
      if (/^grand\s*total$/i.test(normalizeText(values[column]))) {
        grandTotalColumn = column;
        continue;
      }
      const month = detectBdoSgmMonth(values[column], year);
      if (month) monthColumns.push({ ...month, column });
    }
    if (monthColumns.length || grandTotalColumn >= 0) {
      return { row, agentColumn, monthColumns, grandTotalColumn };
    }
  }
  return null;
}

function monthKey(column: BdoSgmMonthColumn): string {
  return `${column.year}-${String(column.month + 1).padStart(2, '0')}`;
}

export function parseBdoSgmWorksheet(
  rows: unknown[][],
  worksheet: string,
  fallbackReportDate: Date
): BdoSgmWorksheetParseResult {
  const rowsScanned = rows.filter((row) => (row || []).some((value) => !isBlank(value))).length;
  const header = findHeader(rows, fallbackReportDate.getFullYear());
  if (!header) {
    return {
      detected: false,
      format: 'Unsupported',
      headerRow: null,
      records: [],
      issues: [],
      warnings: [],
      errors: [],
      rowsScanned,
      validAgentRows: 0,
      monthlyRecordsDetected: 0,
      skippedBlankCells: 0,
      invalidRows: 0,
      warningCount: 0,
      detectedMonths: [],
    };
  }

  const records: BdoSgmRankingRecord[] = [];
  const issues: BdoSgmImportIssue[] = [];
  const warnings: string[] = [];
  const invalidRowNumbers = new Set<number>();
  const uniqueMonthColumns: BdoSgmMonthColumn[] = [];
  const monthKeys = new Set<string>();
  for (const monthColumn of header.monthColumns) {
    const key = monthKey(monthColumn);
    if (monthKeys.has(key)) {
      const reason = `Duplicate month heading ${key} in column ${monthColumn.column + 1}; the later column was ignored.`;
      issues.push({ worksheet, row: header.row + 1, reason, warning: true });
      warnings.push(`Row ${header.row + 1}: ${reason}`);
      continue;
    }
    monthKeys.add(key);
    uniqueMonthColumns.push(monthColumn);
  }

  let validAgentRows = 0;
  let skippedBlankCells = 0;
  for (let rowIndex = header.row + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const name = normalizeText(row[header.agentColumn]);
    if (!name || NON_AGENT_LABELS.test(name)) continue;

    const rowRecords: BdoSgmRankingRecord[] = [];
    const numericMonthlyValues: number[] = [];
    let invalidMonthlyCell = false;
    let populatedMonthCells = 0;
    for (const monthColumn of uniqueMonthColumns) {
      const raw = row[monthColumn.column];
      if (isBlank(raw)) {
        skippedBlankCells++;
        continue;
      }
      populatedMonthCells++;
      const parsed = parseImportNumber(raw);
      if (!parsed.valid || parsed.value == null || parsed.percentage || parsed.value < 0) {
        const reason = `Invalid value for ${monthKey(monthColumn)}: "${normalizeText(raw).slice(0, 40)}".`;
        issues.push({ worksheet, row: rowIndex + 1, reason, warning: false });
        warnings.push(`Row ${rowIndex + 1}: ${reason}`);
        invalidRowNumbers.add(rowIndex + 1);
        invalidMonthlyCell = true;
        continue;
      }
      numericMonthlyValues.push(parsed.value);
      rowRecords.push({
        name,
        count: parsed.value,
        volume: 0,
        metricType: BDO_SGM_METRIC_TYPE,
        sourceSheet: worksheet,
        reportDate: new Date(monthColumn.year, monthColumn.month, 1),
        rowIdx: rowIndex + 1,
        normalizedMetrics: [{ metricType: BDO_SGM_METRIC_TYPE, count: parsed.value }],
      });
    }

    if (!rowRecords.length) {
      if (populatedMonthCells > 0) invalidRowNumbers.add(rowIndex + 1);
      continue;
    }

    let totalWarning = '';
    if (header.grandTotalColumn >= 0 && !isBlank(row[header.grandTotalColumn])) {
      const grandTotal = parseImportNumber(row[header.grandTotalColumn]);
      if (!grandTotal.valid || grandTotal.value == null || grandTotal.percentage || grandTotal.value < 0) {
        const reason = `Invalid Grand Total value "${normalizeText(row[header.grandTotalColumn]).slice(0, 40)}".`;
        issues.push({ worksheet, row: rowIndex + 1, reason, warning: true });
        warnings.push(`Row ${rowIndex + 1}: ${reason}`);
        totalWarning = reason;
      } else if (!invalidMonthlyCell) {
        const monthlySum = numericMonthlyValues.reduce((sum, value) => sum + value, 0);
        if (Math.abs(monthlySum - grandTotal.value) > 0.000001) {
          const reason = `Grand Total ${grandTotal.value} does not match the detected monthly sum ${monthlySum}.`;
          issues.push({ worksheet, row: rowIndex + 1, reason, warning: true });
          warnings.push(`Row ${rowIndex + 1}: ${reason}`);
          totalWarning = reason;
        }
      }
    }
    if (totalWarning) {
      for (const record of rowRecords) record.validationErrors = [totalWarning];
    }
    validAgentRows++;
    records.push(...rowRecords);
  }

  return {
    detected: true,
    format: 'BDO SGM Ranking',
    headerRow: header.row + 1,
    records,
    issues,
    warnings,
    errors: uniqueMonthColumns.length ? [] : ['A ranking header was found, but no monthly columns were detected.'],
    rowsScanned,
    validAgentRows,
    monthlyRecordsDetected: records.length,
    skippedBlankCells,
    invalidRows: invalidRowNumbers.size,
    warningCount: issues.filter((issue) => issue.warning).length,
    detectedMonths: [...new Set(uniqueMonthColumns.map(monthKey))].sort(),
  };
}
