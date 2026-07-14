import * as XLSX from 'xlsx';

export const BDO_WORKSHEETS = {
  'ytd performance': 'YTD Performance',
  'manpower monitoring': 'Manpower Monitoring',
  'ci agents monitoring': 'CI Agents Monitoring',
  'cross sell agents monitoring': 'Cross Sell Agents Monitoring',
  'tls scorecard': 'TLs Scorecard',
  'ci hoh monitoring': 'CI HOH Monitoring',
  'cross sell hoh monitoring': 'CROSS SELL HOH Monitoring',
} as const;

export type BdoWorksheetType = typeof BDO_WORKSHEETS[keyof typeof BDO_WORKSHEETS];
export type BdoRecordKind = 'ytd' | 'manpower' | 'agent_monitoring' | 'team_leader';

export type BdoImportIssue = {
  worksheet: string;
  row?: number;
  message: string;
  rawValue?: string;
};

export type BdoImportRecord = {
  worksheetSource: string;
  sourceRow: number;
  recordKind: BdoRecordKind;
  monitoringType?: string;
  entityName?: string;
  level?: string;
  category?: string;
  product?: string;
  metric: string;
  month?: number;
  year: number;
  reportDate: Date;
  target?: number;
  actual?: number;
  achievement?: number;
  numericValue?: number;
  declaredSeat?: number;
  actualHeadCount?: number;
  remark?: string;
};

