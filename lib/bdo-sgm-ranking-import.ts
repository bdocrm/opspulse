import * as XLSX from 'xlsx';
import { parseImportNumber } from './import-number';

export const BDO_SGM_METRIC_TYPE = 'transmittals';
export type BdoSgmCardLevel = 'FIRST_CARD' | 'BUNDLE_CARD';

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

const NON_AGENT_LABELS = /^(?:row labels|column labels|count of card level|grand total|sub-?total|total|summary|overall|ranking|rank|card level)$/i;
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

export interface BdoSgmCardLevelDetection {
  normalized: BdoSgmCardLevel | null;
  label: string;
  labelRow: number;
  labelColumn: number;
  valueColumn: number | null;
}

export interface BdoSgmRankingRecord {
  name: string;
  count: number;
  volume: number;
  metricType: typeof BDO_SGM_METRIC_TYPE;
  cardLevel: BdoSgmCardLevel;
  cardLevelLabel: string;
  grandTotal?: number;
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
  headerRows: number[];
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
  detectedCardLevels: BdoSgmCardLevel[];
}

export function isBdoSgmCampaign(value: unknown): boolean {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase() === 'BDO SGM';
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

function compactLabel(value: unknown): string {
  return normalizeLabel(value).replace(/[^a-z0-9]/g, '');
}

function isBlank(value: unknown): boolean {
  return value == null || normalizeText(value) === '';
}

export function normalizeBdoSgmCardLevel(value: unknown): BdoSgmCardLevel | null {
  const normalized = compactLabel(value);
  if (/^(?:1st|first)cards?$/.test(normalized) || normalized === '1st' || normalized === 'first') return 'FIRST_CARD';
  if (/^bundlecards?$/.test(normalized) || normalized === 'bundle') return 'BUNDLE_CARD';
  return null;
}

function cardLevelValue(rows: unknown[][], row: number, column: number): { label: string; column: number | null } {
  const sameRow = rows[row] || [];
  for (let candidate = column + 1; candidate < Math.min(sameRow.length, column + 5); candidate++) {
    const label = normalizeText(sameRow[candidate]);
    if (label) return { label, column: candidate };
  }
  for (let candidateRow = row + 1; candidateRow < Math.min(rows.length, row + 3); candidateRow++) {
    for (const candidateColumn of [column, column + 1]) {
      const label = normalizeText(rows[candidateRow]?.[candidateColumn]);
      if (label) return { label, column: candidateColumn };
    }
  }
  return { label: '', column: null };
}

export function detectBdoSgmCardLevels(rows: unknown[][]): BdoSgmCardLevelDetection[] {
  const detections: BdoSgmCardLevelDetection[] = [];
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < (rows[row] || []).length; column++) {
      if (compactLabel(rows[row][column]) !== 'cardlevel') continue;
      const value = cardLevelValue(rows, row, column);
      detections.push({
        normalized: normalizeBdoSgmCardLevel(value.label),
        label: value.label,
        labelRow: row,
        labelColumn: column,
        valueColumn: value.column,
      });
    }
  }
  return detections;
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
    return { month: value.getMonth(), year: value.getFullYear(), label: normalizeText(value) };
  }
  if (typeof value === 'number') {
    const parsed = excelSerialDate(value);
    return parsed ? { month: parsed.getMonth(), year: parsed.getFullYear(), label: normalizeText(value) } : null;
  }

  const raw = normalizeText(value);
  if (!raw || /^grand\s*total$/i.test(raw)) return null;
  const numericMonth = raw.match(/^(0?[1-9]|1[0-2])\s*[/.]\s*(20\d{2})$/);
  if (numericMonth) {
    return { month: Number(numericMonth[1]) - 1, year: Number(numericMonth[2]), label: raw };
  }

  const lower = raw.toLowerCase();
  const monthToken = lower.match(/\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/);
  if (!monthToken) return null;
  const month = MONTHS.get(monthToken[1]);
  if (month === undefined) return null;
  const year = lower.match(/\b(20\d{2})\b/);
  return { month, year: year ? Number(year[1]) : fallbackYear, label: raw };
}

