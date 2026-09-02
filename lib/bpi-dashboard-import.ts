import * as XLSX from 'xlsx';
import { canonicalCampaignName } from './campaign-import-mapping';
import type { BdoImportIssue, BdoImportRecord } from './bdo-dashboard-import';

export const BPI_WORKSHEETS = {
  'ytd performance': 'YTD Performance',
  'manpower monitoring': 'Manpower Monitoring',
  'pa agents monitoring': 'PA Agents Monitoring',
  'sip loans scorecard': 'SIP LOANS SCORECARD',
  'pl ytd productivity': 'PL YTD Productivity',
  'pl scorecard 2026': 'PL SCORECARD 2026',
  'pa hoh monitoring': 'PA HOH Monitoring',
  'pl hoh monitoring': 'PL HOH Monitoring',
} as const;

export type BpiWorksheetType = typeof BPI_WORKSHEETS[keyof typeof BPI_WORKSHEETS];
export type BpiStandaloneWorksheetType = 'PA Inbound YTD Productivity' | 'PL Monthly Productivity';
export type BpiImportRecord = BdoImportRecord;

export function bpiImportRecordIdentity(record: Pick<BpiImportRecord, 'worksheetSource' | 'recordKind' | 'entityName' | 'category' | 'product' | 'metric' | 'year' | 'month'>) {
  return [
    record.worksheetSource,
    record.recordKind,
    record.entityName || '',
    record.category || '',
    record.product || '',
    record.metric,
    record.year,
    record.month || 0,
  ].map((value) => key(value)).join('|');
}

