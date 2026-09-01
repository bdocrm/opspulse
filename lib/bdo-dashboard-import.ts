import * as XLSX from 'xlsx';

export const BDO_WORKSHEETS = {
  'ytd performance': 'YTD Performance',
  'manpower monitoring': 'Manpower Monitoring',
  'ci agents monitoring': 'CI Agents Monitoring',
  'ci scorecard': 'CI SCORECARD',
  'cross sell agents monitoring': 'Cross Sell Agents Monitoring',
  'tls scorecard': 'TLs Scorecard',
  'ci hoh monitoring': 'CI HOH Monitoring',
  'cross sell hoh monitoring': 'CROSS SELL HOH Monitoring',
} as const;

export type BdoWorksheetType = typeof BDO_WORKSHEETS[keyof typeof BDO_WORKSHEETS];
export type BdoRecordKind = 'ytd' | 'manpower' | 'agent_monitoring' | 'scorecard' | 'team_leader';

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
  dateHired?: Date;
  dataStatus?: string;
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
const INVALID_NUMBER = /^#(?:div\/0!|value!|n\/a|ref!|num!|name\?|null!)$/i;
const EMPTY_NUMBER_MARKER = /^(?:no\s+final\s+report.*|sl|sick\s+leave|on\s+leave|leave|n\/a|na|not\s+available|-|—|–)$/i;
const SUMMARY_NAME = /^(?:total|grand total|average|avg|summary|ranking|rank|team total|overall)$/i;

