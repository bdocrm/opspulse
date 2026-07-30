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

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : '';
}

function archiveXml(archive: any, suffix: string): string {
  const index = (archive.FullPaths as string[]).findIndex((path) => path.endsWith(suffix));
  if (index < 0) return '';
  return Buffer.from(archive.FileIndex[index].content).toString('utf8');
}

interface PivotCacheField {
  name: string;
  sharedItems: string[];
}

function pivotCacheFields(definitionXml: string): PivotCacheField[] {
  const fields: PivotCacheField[] = [];
  const fieldPattern = /<cacheField\b([^>]*)>([\s\S]*?)<\/cacheField>/g;
  for (const fieldMatch of definitionXml.matchAll(fieldPattern)) {
    const sharedItems: string[] = [];
    const sharedItemsXml = fieldMatch[2].match(/<sharedItems\b[^>]*>([\s\S]*?)<\/sharedItems>/)?.[1] || '';
    for (const item of sharedItemsXml.matchAll(/<(?:s|n|d|b)\b([^>]*)\/>/g)) {
      sharedItems.push(xmlAttribute(item[1], 'v'));
    }
    fields.push({
      name: decodeXml(xmlAttribute(fieldMatch[1], 'name')),
      sharedItems,
    });
  }
  return fields;
}

interface PivotValue {
  value: string;
  sharedIndex: number | null;
}

function pivotRecordValues(recordXml: string, fields: PivotCacheField[]): PivotValue[] {
  const values: PivotValue[] = [];
  const cellPattern = /<(x|s|n|d|b|e|m)\b([^>]*)\/>/g;
  let fieldIndex = 0;
  for (const cell of recordXml.matchAll(cellPattern)) {
    const tag = cell[1];
    const raw = xmlAttribute(cell[2], 'v');
    const sharedIndex = tag === 'x' && /^\d+$/.test(raw) ? Number(raw) : null;
    values.push({
      value: sharedIndex == null ? raw : fields[fieldIndex]?.sharedItems[sharedIndex] || '',
      sharedIndex,
    });
    fieldIndex++;
  }
  return values;
}

function pivotHiddenValues(
  pivotTableXml: string,
  fields: PivotCacheField[],
  cardLevelField: number
): Map<number, Set<string>> {
  const hiddenByField = new Map<number, Set<string>>();
  const pivotFieldsXml = pivotTableXml.match(/<pivotFields\b[^>]*>([\s\S]*?)<\/pivotFields>/)?.[1] || '';
  const fieldPattern = /<pivotField\b([^>]*?)(?:\/>|>([\s\S]*?)<\/pivotField>)/g;
  let fieldIndex = 0;
  for (const fieldMatch of pivotFieldsXml.matchAll(fieldPattern)) {
    const attributes = fieldMatch[1];
    const body = fieldMatch[2] || '';
    const filteredAxis = /\baxis="(?:axisPage|axisCol)"/.test(attributes);
    if (filteredAxis && fieldIndex !== cardLevelField) {
      const hidden = new Set<string>();
      for (const item of body.matchAll(/<item\b([^>]*)\/>/g)) {
        if (xmlAttribute(item[1], 'h') !== '1') continue;
        const sharedIndex = Number(xmlAttribute(item[1], 'x'));
        const value = fields[fieldIndex]?.sharedItems[sharedIndex];
        if (value != null) hidden.add(value);
      }
      if (hidden.size) hiddenByField.set(fieldIndex, hidden);
    }
    fieldIndex++;
  }

  for (const pageField of pivotTableXml.matchAll(/<pageField\b([^>]*)\/>/g)) {
    const fieldIndex = Number(xmlAttribute(pageField[1], 'fld'));
    const selectedItem = xmlAttribute(pageField[1], 'item');
    if (
      fieldIndex === cardLevelField ||
      !selectedItem ||
      !Number.isInteger(fieldIndex) ||
      !/^\d+$/.test(selectedItem)
    ) continue;
    const selectedValue = fields[fieldIndex]?.sharedItems[Number(selectedItem)];
    if (selectedValue == null) continue;
    hiddenByField.set(
      fieldIndex,
      new Set(fields[fieldIndex].sharedItems.filter((value) => value !== selectedValue))
    );
  }
  return hiddenByField;
}

function fieldIndexByName(fields: PivotCacheField[], aliases: string[]): number {
  const normalizedAliases = new Set(aliases.map(compactLabel));
  return fields.findIndex((field) => normalizedAliases.has(compactLabel(field.name)));
}

/**
 * Reconstructs a BDO SGM ranking from the embedded Excel pivot cache.
 * This allows both Card Levels to be imported even when the saved visible pivot
 * is filtered to only 1st Card or Bundle Card.
 */