export type BdoSheetResult = {
  sheetName: string;
  detectedType: BdoWorksheetType | 'Unsupported';
  records: BdoImportRecord[];
  months: string[];
  warnings: BdoImportIssue[];
  status: 'Ready' | 'Skipped' | 'Warning';
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const INVALID_NUMBER = /^(?:#(?:div\/0!|value!|n\/a|ref!|num!|name\?|null!)|no\s+final\s+report.*)$/i;
const SUMMARY_NAME = /^(?:total|grand total|average|avg|summary|ranking|rank|team total|overall)$/i;

export function normalizeBdoText(value: unknown) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedKey(value: unknown) {
  return normalizeBdoText(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function detectBdoWorksheet(name: string): BdoWorksheetType | null {
  return BDO_WORKSHEETS[normalizedKey(name) as keyof typeof BDO_WORKSHEETS] || null;
}

export function isBdoDashboardWorkbook(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.some((name) => detectBdoWorksheet(name));
}

function monthFrom(value: unknown): { month: number; year?: number } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { month: value.getMonth() + 1, year: value.getFullYear() };
  const text = normalizedKey(value);
  if (!text) return null;
  const firstToken = text.split(' ')[0];
  const month = MONTHS.findIndex((item) => firstToken === item || firstToken === item.slice(0, 3));
  if (month < 0) return null;
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  return { month: month + 1, year: year ? Number(year) : undefined };
}

function parseNumeric(value: unknown, percentage = false): { value?: number; issue?: string; remark?: string } {
  if (value == null || value === '') return {};
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { issue: 'Formula returned a non-finite value.' };
    return { value: percentage && Math.abs(value) > 2 ? value / 100 : value };
  }
  const text = normalizeBdoText(value);
  if (!text) return {};
  if (INVALID_NUMBER.test(text)) return { issue: `Invalid numeric cell: ${text}`, remark: text };
  const percent = text.includes('%');
  const cleaned = text.replace(/[₱$€£,%\s]/g, '').replace(/\(([^)]+)\)/, '-$1');
  if (!/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(cleaned)) return { issue: `Text value skipped: ${text}`, remark: text };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { issue: `Invalid numeric cell: ${text}`, remark: text };
  return { value: percent || (percentage && Math.abs(parsed) > 2) ? parsed / 100 : parsed };
}

function rowsWithMergedCells(sheet: XLSX.WorkSheet): unknown[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  for (const range of sheet['!merges'] || []) {
    const value = rows[range.s.r]?.[range.s.c];
    if (value == null || value === '') continue;
    for (let row = range.s.r; row <= range.e.r; row++) {
      rows[row] ||= [];
      for (let col = range.s.c; col <= range.e.c; col++) if (rows[row][col] == null || rows[row][col] === '') rows[row][col] = value;
    }
  }
  return rows;
}

function workbookYear(rows: unknown[][], fallbackYear: number) {
  for (const value of rows.slice(0, 25).flat()) {
    if (value instanceof Date && value.getFullYear() >= 2000) return value.getFullYear();
    const hit = normalizeBdoText(value).match(/\b(20\d{2})\b/);
    if (hit) return Number(hit[1]);
  }
  return fallbackYear;
}

function monthLabel(year: number, month: number) {
  return `${MONTHS[month - 1].slice(0, 3).replace(/^./, (letter) => letter.toUpperCase())} ${year}`;
}

type GroupColumn = { col: number; month: number; year: number; field: string; product?: string };

function fieldAlias(value: unknown) {
  const key = normalizedKey(value);
  if (/declared.*seat/.test(key)) return 'declared_seat';
  if (/actual.*head|head.*count/.test(key)) return 'actual_head_count';
  if (/\b(?:achievement|achvt|achieve|attainment|percentage|percent|rate)\b/.test(key) || key.includes('%')) return 'achievement';
  if (/\b(?:actual|actuals|volume|vol|performance)\b/.test(key)) return 'actual';
  if (/\b(?:goal|target)\b/.test(key)) return 'target';
  if (/\b(?:level|agent level)\b/.test(key)) return 'level';
  return '';
}

function detectGroupedColumns(rows: unknown[][], fallbackYear: number, headerLimit = 30) {
  const limit = Math.min(rows.length, headerLimit);
  const maxColumns = Math.max(0, ...rows.slice(0, limit).map((row) => row.length));
  const monthByColumn = new Map<number, { month: number; year: number }>();
  let active: { month: number; year: number } | null = null;
  for (let col = 0; col < maxColumns; col++) {
    const hit = rows.slice(0, limit).map((row) => monthFrom(row[col])).find(Boolean);
    if (hit) active = { month: hit.month, year: hit.year || fallbackYear };
    if (active) monthByColumn.set(col, active);
  }
  const columns: GroupColumn[] = [];
  for (let col = 0; col < maxColumns; col++) {
    const period = monthByColumn.get(col);
    if (!period) continue;
    const labels = rows.slice(0, limit).map((row) => normalizeBdoText(row[col])).filter(Boolean);
    const field = labels.map(fieldAlias).find(Boolean) || '';
    if (!field) continue;
    const product = labels.find((label) => /cash installment|nth card|supplementary|virtual card|cross sell|ci\b/i.test(label));
    columns.push({ col, ...period, field, product });
  }
  return columns;
}

function findColumn(rows: unknown[][], aliases: RegExp[], limit = 30) {
  for (let row = 0; row < Math.min(rows.length, limit); row++) {
    for (let col = 0; col < rows[row].length; col++) {
      const key = normalizedKey(rows[row][col]);
      if (aliases.some((alias) => alias.test(key))) return { row, col };
    }
  }
  return null;
}

function addNumericIssue(issues: BdoImportIssue[], worksheet: string, row: number, parsed: ReturnType<typeof parseNumeric>, raw: unknown) {
  if (parsed.issue) issues.push({ worksheet, row, message: parsed.issue, rawValue: normalizeBdoText(raw).slice(0, 250) });
}

function parseAgentMonitoring(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const year = workbookYear(rows, fallbackYear);
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|name)$/]);
  const levelHit = findColumn(rows, [/^level$/, /^agent level$/]);
  const productHit = findColumn(rows, [/^(?:product|product type|metric type)$/]);
  const columns = detectGroupedColumns(rows, year);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  if (!nameHit || !columns.length) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'The worksheet was detected, but no valid monthly agent columns were found.' }], status: 'Skipped' };
  const isCrossSell = /cross sell/i.test(detectedType);
  const monitoringType = /hoh/i.test(detectedType) ? (isCrossSell ? 'CROSS_SELL_HOH' : 'CI_HOH') : (isCrossSell ? 'CROSS_SELL_AGENT' : 'CI_AGENT');
  const dataStart = Math.max(nameHit.row, ...columns.map(() => nameHit.row)) + 1;
  const periods = [...new Map(columns.map((column) => [`${column.year}-${column.month}`, { year: column.year, month: column.month }])).values()];
  let activeName = '';
  for (let rowIndex = dataStart; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const rowName = normalizeBdoText(row[nameHit.col]);
    if (rowName) activeName = rowName;
    const name = activeName;
    if (!name || SUMMARY_NAME.test(name) || /^(?:no\.?|rank|ranking)$/i.test(name)) continue;
    for (const period of periods) {
      const group = columns.filter((column) => column.year === period.year && column.month === period.month);
      const values = new Map<string, ReturnType<typeof parseNumeric>>();
      for (const column of group) {
        if (column.field === 'level') continue;
        const parsed = parseNumeric(row[column.col], column.field === 'achievement');
        addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
        values.set(column.field, parsed);
      }
      const target = values.get('target')?.value;
      const actual = values.get('actual')?.value;
      const achievement = values.get('achievement')?.value;
      if (target == null && actual == null && achievement == null) continue;
      const product = (productHit ? normalizeBdoText(row[productHit.col]) : '') || group.map((column) => column.product).find(Boolean);
      const groupLevel = group.find((column) => column.field === 'level');
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'agent_monitoring', monitoringType, entityName: name, level: groupLevel ? normalizeBdoText(row[groupLevel.col]) : levelHit ? normalizeBdoText(row[levelHit.col]) : undefined, product, metric: product || (isCrossSell ? 'Cross Sell' : 'Cash Installment'), month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), target, actual, achievement });
    }
  }
  return { sheetName, detectedType, records, months: periods.filter((period) => records.some((record) => record.month === period.month && record.year === period.year)).map((period) => monthLabel(period.year, period.month)), warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseManpower(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const year = workbookYear(rows, fallbackYear);
  const particularHit = findColumn(rows, [/^(?:particular|description|metric|manpower metric)$/]);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  const months: string[] = [];
  if (!particularHit) return { sheetName, detectedType, records, months, warnings: [{ worksheet: sheetName, message: 'The worksheet was detected, but a Particular column was not found.' }], status: 'Skipped' };
  const monthColumns: Array<{ col: number; month: number; year: number }> = [];
  for (let col = 0; col < Math.max(...rows.map((row) => row.length)); col++) {
    const hit = rows.slice(0, particularHit.row + 3).map((row) => monthFrom(row[col])).find(Boolean);
    if (hit) monthColumns.push({ col, month: hit.month, year: hit.year || year });
  }
  for (let rowIndex = particularHit.row + 1; rowIndex < rows.length; rowIndex++) {
    const particular = normalizeBdoText(rows[rowIndex]?.[particularHit.col]);
    if (!particular || SUMMARY_NAME.test(particular)) continue;
    for (const period of monthColumns) {
      const percentage = /percentage|rate|turnover/i.test(particular);
      const parsed = parseNumeric(rows[rowIndex]?.[period.col], percentage);
      addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[period.col]);
      if (parsed.value == null) continue;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'manpower', metric: particular, month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), numericValue: parsed.value });
    }
  }
  months.push(...[...new Set(records.map((record) => monthLabel(record.year, record.month!)))]);
  return { sheetName, detectedType, records, months, warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseTeamLeaders(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const year = workbookYear(rows, fallbackYear);
  const nameHit = findColumn(rows, [/^(?:team leader|team leader name|tl|tl name|name)$/]);
  const columns = detectGroupedColumns(rows, year);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  if (!nameHit || !columns.length) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'The worksheet was detected, but no valid monthly team-leader groups were found.' }], status: 'Skipped' };
  const periods = [...new Map(columns.map((column) => [`${column.year}-${column.month}`, { year: column.year, month: column.month }])).values()];
  for (let rowIndex = nameHit.row + 1; rowIndex < rows.length; rowIndex++) {
    const name = normalizeBdoText(rows[rowIndex]?.[nameHit.col]);
    if (!name || SUMMARY_NAME.test(name)) continue;
    for (const period of periods) {
      const group = columns.filter((column) => column.year === period.year && column.month === period.month);
      const get = (field: string) => {
        const column = group.find((item) => item.field === field);
        if (!column) return undefined;
        const parsed = parseNumeric(rows[rowIndex]?.[column.col], field === 'achievement');
        addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[column.col]);
        return parsed.value;
      };
      const target = get('target'); const actual = get('actual'); const achievement = get('achievement');
      const declaredSeat = get('declared_seat'); const actualHeadCount = get('actual_head_count');
      if ([target, actual, achievement, declaredSeat, actualHeadCount].every((value) => value == null)) continue;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'team_leader', entityName: name, metric: 'Scorecard', declaredSeat, actualHeadCount, month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), target, actual, achievement });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseYtd(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const year = workbookYear(rows, fallbackYear);
  const columns = detectGroupedColumns(rows, year);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  if (!columns.length) {
    const monthHit = findColumn(rows, [/^(?:month|report month|period)$/]);
    const categoryHit = findColumn(rows, [/^(?:category|product|campaign)$/]);
    const metricHit = findColumn(rows, [/^(?:metric|particular|description)$/]);
    const targetHit = findColumn(rows, [/^(?:target|goal)$/]);
    const actualHit = findColumn(rows, [/^(?:actual|actuals|volume|vol)$/]);
    const achievementHit = findColumn(rows, [/^(?:achievement|achvt|attainment)$/]);
    if (monthHit && metricHit && (targetHit || actualHit || achievementHit)) {
      const start = Math.max(monthHit.row, metricHit.row, targetHit?.row || 0, actualHit?.row || 0, achievementHit?.row || 0) + 1;
      for (let rowIndex = start; rowIndex < rows.length; rowIndex++) {
        const period = monthFrom(rows[rowIndex]?.[monthHit.col]);
        const metric = normalizeBdoText(rows[rowIndex]?.[metricHit.col]);
        if (!period || !metric || SUMMARY_NAME.test(metric)) continue;
        const read = (hit: { col: number } | null, percentage = false) => {
          if (!hit) return undefined;
          const parsed = parseNumeric(rows[rowIndex]?.[hit.col], percentage);
          addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[hit.col]);
          return parsed.value;
        };
        const target = read(targetHit); const actual = read(actualHit); const achievement = read(achievementHit, true);
        if (target == null && actual == null && achievement == null) continue;
        const recordYear = period.year || year;
        records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'ytd', category: categoryHit ? normalizeBdoText(rows[rowIndex]?.[categoryHit.col]) : undefined, metric, month: period.month, year: recordYear, reportDate: new Date(recordYear, period.month - 1, 1), target, actual, achievement });
      }
      return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
    }
    return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'The worksheet was detected, but no valid monthly YTD columns were found.' }], status: 'Skipped' };
  }
  const firstMetricColumn = Math.min(...columns.map((column) => column.col));
  const headerRow = rows.findIndex((row) => row.some((cell) => ['target', 'actual', 'achievement'].includes(fieldAlias(cell))));
  const categoryHit = findColumn(rows, [/^(?:category|product|campaign)$/]) || (firstMetricColumn > 1 ? { row: Math.max(0, headerRow), col: 0 } : null);
  const metricHit = findColumn(rows, [/^(?:metric|particular|description)$/]) || (firstMetricColumn > 0 ? { row: Math.max(0, headerRow), col: firstMetricColumn - 1 } : null);
  const firstDataRow = Math.max(headerRow, categoryHit?.row ?? 0, metricHit?.row ?? 0) + 1;
  let activeCategory = '';
  for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const category = categoryHit ? normalizeBdoText(row[categoryHit.col]) : '';
    if (category) activeCategory = category;
    const metric = metricHit ? normalizeBdoText(row[metricHit.col]) : category || activeCategory;
    if (!metric || SUMMARY_NAME.test(metric)) continue;
    const periods = [...new Map(columns.map((column) => [`${column.year}-${column.month}`, { year: column.year, month: column.month }])).values()];
    for (const period of periods) {
      const group = columns.filter((column) => column.year === period.year && column.month === period.month);
      const get = (field: string) => {
        const column = group.find((item) => item.field === field);
        if (!column) return undefined;
        const parsed = parseNumeric(row[column.col], field === 'achievement');
        addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
        return parsed.value;
      };
      const target = get('target'); const actual = get('actual'); const achievement = get('achievement');
      if (target == null && actual == null && achievement == null) continue;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'ytd', category: activeCategory || category, metric, month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), target, actual, achievement });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