export function normalizeBdoText(value: unknown) {
  return String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedKey(value: unknown) {
  return normalizeBdoText(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function detectBdoWorksheet(name: string): BdoWorksheetType | null {
  return BDO_WORKSHEETS[normalizedKey(name) as keyof typeof BDO_WORKSHEETS] || null;
}

export function isBdoDashboardWorkbook(workbook: XLSX.WorkBook) {
  const detected = workbook.SheetNames.map(detectBdoWorksheet).filter(Boolean);
  const hasCoreSheet = detected.some((name) => /(?:Agents Monitoring|HOH Monitoring|CI SCORECARD|YTD Performance)/i.test(name!));
  if (!hasCoreSheet) return false;
  if (detected.length >= 2) return true;
  const sheetName = workbook.SheetNames.find((name) => detectBdoWorksheet(name));
  if (!sheetName) return false;
  const signature = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' })
    .slice(0, 15).flat().map(normalizedKey).filter(Boolean);
  const hasMonth = signature.some((value) => Boolean(monthFrom(value)));
  const hasMetric = signature.some((value) => /^(?:goal|target|actual|actuals|achievement|achvt|average)$/.test(value));
  const hasEntity = signature.some((value) => /^(?:agent|agent name|name|month|date hired)$/.test(value));
  return hasMonth && hasMetric && hasEntity;
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
  if (EMPTY_NUMBER_MARKER.test(text)) return { remark: text };
  if (INVALID_NUMBER.test(text)) return { issue: `Invalid numeric cell: ${text}`, remark: text };
  const percent = text.includes('%');
  const suffix = text.match(/([KMB])\s*%?$/i)?.[1]?.toUpperCase();
  const cleaned = text.replace(/[₱$€£,%\s]/g, '').replace(/[KMB]$/i, '').replace(/\(([^)]+)\)/, '-$1');
  if (!/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(cleaned)) return { issue: `Text value skipped: ${text}`, remark: text };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { issue: `Invalid numeric cell: ${text}`, remark: text };
  const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
  const numeric = parsed * multiplier;
  return { value: percent || (percentage && Math.abs(numeric) > 2) ? numeric / 100 : numeric };
}

function combinedRemark(values: Iterable<ReturnType<typeof parseNumeric>>) {
  return [...new Set([...values].map((value) => value.remark).filter(Boolean) as string[])].join('; ') || undefined;
}

function calculatedAchievement(target?: number, actual?: number, supplied?: number) {
  if (supplied != null) return supplied;
  return target != null && target > 0 && actual != null ? actual / target : undefined;
}

function combinedStatus(values: Iterable<ReturnType<typeof parseNumeric>>) {
  const parsed = [...values];
  if (parsed.some((value) => value.issue)) return 'invalid';
  const remarks = parsed.map((value) => value.remark || '');
  if (remarks.some((remark) => /^no\s+final\s+report/i.test(remark))) return 'no_final_report';
  if (remarks.some(Boolean)) return 'special_status';
  return undefined;
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
    // Employee hire dates and other row-level dates must not become the report year.
    if (value instanceof Date) continue;
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
  else if (parsed.remark) issues.push({ worksheet, row, message: `Status value preserved: ${parsed.remark}`, rawValue: normalizeBdoText(raw).slice(0, 250) });
}

function parseAgentMonitoring(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const year = workbookYear(rows, fallbackYear);
  const isCrossSell = /cross sell/i.test(detectedType);
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|name)$/]) || (isCrossSell ? { row: 0, col: 0 } : null);
  const levelHit = findColumn(rows, [/^level$/, /^agent level$/]);
  const productHit = findColumn(rows, [/^(?:product|product type|metric type)$/]);
  const columns = detectGroupedColumns(rows, year);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  if (!nameHit || !columns.length) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'The worksheet was detected, but no valid monthly agent columns were found.' }], status: 'Skipped' };
  const monitoringType = /hoh/i.test(detectedType) ? (isCrossSell ? 'CROSS_SELL_HOH' : 'CI_HOH') : (isCrossSell ? 'CROSS_SELL_AGENT' : 'CI_AGENT');
  const fieldHeaderRow = rows.slice(0, 30).map((row, rowIndex) => ({ rowIndex, fields: row.map(fieldAlias).filter(Boolean).length })).sort((a, b) => b.fields - a.fields)[0]?.rowIndex ?? nameHit.row;
  const dataStart = Math.max(nameHit.row, fieldHeaderRow) + 1;
  const periods = [...new Map(columns.map((column) => [`${column.year}-${column.month}`, { year: column.year, month: column.month }])).values()];
  let activeName = '';
  const headerProduct = normalizeBdoText(rows[fieldHeaderRow]?.[nameHit.col]);
  let activeProduct = isCrossSell && /^(?:virtual(?: card)?|nth card|supple(?: invi)?|supplementary|cash installment)$/i.test(headerProduct) ? headerProduct : '';
  for (let rowIndex = dataStart; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const rowName = normalizeBdoText(row[nameHit.col]);
    if (isCrossSell && /^(?:virtual(?: card)?|nth card|supple(?: invi)?|supplementary|cash installment)$/i.test(rowName)) {
      activeProduct = rowName;
      activeName = '';
      continue;
    }
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
      const suppliedAchievement = values.get('achievement')?.value;
      const remark = combinedRemark(values.values());
      if (target == null && actual == null && suppliedAchievement == null && !remark) continue;
      const product = (productHit ? normalizeBdoText(row[productHit.col]) : '') || activeProduct || group.map((column) => column.product).find(Boolean);
      const groupLevel = group.find((column) => column.field === 'level');
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'agent_monitoring', monitoringType, entityName: name, level: groupLevel ? normalizeBdoText(row[groupLevel.col]) : levelHit ? normalizeBdoText(row[levelHit.col]) : undefined, product, metric: product || (isCrossSell ? 'Cross Sell' : 'Cash Installment'), month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), target, actual, achievement: calculatedAchievement(target, actual, suppliedAchievement), dataStatus: combinedStatus(values.values()), remark });
    }
  }
  return { sheetName, detectedType, records, months: periods.filter((period) => records.some((record) => record.month === period.month && record.year === period.year)).map((period) => monthLabel(period.year, period.month)), warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseExcelDate(value: unknown): Date | undefined {
  let parsed: Date | undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) parsed = new Date(value);
  else if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) parsed = new Date(parts.y, parts.m - 1, parts.d);
  } else {
    const text = normalizeBdoText(value);
    if (text) {
      const time = Date.parse(text);
      if (!Number.isNaN(time)) parsed = new Date(time);
    }
  }
  if (!parsed || parsed.getFullYear() < 1950 || parsed.getFullYear() > 2100) return undefined;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function parseCiScorecard(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  const year = workbookYear(rows, fallbackYear);
  const dateHit = findColumn(rows, [/^date hired$/, /^hire date$/]);
  const averageHit = findColumn(rows, [/^average$/, /^avg$/]);
  if (!dateHit || !averageHit) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'CI SCORECARD headers (Date Hired and Average) were not found.' }], status: 'Skipped' };
  const headerRow = Math.max(dateHit.row, averageHit.row);
  const nameHit = findColumn(rows, [/^(?:agent|agent name|full name|name)$/], headerRow + 1) || { row: headerRow, col: Math.max(0, dateHit.col - 1) };
  const monthColumns = (rows[headerRow] || []).flatMap((cell, col) => {
    const period = monthFrom(cell);
    return period ? [{ col, month: period.month, year: period.year || year }] : [];
  });
  if (!monthColumns.length) return { sheetName, detectedType, records, months: [], warnings: [{ worksheet: sheetName, message: 'CI SCORECARD has no recognizable monthly columns.' }], status: 'Skipped' };
  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const entityName = normalizeBdoText(row[nameHit.col]);
    if (!entityName || SUMMARY_NAME.test(entityName)) continue;
    const dateHired = parseExcelDate(row[dateHit.col]);
    if (normalizeBdoText(row[dateHit.col]) && !dateHired) warnings.push({ worksheet: sheetName, row: rowIndex + 1, message: 'Invalid Date Hired value preserved for review.', rawValue: normalizeBdoText(row[dateHit.col]) });
    const average = parseNumeric(row[averageHit.col], true);
    addNumericIssue(warnings, sheetName, rowIndex + 1, average, row[averageHit.col]);
    if (average.value != null || average.remark) records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'scorecard', monitoringType: 'CI_SCORECARD', entityName, category: 'Cash Installment', product: 'Cash Installment', metric: 'CI Scorecard Average', month: 0, year, reportDate: new Date(year, 0, 1), actual: average.value, numericValue: average.value, dateHired, dataStatus: combinedStatus([average]), remark: average.remark });
    for (const period of monthColumns) {
      const score = parseNumeric(row[period.col], true);
      addNumericIssue(warnings, sheetName, rowIndex + 1, score, row[period.col]);
      if (score.value == null && !score.remark) continue;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'scorecard', monitoringType: 'CI_SCORECARD', entityName, category: 'Cash Installment', product: 'Cash Installment', metric: 'CI Scorecard', month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), actual: score.value, numericValue: score.value, dateHired, dataStatus: combinedStatus([score]), remark: score.remark });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.filter((record) => (record.month || 0) > 0).map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseManpower(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number, sectionProducts: string[] = []): BdoSheetResult {
  const year = workbookYear(rows, fallbackYear);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  const months: string[] = [];
  const headerRows = rows.flatMap((row, rowIndex) => row.flatMap((cell, col) => /^(?:particular|particulars|description|metric|manpower metric)$/.test(normalizedKey(cell)) ? [{ row: rowIndex, col }] : []));
  if (!headerRows.length) return { sheetName, detectedType, records, months, warnings: [{ worksheet: sheetName, message: 'The worksheet was detected, but a Particulars column was not found.' }], status: 'Skipped' };
  const mappedSectionProducts = headerRows.length === sectionProducts.length ? sectionProducts : [];
  for (let sectionIndex = 0; sectionIndex < headerRows.length; sectionIndex++) {
    const particularHit = headerRows[sectionIndex];
    const nextHeaderRow = headerRows[sectionIndex + 1]?.row ?? rows.length;
    const monthColumns = (rows[particularHit.row] || []).flatMap((cell, col) => {
      const hit = monthFrom(cell);
      return hit ? [{ col, month: hit.month, year: hit.year || year }] : [];
    });
    const anchorRows = Array.from({ length: Math.max(0, nextHeaderRow - particularHit.row - 1) }, (_, offset) => particularHit.row + offset + 1)
      .filter((rowIndex) => /^(?:declared seat count|actual head count|actual headcount)$/.test(normalizedKey(rows[rowIndex]?.[particularHit.col])));
    const activeMonthColumns = anchorRows.length
      ? monthColumns.filter((period) => anchorRows.some((rowIndex) => normalizeBdoText(rows[rowIndex]?.[period.col]) !== ''))
      : monthColumns;
    for (let rowIndex = particularHit.row + 1; rowIndex < nextHeaderRow; rowIndex++) {
      const particular = normalizeBdoText(rows[rowIndex]?.[particularHit.col]);
      if (!particular || SUMMARY_NAME.test(particular)) continue;
      for (const period of activeMonthColumns) {
        const percentage = /percentage|rate|turnover/i.test(particular);
        const parsed = parseNumeric(rows[rowIndex]?.[period.col], percentage);
        addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[period.col]);
        if (parsed.value == null) continue;
        records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'manpower', category: mappedSectionProducts[sectionIndex], metric: particular, month: period.month, year: period.year, reportDate: new Date(period.year, period.month - 1, 1), numericValue: parsed.value });
      }
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