function findHeaders(rows: unknown[][], fallbackYear: number) {
  const headers: Array<{
    row: number;
    agentColumn: number;
    monthColumns: BdoSgmMonthColumn[];
    grandTotalColumn: number;
  }> = [];
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
    if (monthColumns.length || grandTotalColumn >= 0) headers.push({ row, agentColumn, monthColumns, grandTotalColumn });
  }
  return headers;
}

function monthKey(column: BdoSgmMonthColumn): string {
  return `${column.year}-${String(column.month + 1).padStart(2, '0')}`;
}

function issue(
  issues: BdoSgmImportIssue[],
  warnings: string[],
  worksheet: string,
  row: number,
  reason: string,
  warning: boolean
) {
  issues.push({ worksheet, row, reason, warning });
  warnings.push(`Row ${row}: ${reason}`);
}

function closestCardLevel(
  detections: BdoSgmCardLevelDetection[],
  headerRow: number
): BdoSgmCardLevelDetection | null {
  return detections
    .filter((detection) => detection.labelRow <= headerRow)
    .sort((a, b) => b.labelRow - a.labelRow)[0] || null;
}

function emptyResult(rowsScanned: number): BdoSgmWorksheetParseResult {
  return {
    detected: false,
    format: 'Unsupported',
    headerRow: null,
    headerRows: [],
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
    detectedCardLevels: [],
  };
}