export function parseBdoDashboardWorkbook(workbook: XLSX.WorkBook, fallbackDate: Date) {
  const sheets: BdoSheetResult[] = workbook.SheetNames.map((sheetName) => {
    const detectedType = detectBdoWorksheet(sheetName);
    if (!detectedType) return { sheetName, detectedType: 'Unsupported', records: [], months: [], warnings: [{ worksheet: sheetName, message: 'Unsupported worksheet skipped.' }], status: 'Skipped' };
    const rows = rowsWithMergedCells(workbook.Sheets[sheetName]);
    if (detectedType === 'Manpower Monitoring') return parseManpower(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'TLs Scorecard') return parseTeamLeaders(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'YTD Performance') return parseYtd(rows, sheetName, detectedType, fallbackDate.getFullYear());
    return parseAgentMonitoring(rows, sheetName, detectedType, fallbackDate.getFullYear());
  });
  const records = sheets.flatMap((sheet) => sheet.records);
  const years = records.map((record) => record.year);
  return {
    sheets,
    records,
    issues: sheets.flatMap((sheet) => sheet.warnings),
    workbookYear: years.length ? Math.max(...years) : fallbackDate.getFullYear(),
    detectedMonths: [...new Set(sheets.flatMap((sheet) => sheet.months))],
    detectedCategories: [...new Set(records.map((record) => record.category).filter(Boolean) as string[])],
    detectedMetrics: [...new Set(records.map((record) => record.metric).filter(Boolean))],
    agents: [...new Set(records.filter((record) => record.recordKind === 'agent_monitoring').map((record) => record.entityName).filter(Boolean) as string[])],
    teamLeaders: [...new Set(records.filter((record) => record.recordKind === 'team_leader').map((record) => record.entityName).filter(Boolean) as string[])],
  };
}
