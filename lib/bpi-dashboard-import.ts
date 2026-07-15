import * as XLSX from 'xlsx';
import { canonicalCampaignName } from './campaign-import-mapping';
import type { BdoImportIssue, BdoImportRecord } from './bdo-dashboard-import';

export const BPI_WORKSHEETS = {
  'ytd performance': 'YTD Performance',
  'manpower monitoring': 'Manpower Monitoring',
  'pa agents monitoring': 'PA Agents Monitoring',
  'pl ytd productivity': 'PL YTD Productivity',
  'pa hoh monitoring': 'PA HOH Monitoring',
  'pl hoh monitoring': 'PL HOH Monitoring',
} as const;

export type BpiWorksheetType = typeof BPI_WORKSHEETS[keyof typeof BPI_WORKSHEETS];
export type BpiImportRecord = BdoImportRecord;

type SheetResult = {
  sheetName: string;
  detectedType: BpiWorksheetType | 'Unsupported';
  records: BpiImportRecord[];
  months: string[];
  warnings: BdoImportIssue[];
  status: 'Ready' | 'Skipped' | 'Warning';
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// BPI productivity workbooks use OLD / SEMI OLD / NEW as tenure buckets and
// place their aggregate totals in the agent-name column. They are headings,
// not collectors, so never normalize them into agent monitoring records.
const SUMMARY_NAME = /^(?:total|grand total|average|avg|summary|ranking|rank|team total|overall|notes?|remarks?|old|semi[\s-]*old|new|(?:old|semi[\s-]*old|new|total)[\s-]*average[\s-]*per[\s-]*agent)$/i;
const INVALID_NUMBER = /^#(?:div\/0!|value!|n\/a|ref!|num!|name\?|null!)$/i;

export function normalizeBpiText(value: unknown) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function key(value: unknown) {
  return normalizeBpiText(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function detectBpiWorksheet(name: string): BpiWorksheetType | null {
  return BPI_WORKSHEETS[key(name) as keyof typeof BPI_WORKSHEETS] || null;
}

export function isBpiDashboardWorkbook(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.some((name) => {
    const detected = detectBpiWorksheet(name);
    return detected && !['YTD Performance', 'Manpower Monitoring'].includes(detected);
  });
}

function rowsWithMergedCells(sheet: XLSX.WorkSheet): unknown[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  for (const range of sheet['!merges'] || []) {
    const value = rows[range.s.r]?.[range.s.c];
    if (value == null || value === '') continue;
    for (let row = range.s.r; row <= range.e.r; row++) {
      rows[row] ||= [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        if (rows[row][col] == null || rows[row][col] === '') rows[row][col] = value;
      }
    }
  }
  return rows;
}

function monthFrom(value: unknown): { month: number; year?: number } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { month: value.getMonth() + 1, year: value.getFullYear() };
  const text = key(value);
  if (!text) return null;
  const token = text.split(' ')[0];
  const index = MONTHS.findIndex((month) => token === month || token === month.slice(0, 3) || (token === 'sept' && month === 'september'));
  if (index < 0) return null;
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  return { month: index + 1, year: year ? Number(year) : undefined };
}

function workbookYear(rows: unknown[][], fallback: number) {
  for (const value of rows.slice(0, 30).flat()) {
    if (value instanceof Date && value.getFullYear() >= 2000) return value.getFullYear();
    const found = normalizeBpiText(value).match(/\b(20\d{2})\b/);
    if (found) return Number(found[1]);
  }
  return fallback;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function parseNumeric(value: unknown, percentage = false): { value?: number; issue?: string; remark?: string } {
  if (value == null || value === '') return {};
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { issue: 'Formula returned a non-finite value.' };
    return { value: percentage && Math.abs(value) > 2 ? value / 100 : value };
  }
  const text = normalizeBpiText(value);
  if (!text || /^(?:-|—|n\/?a|na)$/i.test(text)) return { remark: text || undefined };
  if (INVALID_NUMBER.test(text)) return { issue: `Invalid numeric cell: ${text}`, remark: text };
  const hasPercent = text.includes('%');
  const cleaned = text.replace(/[₱$€£,%\s]/g, '').replace(/\(([^)]+)\)/, '-$1');
  if (!/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(cleaned)) return { issue: `Text value skipped: ${text}`, remark: text };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { issue: `Invalid numeric cell: ${text}`, remark: text };
  return { value: hasPercent || (percentage && Math.abs(parsed) > 2) ? parsed / 100 : parsed };
}

function addIssue(issues: BdoImportIssue[], sheet: string, row: number, parsed: ReturnType<typeof parseNumeric>, raw: unknown) {
  if (parsed.issue) issues.push({ worksheet: sheet, row, message: parsed.issue, rawValue: normalizeBpiText(raw).slice(0, 250) });
}

function findColumn(rows: unknown[][], aliases: RegExp[], limit = 35) {
  for (let row = 0; row < Math.min(rows.length, limit); row++) {
    for (let col = 0; col < rows[row].length; col++) if (aliases.some((alias) => alias.test(key(rows[row][col])))) return { row, col };
  }
  return null;
}

function campaignEvidence(values: unknown[], fallback = '') {
  const labels = values.map(normalizeBpiText).filter(Boolean);
  return labels.find((label) => canonicalCampaignName(label)) || labels.find((label) => /\b(?:pa|pl|personal loans|business loans|sip loans)\b/i.test(label)) || fallback;
}

function achievement(target?: number, actual?: number, supplied?: number) {
  if (supplied != null) return supplied;
  return target != null && target !== 0 && actual != null ? actual / target : undefined;
}

function actualFromAchievement(target?: number, actual?: number, suppliedAchievement?: number) {
  if (actual != null) return actual;
  return target != null && suppliedAchievement != null ? Math.round(target * suppliedAchievement) : undefined;
}

type MonthlyColumn = { col: number; month: number; year: number; field: string };

function monitoringField(value: unknown) {
  const valueKey = key(value);
  if (/\b(?:achievement|achvt|attainment|percentage|percent)\b/.test(valueKey) || valueKey.includes('%')) return 'achievement';
  if (/\b(?:goal|target)\b/.test(valueKey)) return 'target';
  if (/\b(?:actual|actuals|volume|performance)\b/.test(valueKey)) return 'actual';
  if (/^(?:level|agent level)$/.test(valueKey)) return 'level';
  return '';
}

function monthlyColumns(rows: unknown[][], year: number, fieldDetector = monitoringField, limit = 35): MonthlyColumn[] {
  const headerRows = rows.slice(0, Math.min(rows.length, limit));
  const maxColumns = Math.max(0, ...headerRows.map((row) => row.length));
  const columns: MonthlyColumn[] = [];
  for (let col = 0; col < maxColumns; col++) {
    const period = headerRows.map((row) => monthFrom(row[col])).find(Boolean);
    if (!period) continue;
    const field = headerRows.map((row) => fieldDetector(row[col])).find(Boolean);
    if (field) columns.push({ col, month: period.month, year: period.year || year, field });
  }
  return columns;
}

function parseMonitoring(rows: unknown[][], sheetName: string, detectedType: BpiWorksheetType, fallbackYear: number): SheetResult {
  const year = workbookYear(rows, fallbackYear);
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|employee name|name)$/]);
  const levelHit = findColumn(rows, [/^(?:level|agent level)$/]);
  const dateHit = findColumn(rows, [/^(?:date hired|hire date|date onboard|date on board)$/]);
  const statusHit = findColumn(rows, [/^(?:status|employment status)$/]);
  const rankHit = findColumn(rows, [/^(?:rank|ranking)$/]);
  const columns = monthlyColumns(rows, year);
  const warnings: BdoImportIssue[] = [];
  const records: BpiImportRecord[] = [];
  if (!nameHit || !columns.some((column) => column.field === 'actual' || column.field === 'target')) {
    return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'No valid agent-name and monthly Goal/Actual columns were found.' }], status: 'Skipped' };
  }
  const headerEnd = Math.max(nameHit.row, ...columns.map((column) => rows.slice(0, 35).findIndex((row) => monitoringField(row[column.col]) === column.field)));
  const evidence = campaignEvidence(rows.slice(0, Math.max(headerEnd + 1, 12)).flat(), /^pl/i.test(detectedType) ? 'PL' : 'PA');
  const monitoringType = detectedType === 'PA Agents Monitoring' ? 'PA_AGENT' : detectedType === 'PA HOH Monitoring' ? 'PA_HOH' : 'PL_HOH';
  const periods = [...new Map(columns.map((column) => [`${column.year}-${column.month}`, { year: column.year, month: column.month }])).values()];
  for (let rowIndex = headerEnd + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const name = normalizeBpiText(row[nameHit.col]);
    if (!name || SUMMARY_NAME.test(name) || /^(?:agent|agent name|full name|name)$/i.test(name)) continue;
    for (const period of periods) {
      const group = columns.filter((column) => column.year === period.year && column.month === period.month);
      const read = (field: string, percent = false) => {
        const column = group.find((item) => item.field === field);
        if (!column) return undefined;
        const parsed = parseNumeric(row[column.col], percent);
        addIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
        return parsed.value;
      };
      const target = read('target');
      const actual = read('actual');
      const suppliedAchievement = read('achievement', true);
      if (target == null && actual == null && suppliedAchievement == null) continue;
      const groupLevel = group.find((column) => column.field === 'level');
      const level = normalizeBpiText(groupLevel ? row[groupLevel.col] : levelHit ? row[levelHit.col] : '');
      const metadata = [dateHit && `Date Hired: ${normalizeBpiText(row[dateHit.col])}`, statusHit && `Status: ${normalizeBpiText(row[statusHit.col])}`, rankHit && `Rank: ${normalizeBpiText(row[rankHit.col])}`].filter(Boolean).join('; ');
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'agent_monitoring', monitoringType, entityName: name, level: level || undefined, category: evidence, product: monitoringType, metric: /^pl/i.test(detectedType) ? 'PL Performance' : 'PA Performance', month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), target, actual, achievement: achievement(target, actual, suppliedAchievement), remark: metadata || undefined });
    }
  }
  const months = [...new Set(records.map((record) => monthLabel(record.year, record.month!)))];
  return { sheetName, detectedType, records, months, warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function productivityMetric(labels: unknown[]) {
  const text = key(labels.map(normalizeBpiText).filter(Boolean).join(' '));
  const base = /transmit/.test(text) ? 'Transmitted' : /approval/.test(text) ? 'Approvals' : /booked|booking/.test(text) ? 'Booked' : '';
  if (!base) return '';
  return `${base} ${/volume|\bvol\b/.test(text) ? 'Volume' : 'Count'}`;
}

function parseProductivity(rows: unknown[][], sheetName: string, detectedType: BpiWorksheetType, fallbackYear: number): SheetResult {
  const year = workbookYear(rows, fallbackYear);
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|employee name|name)$/]);
  const dateHit = findColumn(rows, [/^(?:date hired|hire date|date onboard|date on board)$/]);
  const typeHit = findColumn(rows, [/^(?:employee type|agent type|type)$/]);
  const headerRows = rows.slice(0, 35);
  const maxColumns = Math.max(0, ...headerRows.map((row) => row.length));
  const columns = Array.from({ length: maxColumns }, (_, col) => {
    const period = headerRows.map((row) => monthFrom(row[col])).find(Boolean);
    const metric = productivityMetric(headerRows.map((row) => row[col]));
    return period && metric ? { col, month: period.month, year: period.year || year, metric } : null;
  }).filter(Boolean) as Array<{ col: number; month: number; year: number; metric: string }>;
  const records: BpiImportRecord[] = [];
  const warnings: BdoImportIssue[] = [];
  if (!nameHit || !columns.length) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'No valid PL agent and monthly productivity metric columns were found.' }], status: 'Skipped' };
  const metricHeaderRow = headerRows.map((row, index) => ({ index, count: row.filter((cell) => /transmit|approval|booked|volume|count/i.test(normalizeBpiText(cell))).length })).sort((a, b) => b.count - a.count)[0]?.index || 0;
  const headerEnd = Math.max(nameHit.row, metricHeaderRow);
  for (let rowIndex = headerEnd + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const name = normalizeBpiText(row[nameHit.col]);
    if (!name || SUMMARY_NAME.test(name) || /^(?:agent|agent name|full name|name)$/i.test(name)) continue;
    for (const column of columns) {
      const parsed = parseNumeric(row[column.col]);
      addIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
      if (parsed.value == null) continue;
      const metadata = [dateHit && `Date Hired: ${normalizeBpiText(row[dateHit.col])}`, typeHit && `Employee Type: ${normalizeBpiText(row[typeHit.col])}`, `Source Column: ${XLSX.utils.encode_col(column.col)}`].filter(Boolean).join('; ');
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'agent_monitoring', monitoringType: 'PL_PRODUCTIVITY', entityName: name, category: 'Personal Loans', product: column.metric.endsWith('Volume') ? 'Volume' : 'Count', metric: column.metric, month: column.month, year: column.year, reportDate: new Date(column.year, column.month - 1, 1), actual: parsed.value, remark: metadata });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseYtd(rows: unknown[][], sheetName: string, detectedType: BpiWorksheetType, fallbackYear: number): SheetResult {
  const year = workbookYear(rows, fallbackYear);
  const warnings: BdoImportIssue[] = [];
  const records: BpiImportRecord[] = [];
  const headerLimit = Math.min(rows.length, 35);
  const field = (value: unknown) => monitoringField(value);
  const headerRow = rows.slice(0, headerLimit).map((row, index) => ({ index, count: row.filter((cell) => ['target', 'actual', 'achievement'].includes(field(cell))).length })).sort((a, b) => b.count - a.count)[0];
  if (headerRow && headerRow.count >= 2) {
    const maxColumns = Math.max(0, ...rows.map((row) => row.length));
    const monthCandidate = Array.from({ length: maxColumns }, (_, col) => ({ col, count: rows.slice(headerRow.index + 1).filter((row) => Boolean(monthFrom(row[col]))).length })).sort((a, b) => b.count - a.count)[0];
    if (monthCandidate?.count) {
      const groups = new Map<string, { label: string; columns: Array<{ col: number; field: string }> }>();
      for (let col = 0; col < (rows[headerRow.index]?.length || 0); col++) {
        const columnField = field(rows[headerRow.index][col]);
        if (!['target', 'actual', 'achievement'].includes(columnField)) continue;
        const label = campaignEvidence(rows.slice(0, headerRow.index).map((row) => row[col]));
        if (!label) continue;
        const groupKey = canonicalCampaignName(label) || key(label);
        const group = groups.get(groupKey) || { label, columns: [] };
        group.columns.push({ col, field: columnField });
        groups.set(groupKey, group);
      }
      for (let rowIndex = headerRow.index + 1; rowIndex < rows.length; rowIndex++) {
        const period = monthFrom(rows[rowIndex]?.[monthCandidate.col]);
        if (!period) continue;
        for (const group of groups.values()) {
          const values = new Map<string, number>();
          for (const column of group.columns) {
            const parsed = parseNumeric(rows[rowIndex]?.[column.col], column.field === 'achievement');
            addIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[column.col]);
            if (parsed.value != null) values.set(column.field, parsed.value);
          }
          const target = values.get('target'); const actual = values.get('actual'); const supplied = values.get('achievement');
          if (target == null && actual == null && supplied == null) continue;
          const recordYear = period.year || year;
          records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'ytd', category: group.label, product: group.label, metric: 'YTD Performance', month: period.month, year: recordYear, reportDate: new Date(recordYear, period.month - 1, 1), target, actual: actualFromAchievement(target, actual, supplied), achievement: achievement(target, actual, supplied) });
        }
      }
    }
  }
  if (!records.length) {
    let activeCampaign = '';
    let columns: { target?: number; actual?: number; achievement?: number; month?: number } = {};
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const evidence = campaignEvidence(row);
      if (evidence && canonicalCampaignName(evidence)) activeCampaign = evidence;
      const rowFields = row.map((cell, col) => ({ col, field: field(cell) })).filter((item) => item.field);
      const monthCol = row.findIndex((cell) => /^(?:month|period|report month)$/i.test(normalizeBpiText(cell)));
      if (rowFields.length >= 2 && monthCol >= 0) {
        columns = { month: monthCol };
        for (const item of rowFields) (columns as any)[item.field] = item.col;
        continue;
      }
      if (!activeCampaign || columns.month == null) continue;
      const period = monthFrom(row[columns.month]);
      if (!period) continue;
      const read = (col: number | undefined, percent = false) => col == null ? undefined : parseNumeric(row[col], percent).value;
      const target = read(columns.target); const actual = read(columns.actual); const supplied = read(columns.achievement, true);
      if (target == null && actual == null && supplied == null) continue;
      const recordYear = period.year || year;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'ytd', category: activeCampaign, product: activeCampaign, metric: 'YTD Performance', month: period.month, year: recordYear, reportDate: new Date(recordYear, period.month - 1, 1), target, actual: actualFromAchievement(target, actual, supplied), achievement: achievement(target, actual, supplied) });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings: records.length ? warnings : [{ worksheet: sheetName, message: 'No campaign sections with populated monthly YTD data were found.' }], status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseManpower(rows: unknown[][], sheetName: string, detectedType: BpiWorksheetType, fallbackYear: number): SheetResult {
  const year = workbookYear(rows, fallbackYear);
  const particular = findColumn(rows, [/^(?:particular|particulars|description|metric|manpower metric)$/]);
  const records: BpiImportRecord[] = [];
  const warnings: BdoImportIssue[] = [];
  if (!particular) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'A manpower Particulars column was not found.' }], status: 'Skipped' };
  const headerWindow = rows.slice(Math.max(0, particular.row - 3), Math.min(rows.length, particular.row + 3));
  const maxColumns = Math.max(0, ...headerWindow.map((row) => row.length));
  const periods = Array.from({ length: maxColumns }, (_, col) => {
    const period = headerWindow.map((row) => monthFrom(row[col])).find(Boolean);
    return period ? { col, month: period.month, year: period.year || year } : null;
  }).filter(Boolean) as Array<{ col: number; month: number; year: number }>;
  for (let rowIndex = particular.row + 1; rowIndex < rows.length; rowIndex++) {
    const metric = normalizeBpiText(rows[rowIndex]?.[particular.col]);
    if (!metric || SUMMARY_NAME.test(metric)) continue;
    for (const period of periods) {
      const parsed = parseNumeric(rows[rowIndex]?.[period.col], /percentage|rate|turnover/i.test(metric));
      addIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[period.col]);
      if (parsed.value == null) continue;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'manpower', category: 'BPI Overall', product: 'Manpower', metric, month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), numericValue: parsed.value });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

export function parseBpiDashboardWorkbook(workbook: XLSX.WorkBook, fallbackDate: Date) {
  const sheets: SheetResult[] = workbook.SheetNames.map((sheetName) => {
    const detectedType = detectBpiWorksheet(sheetName);
    if (!detectedType) return { sheetName, detectedType: 'Unsupported', records: [], months: [], warnings: [{ worksheet: sheetName, message: 'Unsupported worksheet skipped.' }], status: 'Skipped' };
    const rows = rowsWithMergedCells(workbook.Sheets[sheetName]);
    if (detectedType === 'YTD Performance') return parseYtd(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'Manpower Monitoring') return parseManpower(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'PL YTD Productivity') return parseProductivity(rows, sheetName, detectedType, fallbackDate.getFullYear());
    return parseMonitoring(rows, sheetName, detectedType, fallbackDate.getFullYear());
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
    teamLeaders: [] as string[],
  };
}