type WideYtdGroup = { product: string; columns: Array<{ col: number; field: string }> };

function detectWideYtdMatrix(rows: unknown[][]) {
  const headerRow = rows.slice(0, 20).findIndex((row) => row.map(fieldAlias).filter((field) => ['target', 'actual', 'achievement'].includes(field)).length >= 6);
  if (headerRow < 0) return null;
  const maxColumns = Math.max(0, ...rows.slice(headerRow + 1).map((row) => row.length));
  const monthCandidate = Array.from({ length: maxColumns }, (_, col) => ({
    col,
    count: rows.slice(headerRow + 1).filter((row) => Boolean(monthFrom(row[col]))).length,
  })).sort((a, b) => b.count - a.count)[0];
  if (!monthCandidate || monthCandidate.count < 2) return null;
  const monthColumn = monthCandidate.col;
  const groups = new Map<string, WideYtdGroup>();
  for (let col = 0; col < (rows[headerRow]?.length || 0); col++) {
    const field = fieldAlias(rows[headerRow]?.[col]);
    if (!['target', 'actual', 'achievement'].includes(field)) continue;
    const product = rows.slice(0, headerRow).reverse().map((row) => normalizeBdoText(row[col])).find((label) => label && !monthFrom(label) && !fieldAlias(label) && !/^20\d{2}$/.test(label));
    if (!product) continue;
    const key = normalizedKey(product);
    const group = groups.get(key) || { product, columns: [] };
    group.columns.push({ col, field });
    groups.set(key, group);
  }
  const productGroups = [...groups.values()].filter((group) => group.columns.some((column) => column.field === 'actual'));
  return productGroups.length >= 2 ? { headerRow, monthColumn, groups: productGroups } : null;
}