type SheetResult = {
  sheetName: string;
  detectedType: BpiWorksheetType | BpiStandaloneWorksheetType | 'Unsupported';
  records: BpiImportRecord[];
  months: string[];
  warnings: BdoImportIssue[];
  status: 'Ready' | 'Skipped' | 'Warning';
  excluded?: boolean;
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// BPI productivity workbooks use OLD / SEMI OLD / NEW as tenure buckets and
// place their aggregate totals in the agent-name column. They are headings,
// not collectors, so never normalize them into agent monitoring records.
const SUMMARY_NAME = /^(?:total|grand total|average|avg|summary|summary[\s-]*average[\s-]*per[\s-]*agent|ranking|rank|team total|overall|notes?|remarks?|old|semi[\s-]*old|new|(?:old|semi[\s-]*old|new|total)[\s-]*average[\s-]*per[\s-]*agent)$/i;
const INVALID_NUMBER = /^#(?:div\/0!|value!|n\/a|ref!|num!|name\?|null!)$/i;

export function normalizeBpiText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function key(value: unknown) {
  return normalizeBpiText(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function detectBpiWorksheet(name: string): BpiWorksheetType | null {
  const normalized = key(name);
  if (/^pl scorecard(?: 20\d{2})?$/.test(normalized)) return 'PL SCORECARD 2026';
  return BPI_WORKSHEETS[normalized as keyof typeof BPI_WORKSHEETS] || null;
}

type BpiStandaloneKind = 'pa_inbound' | 'pl' | null;

function standaloneKindFromFileName(sourceFileName = ''): BpiStandaloneKind {
  const canonical = canonicalCampaignName(sourceFileName);
  if (canonical === 'BPI PA INBOUND' || /\binbound\b/i.test(sourceFileName)) return 'pa_inbound';
  if (canonical === 'BPI PL' || /\bpersonal[\s_-]*loans?\b/i.test(sourceFileName)) return 'pl';
  return null;
}

function isPaInboundProductivityRows(rows: unknown[][]) {
  const headerText = rows.slice(0, 12).flat().map(normalizeBpiText).join(' ');
  return /\bagent\b/i.test(headerText) && /\btransmittal\b/i.test(headerText) && /\bbooked volume\b/i.test(headerText);
}

function isPlProductivityRows(rows: unknown[][]) {
  const headerText = rows.slice(0, 12).flat().map(normalizeBpiText).join(' ');
  return /\bname\b/i.test(headerText) && /\btransmitted\b/i.test(headerText) &&
    /\bapprovals\b/i.test(headerText) && /\bbooked\b/i.test(headerText) &&
    /\bcount\b/i.test(headerText) && /\bvolume\b/i.test(headerText);
}

export function isBpiDashboardWorkbook(workbook: XLSX.WorkBook, sourceFileName = '') {
  const hasDashboardWorksheet = workbook.SheetNames.some((name) => {
    const detected = detectBpiWorksheet(name);
    return detected && !['YTD Performance', 'Manpower Monitoring'].includes(detected);
  });
  if (hasDashboardWorksheet) return true;

  const standaloneKind = standaloneKindFromFileName(sourceFileName);
  if (!standaloneKind) return false;
  return workbook.SheetNames.some((name) => {
    const rows = rowsWithMergedCells(workbook.Sheets[name]);
    return standaloneKind === 'pa_inbound' ? isPaInboundProductivityRows(rows) : isPlProductivityRows(rows);
  });
}

function rowsWithMergedCells(sheet: XLSX.WorkSheet): unknown[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const origin = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s : { r: 0, c: 0 };
  for (const range of sheet['!merges'] || []) {
    const startRow = range.s.r - origin.r;
    const endRow = range.e.r - origin.r;
    const startCol = range.s.c - origin.c;
    const endCol = range.e.c - origin.c;
    if (startRow < 0 || startCol < 0) continue;
    const value = rows[startRow]?.[startCol];
    if (value == null || value === '') continue;
    for (let row = startRow; row <= endRow; row++) {
      rows[row] ||= [];
      for (let col = startCol; col <= endCol; col++) {
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
  // Only inspect the worksheet header. Agent-monitoring sheets contain dates
  // hired in their data rows; treating one of those as the workbook year can
  // silently move an entire report into the employee's hiring year.
  for (const value of rows.slice(0, 4).flat()) {
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
  const cleaned = text
    .replace(/[₱$€£,%\s]/g, '')
    .replace(/\(([^)]+)\)/, '-$1')
    .replace(/(?<=\d)(?:st|nd|rd|th)$/i, '');
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
  // In the standard BPI dashboard, PA Agents/HOH Monitoring is the outbound
  // roster. PA inbound has its own YTD productivity worksheet. Use explicit
  // campaign evidence so these agent rows are not left as ambiguous "PA".
  const evidence = detectedType === 'PA Agents Monitoring' || detectedType === 'PA HOH Monitoring'
    ? 'PA SIP LOANS OUTBOUND'
    : campaignEvidence(rows.slice(0, Math.max(headerEnd + 1, 12)).flat(), /^pl/i.test(detectedType) ? 'PL' : 'PA');
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

function normalizeAgentType(value: unknown) {
  const normalized = key(value);
  if (/^semi old$/.test(normalized)) return 'SEMI OLD';
  if (/^old$/.test(normalized)) return 'OLD';
  if (/^new$/.test(normalized)) return 'NEW';
  return normalizeBpiText(value).toUpperCase();
}

function productivityTargetsByType(rows: unknown[][]) {
  const targets = new Map<string, number>();
  let targetColumn = -1;
  let targetHeaderRow = -1;
  for (let row = 0; row < rows.length; row++) {
    const col = (rows[row] || []).findIndex((cell) => /^plan volume per agent$/i.test(normalizeBpiText(cell)));
    if (col >= 0) {
      targetColumn = col;
      targetHeaderRow = row;
      break;
    }
  }
  if (targetColumn < 0) return targets;
  for (let row = targetHeaderRow + 1; row < rows.length; row++) {
    const type = (rows[row] || []).map(normalizeAgentType).find((value) => /^(?:OLD|SEMI OLD|NEW)$/.test(value));
    if (!type) continue;
    const parsed = parseNumeric(rows[row]?.[targetColumn]);
    if (parsed.value != null && parsed.value > 0) targets.set(type, parsed.value);
  }
  return targets;
}

function parseProductivity(
  rows: unknown[][],
  sheetName: string,
  detectedType: BpiWorksheetType | BpiStandaloneWorksheetType,
  fallbackYear: number,
  targetsByType = new Map<string, number>(),
): SheetResult {
  const year = workbookYear(rows, fallbackYear);
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|employee name|name)$/]);
  const dateHit = findColumn(rows, [/^(?:date hired|hire date|date onboard|date on board)$/]);
  const typeHit = findColumn(rows, [/^(?:employee type|agent type|type)$/]);
  const headerRows = rows.slice(0, 35);
  const maxColumns = Math.max(0, ...headerRows.map((row) => row.length));
  const columnCandidates = Array.from({ length: maxColumns }, (_, col) => {
    const period = headerRows.map((row) => monthFrom(row[col])).find(Boolean);
    const labels = headerRows.map((row) => row[col]);
    return period ? {
      col,
      month: period.month,
      year: period.year || year,
      labels,
      metric: productivityMetric(labels),
    } : null;
  }).filter(Boolean) as Array<{
    col: number;
    month: number;
    year: number;
    labels: unknown[];
    metric: string;
  }>;
  const columns = columnCandidates.map((candidate, index) => {
    if (candidate.metric) return candidate;

    // Some BPI PL workbooks merge TRANSMITTED / APPROVALS / BOOKED over only
    // the Count cell. The paired cell is labelled just VOLUME, so infer its
    // metric from the immediately preceding Count column in the same month.
    const isVolumeColumn = candidate.labels.some((label) => /\b(?:volume|vol)\b/i.test(normalizeBpiText(label)));
    if (!isVolumeColumn) return null;
    const pairedCount = [...columnCandidates.slice(0, index)].reverse().find((previous) =>
      previous.year === candidate.year &&
      previous.month === candidate.month &&
      previous.col === candidate.col - 1 &&
      previous.metric.endsWith(' Count')
    );
    if (!pairedCount) return null;
    return { ...candidate, metric: pairedCount.metric.replace(/ Count$/, ' Volume') };
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
    const agentType = normalizeAgentType(typeHit ? row[typeHit.col] : '');
    for (const column of columns) {
      const parsed = parseNumeric(row[column.col]);
      addIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
      if (parsed.value == null) continue;
      const metadata = [dateHit && `Date Hired: ${normalizeBpiText(row[dateHit.col])}`, typeHit && `Employee Type: ${normalizeBpiText(row[typeHit.col])}`, `Source Column: ${XLSX.utils.encode_col(column.col)}`].filter(Boolean).join('; ');
      const target = column.metric === 'Booked Volume' ? targetsByType.get(agentType) : undefined;
      records.push({
        worksheetSource: sheetName,
        sourceRow: rowIndex + 1,
        recordKind: 'agent_monitoring',
        monitoringType: 'PL_PRODUCTIVITY',
        entityName: name,
        level: agentType || undefined,
        category: 'Personal Loans',
        product: column.metric.endsWith('Volume') ? 'Volume' : 'Count',
        metric: column.metric,
        month: column.month,
        year: column.year,
        reportDate: new Date(column.year, column.month - 1, 1),
        target,
        actual: parsed.value,
        achievement: target ? parsed.value / target : undefined,
        remark: metadata,
      });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

type ScorecardColumn = {
  col: number;
  month: number;
  year: number;
  metric: string;
  field: 'target' | 'actual' | 'achievement';
};

function scorecardColumn(labels: unknown[]): Pick<ScorecardColumn, 'metric' | 'field'> | null {
  const text = key(labels.map(normalizeBpiText).filter(Boolean).join(' '));
  const stage = /transmit/.test(text)
    ? 'Transmitted'
    : /approval/.test(text)
      ? 'Approvals'
      : /booked|booking/.test(text)
        ? 'Booked'
        : '';
  const isVolume = /\b(?:volume|vol)\b/.test(text);
  const isCount = /\b(?:count|cnt|transaction|transactions|txn)\b/.test(text);
  const isAchievement = /\b(?:achievement|achvt|attainment|percentage|percent)\b/.test(text) || text.includes('%');
  const isTarget = /\b(?:target|goal|plan)\b/.test(text);
  const isRanking = /\b(?:rank|ranking)\b/.test(text);
  const isScore = /\bscore\b/.test(text) && !/scorecard/.test(text);
  const isActual = /\b(?:actual|actuals|performance|mtd)\b/.test(text);

  let metric = '';
  if (stage) metric = `${stage} ${isVolume ? 'Volume' : 'Count'}`;
  else if (isRanking) metric = 'Ranking';
  else if (isScore) metric = 'Score';
  else if (isVolume) metric = 'Volume';
  else if (isCount) metric = 'Count';
  else if (isTarget || isActual || isAchievement) metric = 'Scorecard Performance';
  if (!metric) return null;

  const field = isAchievement ? 'achievement' : isTarget && !isActual ? 'target' : 'actual';
  return { metric, field };
}

function parseScorecard(
  rows: unknown[][],
  sheetName: string,
  detectedType: Extract<BpiWorksheetType, 'SIP LOANS SCORECARD' | 'PL SCORECARD 2026'>,
  fallbackYear: number,
): SheetResult {
  const year = workbookYear(rows, fallbackYear);
  const warnings: BdoImportIssue[] = [];
  const records: BpiImportRecord[] = [];
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|employee name|name)$/]);
  if (!nameHit) {
    return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'No valid agent-name column was found in the scorecard.' }], status: 'Skipped' };
  }

  const idHit = findColumn(rows, [/^(?:agent id|employee id|employee number|employee no|agent code|employee code)$/]);
  const headerRows = rows.slice(0, Math.min(rows.length, Math.max(nameHit.row + 2, 12)));
  const maxColumns = Math.max(0, ...headerRows.map((row) => row.length));
  const columns = Array.from({ length: maxColumns }, (_, col) => {
    const period = headerRows.map((row) => monthFrom(row[col])).find(Boolean);
    const descriptor = scorecardColumn(headerRows.map((row) => row[col]));
    return period && descriptor ? { col, month: period.month, year: period.year || year, ...descriptor } : null;
  }).filter(Boolean) as ScorecardColumn[];

  if (!columns.length) {
    return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'No dynamic month/metric scorecard columns were found.' }], status: 'Skipped' };
  }

  const campaignCategory = detectedType === 'SIP LOANS SCORECARD' ? 'PA SIP Loans Outbound' : 'Personal Loans';
  const monitoringType = detectedType === 'SIP LOANS SCORECARD' ? 'SIP_LOANS_SCORECARD' : 'PL_SCORECARD';
  const groups = [...new Map(columns.map((column) => [
    `${column.year}|${column.month}|${column.metric}`,
    { year: column.year, month: column.month, metric: column.metric },
  ])).values()];
  let skippedSummaryRows = 0;

  for (let rowIndex = nameHit.row + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const name = normalizeBpiText(row[nameHit.col]);
    if (!name || /^(?:agent|agent name|full name|employee name|name)$/i.test(name)) continue;
    if (SUMMARY_NAME.test(name)) {
      skippedSummaryRows++;
      continue;
    }
    const agentIdentifier = idHit ? normalizeBpiText(row[idHit.col]) : '';

    for (const group of groups) {
      const groupColumns = columns.filter((column) => column.year === group.year && column.month === group.month && column.metric === group.metric);
      const values = new Map<ScorecardColumn['field'], number>();
      const sourceColumns: string[] = [];
      for (const column of groupColumns) {
        const parsed = parseNumeric(row[column.col], column.field === 'achievement');
        addIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
        if (parsed.value == null) continue;
        values.set(column.field, parsed.value);
        sourceColumns.push(XLSX.utils.encode_col(column.col));
      }
      const target = values.get('target');
      const actual = values.get('actual');
      const suppliedAchievement = values.get('achievement');
      if (target == null && actual == null && suppliedAchievement == null) continue;
      const calculatedAchievement = target === 0
        ? undefined
        : achievement(target, actual, suppliedAchievement);
      records.push({
        worksheetSource: sheetName,
        sourceRow: rowIndex + 1,
        recordKind: 'agent_monitoring',
        monitoringType,
        entityName: name,
        category: campaignCategory,
        product: 'Scorecard',
        metric: group.metric,
        month: group.month,
        year: group.year,
        reportDate: new Date(group.year, group.month - 1, 1),
        target,
        actual,
        achievement: calculatedAchievement,
        remark: [agentIdentifier && `Agent ID: ${agentIdentifier}`, sourceColumns.length && `Source Columns: ${sourceColumns.join(', ')}`].filter(Boolean).join('; ') || undefined,
      });
    }
  }

  if (skippedSummaryRows > 0) {
    warnings.push({ worksheet: sheetName, message: `Skipped ${skippedSummaryRows} summary/total row${skippedSummaryRows === 1 ? '' : 's'}; dashboard totals are calculated from normalized monthly agent records.` });
  }
  return {
    sheetName,
    detectedType,
    records,
    months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))],
    warnings,
    status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped',
  };
}