export function parseBdoSgmWorksheet(
  rows: unknown[][],
  worksheet: string,
  fallbackReportDate: Date
): BdoSgmWorksheetParseResult {
  const rowsScanned = rows.filter((row) => (row || []).some((value) => !isBlank(value))).length;
  const cardLevels = detectBdoSgmCardLevels(rows);
  const headers = findHeaders(rows, fallbackReportDate.getFullYear());
  const hasMetricTitle = rows.some((row) => (row || []).some((value) => compactLabel(value) === 'countofcardlevel'));
  const detected = cardLevels.length > 0 || headers.length > 0 || hasMetricTitle;
  if (!detected) return emptyResult(rowsScanned);

  const records: BdoSgmRankingRecord[] = [];
  const issues: BdoSgmImportIssue[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const invalidRowNumbers = new Set<number>();
  const detectedMonths = new Set<string>();
  const detectedCardLevels = new Set<BdoSgmCardLevel>();
  let validAgentRows = 0;
  let skippedBlankCells = 0;
  let supportedSections = 0;

  if (!headers.length) {
    errors.push('The BDO SGM agent table could not be located in the selected workbook.');
  }

  headers.forEach((header, headerIndex) => {
    const cardLevel = closestCardLevel(cardLevels, header.row);
    if (!cardLevel?.label) {
      const reason = 'No supported Card Level was detected. Expected 1st CARD or BUNDLE CARD.';
      issue(issues, warnings, worksheet, header.row + 1, reason, false);
      return;
    }
    if (!cardLevel.normalized) {
      const reason = `Unsupported Card Level "${cardLevel.label}". Expected 1st CARD or BUNDLE CARD.`;
      issue(issues, warnings, worksheet, cardLevel.labelRow + 1, reason, false);
      return;
    }

    const uniqueMonthColumns: BdoSgmMonthColumn[] = [];
    const monthKeys = new Set<string>();
    for (const monthColumn of header.monthColumns) {
      const key = monthKey(monthColumn);
      if (monthKeys.has(key)) {
        issue(issues, warnings, worksheet, header.row + 1, `Duplicate month heading ${key} in column ${monthColumn.column + 1}; the later column was ignored.`, true);
        continue;
      }
      monthKeys.add(key);
      detectedMonths.add(key);
      uniqueMonthColumns.push(monthColumn);
    }
    if (!uniqueMonthColumns.length) {
      issue(issues, warnings, worksheet, header.row + 1, 'A ranking header was found, but no recognizable monthly columns were detected.', false);
      return;
    }

    supportedSections++;
    detectedCardLevels.add(cardLevel.normalized);
    const nextHeaderRow = headers[headerIndex + 1]?.row ?? rows.length;
    const nextCardLevelRow = cardLevels
      .filter((detection) => detection.labelRow > header.row)
      .sort((a, b) => a.labelRow - b.labelRow)[0]?.labelRow ?? rows.length;
    const sectionEnd = Math.min(nextHeaderRow, nextCardLevelRow, rows.length);

    for (let rowIndex = header.row + 1; rowIndex < sectionEnd; rowIndex++) {
      const row = rows[rowIndex] || [];
      const hasMonthlyValue = uniqueMonthColumns.some((column) => !isBlank(row[column.column]));
      const name = normalizeText(row[header.agentColumn]);
      if (!name) {
        if (hasMonthlyValue) {
          issue(issues, warnings, worksheet, rowIndex + 1, 'Collector or agent name is missing.', false);
          invalidRowNumbers.add(rowIndex + 1);
        }
        continue;
      }
      if (NON_AGENT_LABELS.test(name)) continue;

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
          issue(issues, warnings, worksheet, rowIndex + 1, `Invalid value for ${monthKey(monthColumn)}: "${normalizeText(raw).slice(0, 40)}".`, false);
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
          cardLevel: cardLevel.normalized,
          cardLevelLabel: cardLevel.label,
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

      let grandTotal: number | undefined;
      let totalWarning = '';
      if (header.grandTotalColumn >= 0 && !isBlank(row[header.grandTotalColumn])) {
        const parsedTotal = parseImportNumber(row[header.grandTotalColumn]);
        if (!parsedTotal.valid || parsedTotal.value == null || parsedTotal.percentage || parsedTotal.value < 0) {
          totalWarning = `Invalid Grand Total value "${normalizeText(row[header.grandTotalColumn]).slice(0, 40)}".`;
          issue(issues, warnings, worksheet, rowIndex + 1, totalWarning, true);
        } else {
          grandTotal = parsedTotal.value;
          if (!invalidMonthlyCell) {
            const monthlySum = numericMonthlyValues.reduce((sum, value) => sum + value, 0);
            if (Math.abs(monthlySum - grandTotal) > 0.000001) {
              totalWarning = `Grand Total ${grandTotal} does not match the detected monthly sum ${monthlySum}.`;
              issue(issues, warnings, worksheet, rowIndex + 1, totalWarning, true);
            }
          }
        }
      }
      for (const record of rowRecords) {
        record.grandTotal = grandTotal;
        if (totalWarning) record.validationErrors = [totalWarning];
      }
      validAgentRows++;
      records.push(...rowRecords);
    }
  });

  if (!cardLevels.some((cardLevel) => cardLevel.normalized)) {
    errors.push('No supported Card Level was detected. Expected 1st CARD or BUNDLE CARD.');
  } else if (!supportedSections) {
    errors.push('No BDO SGM table could be matched to a supported Card Level.');
  }
  if (supportedSections > 0 && !records.length) {
    errors.push('No valid monthly card-count records were found.');
  }

  return {
    detected: true,
    format: 'BDO SGM Ranking',
    headerRow: headers[0] ? headers[0].row + 1 : null,
    headerRows: headers.map((header) => header.row + 1),
    records,
    issues,
    warnings,
    errors: [...new Set(errors)],
    rowsScanned,
    validAgentRows,
    monthlyRecordsDetected: records.length,
    skippedBlankCells,
    invalidRows: invalidRowNumbers.size,
    warningCount: issues.filter((item) => item.warning).length,
    detectedMonths: [...detectedMonths].sort(),
    detectedCardLevels: [...detectedCardLevels].sort(),
  };
}