function parseWideYtd(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult | null {
  const matrix = detectWideYtdMatrix(rows);
  if (!matrix) return null;
  const year = workbookYear(rows, fallbackYear);
  const warnings: BdoImportIssue[] = [];
  const records: BdoImportRecord[] = [];
  for (let rowIndex = matrix.headerRow + 1; rowIndex < rows.length; rowIndex++) {
    const period = monthFrom(rows[rowIndex]?.[matrix.monthColumn]);
    if (!period) continue;
    const recordYear = period.year || year;
    for (const group of matrix.groups) {
      const values = new Map<string, ReturnType<typeof parseNumeric>>();
      for (const column of group.columns) {
        const parsed = parseNumeric(rows[rowIndex]?.[column.col], column.field === 'achievement');
        addNumericIssue(warnings, sheetName, rowIndex + 1, parsed, rows[rowIndex]?.[column.col]);
        values.set(column.field, parsed);
      }
      const target = values.get('target')?.value;
      const actual = values.get('actual')?.value;
      const suppliedAchievement = values.get('achievement')?.value;
      const remark = combinedRemark(values.values());
      if (target == null && actual == null && suppliedAchievement == null && !remark) continue;
      records.push({ worksheetSource: sheetName, sourceRow: rowIndex + 1, recordKind: 'ytd', category: group.product, product: group.product, metric: group.product, month: period.month, year: recordYear, reportDate: new Date(recordYear, period.month - 1, 1), target, actual, achievement: calculatedAchievement(target, actual, suppliedAchievement), dataStatus: combinedStatus(values.values()), remark });
    }
  }
  return { sheetName, detectedType, records, months: [...new Set(records.map((record) => monthLabel(record.year, record.month!)))], warnings, status: records.length ? (warnings.length ? 'Warning' : 'Ready') : 'Skipped' };
}

function parseYtd(rows: unknown[][], sheetName: string, detectedType: BdoWorksheetType, fallbackYear: number): BdoSheetResult {
  const wide = parseWideYtd(rows, sheetName, detectedType, fallbackYear);
  if (wide) return wide;
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
  const ytdSheetName = workbook.SheetNames.find((sheetName) => detectBdoWorksheet(sheetName) === 'YTD Performance');
  const ytdRows = ytdSheetName ? rowsWithMergedCells(workbook.Sheets[ytdSheetName]) : null;
  const ytdResult = ytdSheetName && ytdRows ? parseYtd(ytdRows, ytdSheetName, 'YTD Performance', fallbackDate.getFullYear()) : null;
  const sectionProducts = [...new Set((ytdResult?.records || []).map((record) => record.product || record.category).filter(Boolean) as string[])];
  const sheets: BdoSheetResult[] = workbook.SheetNames.map((sheetName) => {
    const detectedType = detectBdoWorksheet(sheetName);
    if (!detectedType) return { sheetName, detectedType: 'Unsupported', records: [], months: [], warnings: [{ worksheet: sheetName, message: 'Unsupported worksheet skipped.' }], status: 'Skipped' };
    const rows = rowsWithMergedCells(workbook.Sheets[sheetName]);
    if (detectedType === 'Manpower Monitoring') return parseManpower(rows, sheetName, detectedType, fallbackDate.getFullYear(), sectionProducts);
    if (detectedType === 'TLs Scorecard') return parseTeamLeaders(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'CI SCORECARD') return parseCiScorecard(rows, sheetName, detectedType, fallbackDate.getFullYear());
    if (detectedType === 'YTD Performance' && ytdResult) return ytdResult;
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
    agents: [...new Set(records.filter((record) => record.recordKind === 'agent_monitoring' || record.recordKind === 'scorecard').map((record) => record.entityName).filter(Boolean) as string[])],
    teamLeaders: [...new Set(records.filter((record) => record.recordKind === 'team_leader').map((record) => record.entityName).filter(Boolean) as string[])],
  };
}