function inboundGoalsByMonth(rows: unknown[][]) {
  const goals = new Map<number, number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const monthColumn = row.findIndex((cell) => /^month$/i.test(normalizeBpiText(cell)));
    const goalColumn = row.findIndex((cell) => /^(?:goal|target)$/i.test(normalizeBpiText(cell)));
    if (monthColumn < 0 || goalColumn < 0) continue;
    for (let row = rowIndex + 1; row < rows.length; row++) {
      const period = monthFrom(rows[row]?.[monthColumn]);
      if (!period) continue;
      const parsed = parseNumeric(rows[row]?.[goalColumn]);
      if (parsed.value != null && parsed.value > 0) goals.set(period.month, parsed.value);
    }
    break;
  }
  return goals;
}

function parsePaInboundProductivity(
  rows: unknown[][],
  sheetName: string,
  fallbackYear: number,
): SheetResult {
  const detectedType: BpiStandaloneWorksheetType = 'PA Inbound YTD Productivity';
  const year = workbookYear(rows, fallbackYear);
  const warnings: BdoImportIssue[] = [];
  const records: BpiImportRecord[] = [];
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|employee name|name)$/]);
  if (!nameHit) {
    return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'An agent-name column was not found in the BPI PA Inbound worksheet.' }], status: 'Skipped' };
  }

  const headerRows = rows.slice(0, Math.min(rows.length, nameHit.row + 1));
  const maxColumns = Math.max(0, ...headerRows.map((row) => row.length));
  const columns = Array.from({ length: maxColumns }, (_, col) => {
    const period = headerRows.map((row) => monthFrom(row[col])).find(Boolean);
    const metric = productivityMetric(headerRows.map((row) => row[col]));
    return period && metric ? { col, month: period.month, year: period.year || year, metric } : null;
  }).filter(Boolean) as Array<{ col: number; month: number; year: number; metric: string }>;
  const goals = inboundGoalsByMonth(rows);

  if (!columns.length) {
    return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'Monthly Transmittal and Booked Volume columns were not found.' }], status: 'Skipped' };
  }

  for (let rowIndex = nameHit.row + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const name = normalizeBpiText(row[nameHit.col]);
    if (!name || SUMMARY_NAME.test(name) || /^(?:agent|agent name|full name|name)$/i.test(name)) continue;
    for (const column of columns) {
      const parsed = parseNumeric(row[column.col]);
      addIssue(warnings, sheetName, rowIndex + 1, parsed, row[column.col]);
      if (parsed.value == null) continue;
      records.push({
        worksheetSource: sheetName,
        sourceRow: rowIndex + 1,
        recordKind: 'agent_monitoring',
        monitoringType: 'PA_INBOUND_PRODUCTIVITY',
        entityName: name,
        category: 'PA SIP Loans Inbound',
        product: column.metric.endsWith('Volume') ? 'Volume' : 'Count',
        metric: column.metric,
        month: column.month,
        year: column.year,
        reportDate: new Date(column.year, column.month - 1, 1),
        actual: parsed.value,
        remark: `Source Column: ${XLSX.utils.encode_col(column.col)}`,
      });
    }
  }
  // The MONTH / GOAL table is a campaign-level target. Persist it once per
  // reporting period instead of copying it to every agent production row.
  // This prevents the campaign goal from being multiplied by agent count.
  for (const [month, target] of goals) {
    records.push({
      worksheetSource: sheetName,
      sourceRow: 0,
      recordKind: 'ytd',
      entityName: 'BPI PA INBOUND',
      category: 'PA SIP Loans Inbound',
      product: 'Volume',
      metric: 'Booked Volume',
      month,
      year,
      reportDate: new Date(year, month - 1, 1),
      target,
      remark: 'Campaign goal from MONTH / GOAL table',
    });
  }
  if (!goals.size) warnings.push({ worksheet: sheetName, message: 'No MONTH / GOAL table was found; productivity was imported without agent targets.' });
  return {
    sheetName,
    detectedType,
    records,
    months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))],
    warnings,
    status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped',
  };
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