export function parseBdoSgmPivotCache(
  workbookBytes: Uint8Array,
  sourceSheet: string,
  fallbackReportDate: Date
): BdoSgmWorksheetParseResult | null {
  let archive: any;
  try {
    archive = (XLSX as any).CFB.read(Buffer.from(workbookBytes), { type: 'buffer' });
  } catch {
    return null;
  }

  const cacheDefinitions = (archive.FullPaths as string[])
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => /\/xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/i.test(path));

  for (const { path } of cacheDefinitions) {
    const cacheNumber = path.match(/pivotCacheDefinition(\d+)\.xml$/i)?.[1];
    if (!cacheNumber) continue;
    const definitionXml = archiveXml(archive, `xl/pivotCache/pivotCacheDefinition${cacheNumber}.xml`);
    const recordsXml = archiveXml(archive, `xl/pivotCache/pivotCacheRecords${cacheNumber}.xml`);
    if (!definitionXml || !recordsXml) continue;

    const fields = pivotCacheFields(definitionXml);
    const agentField = fieldIndexByName(fields, ['Assigned Caller', 'Agent', 'Agent Name', 'Collector', 'Collector Name']);
    const cardLevelField = fieldIndexByName(fields, ['Card Level']);
    const actualMonthField = fieldIndexByName(fields, ['Turn Ins Actual Month', 'Turn In Actual Month', 'Turn In Month']);
    const dateField = fieldIndexByName(fields, ['Turn In Date', 'Transmittal Date']);
    const yearField = fieldIndexByName(fields, ['Transmital Year', 'Transmittal Year']);
    if (agentField < 0 || cardLevelField < 0 || actualMonthField < 0) continue;

    const pivotTableXml = (archive.FullPaths as string[])
      .filter((candidate) => /\/xl\/pivotTables\/pivotTable\d+\.xml$/i.test(candidate))
      .map((candidate) => archiveXml(archive, candidate.replace(/^.*\/xl\//, 'xl/')))
      .find((candidate) =>
        new RegExp(`<dataField\\b[^>]*\\bfld="${cardLevelField}"`).test(candidate) &&
        new RegExp(`<rowFields\\b[^>]*>[\\s\\S]*?<field\\b[^>]*\\bx="${agentField}"`).test(candidate)
      ) || '';
    if (!pivotTableXml) continue;

    const hiddenValues = pivotHiddenValues(pivotTableXml, fields, cardLevelField);
    const grouped = new Map<string, {
      name: string;
      cardLevel: BdoSgmCardLevel;
      cardLevelLabel: string;
      reportDate: Date;
      count: number;
      firstRow: number;
    }>();
    let rowsScanned = 0;
    let invalidRows = 0;

    for (const recordMatch of recordsXml.matchAll(/<r>([\s\S]*?)<\/r>/g)) {
      rowsScanned++;
      const values = pivotRecordValues(recordMatch[1], fields);
      const excluded = [...hiddenValues.entries()].some(([fieldIndex, hidden]) =>
        hidden.has(values[fieldIndex]?.value || '')
      );
      if (excluded) continue;

      const cardLevelLabel = normalizeText(values[cardLevelField]?.value);
      const cardLevel = normalizeBdoSgmCardLevel(cardLevelLabel);
      if (!cardLevel) continue;
      const name = normalizeText(values[agentField]?.value);
      if (!name || NON_AGENT_LABELS.test(name)) {
        invalidRows++;
        continue;
      }

      const dateValue = values[dateField]?.value;
      const parsedDate = dateValue ? new Date(dateValue) : null;
      let year = parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.getUTCFullYear()
        : Number(values[yearField]?.value);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) year = fallbackReportDate.getFullYear();
      const month = detectBdoSgmMonth(values[actualMonthField]?.value, year);
      if (!month) {
        invalidRows++;
        continue;
      }

      const key = `${cardLevel}|${name}|${month.year}-${String(month.month + 1).padStart(2, '0')}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(key, {
          name,
          cardLevel,
          cardLevelLabel,
          reportDate: new Date(month.year, month.month, 1),
          count: 1,
          firstRow: rowsScanned,
        });
      }
    }

    if (!grouped.size) continue;
    const totals = new Map<string, number>();
    for (const item of grouped.values()) {
      const key = `${item.cardLevel}|${item.name}`;
      totals.set(key, (totals.get(key) || 0) + item.count);
    }
    const records = [...grouped.values()]
      .map<BdoSgmRankingRecord>((item) => ({
        name: item.name,
        count: item.count,
        volume: 0,
        metricType: BDO_SGM_METRIC_TYPE,
        cardLevel: item.cardLevel,
        cardLevelLabel: item.cardLevelLabel,
        grandTotal: totals.get(`${item.cardLevel}|${item.name}`),
        sourceSheet,
        reportDate: item.reportDate,
        rowIdx: item.firstRow,
        normalizedMetrics: [{ metricType: BDO_SGM_METRIC_TYPE, count: item.count }],
      }))
      .sort((a, b) =>
        a.cardLevel.localeCompare(b.cardLevel) ||
        a.reportDate.getTime() - b.reportDate.getTime() ||
        a.name.localeCompare(b.name)
      );
    const detectedMonths = [...new Set(records.map((record) =>
      `${record.reportDate.getFullYear()}-${String(record.reportDate.getMonth() + 1).padStart(2, '0')}`
    ))].sort();
    const detectedCardLevels = [...new Set(records.map((record) => record.cardLevel))].sort();
    const validAgentRows = new Set(records.map((record) => `${record.cardLevel}|${record.name}`)).size;

    return {
      detected: true,
      format: 'BDO SGM Ranking',
      headerRow: null,
      headerRows: [],
      records,
      issues: [],
      warnings: [],
      errors: [],
      rowsScanned,
      validAgentRows,
      monthlyRecordsDetected: records.length,
      skippedBlankCells: 0,
      invalidRows,
      warningCount: 0,
      detectedMonths,
      detectedCardLevels,
    };
  }
  return null;
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