export function parseBpiDashboardWorkbook(workbook: XLSX.WorkBook, fallbackDate: Date, sourceFileName = '') {
  const standaloneKind = standaloneKindFromFileName(sourceFileName);
  const rowsBySheet = new Map(workbook.SheetNames.map((sheetName) => [sheetName, rowsWithMergedCells(workbook.Sheets[sheetName])]));
  const standalonePlSheets = standaloneKind === 'pl'
    ? workbook.SheetNames.filter((sheetName) => isPlProductivityRows(rowsBySheet.get(sheetName) || []))
    : [];
  const standalonePlMonthlySheets = standalonePlSheets.filter((sheetName) => Boolean(monthFrom(sheetName)));
  const plTargets = standaloneKind === 'pl'
    ? workbook.SheetNames.reduce((targets, sheetName) => {
        for (const [type, goal] of productivityTargetsByType(rowsBySheet.get(sheetName) || [])) targets.set(type, goal);
        return targets;
      }, new Map<string, number>())
    : new Map<string, number>();

  const sheets: SheetResult[] = workbook.SheetNames.map((sheetName) => {
    const detectedType = detectBpiWorksheet(sheetName);
    const rows = rowsBySheet.get(sheetName) || [];
    if (!detectedType && standaloneKind === 'pa_inbound' && isPaInboundProductivityRows(rows)) {
      return parsePaInboundProductivity(rows, sheetName, fallbackDate.getFullYear());
    }
    if (!detectedType && standaloneKind === 'pl' && isPlProductivityRows(rows)) {
      if (standalonePlMonthlySheets.length && !monthFrom(sheetName)) {
        return { sheetName, detectedType: 'PL Monthly Productivity', records: [], months: [], warnings: [{ worksheet: sheetName, message: 'Aggregate productivity sheet skipped because monthly worksheets are available.' }], status: 'Skipped' };
      }
      return parseProductivity(rows, sheetName, 'PL Monthly Productivity', fallbackDate.getFullYear(), plTargets);
    }
    if (!detectedType) return { sheetName, detectedType: 'Unsupported', records: [], months: [], warnings: [{ worksheet: sheetName, message: 'Unsupported worksheet skipped.' }], status: 'Skipped' };
    if (detectedType === 'YTD Performance') return parseYtd(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'Manpower Monitoring') return parseManpower(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'PL YTD Productivity') {
      return parseProductivity(rows, sheetName, detectedType, fallbackDate.getFullYear(), productivityTargetsByType(rows));
    }
    if (detectedType === 'SIP LOANS SCORECARD' || detectedType === 'PL SCORECARD 2026') {
      return parseScorecard(rows, sheetName, detectedType, fallbackDate.getFullYear());
    }
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
