import * as XLSX from 'xlsx';
import { parseImportNumber } from './import-number';
import {
  BDO_SGM_METRIC_TYPE,
  type BdoSgmCardLevel,
  type BdoSgmImportIssue,
  type BdoSgmRankingRecord,
} from './bdo-sgm-ranking-import';

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;

const MONTH_INDEX = new Map<string, number>(MONTH_NAMES.map((month, index) => [month, index]));

export type ConsolidatedPeriodType = 'daily' | 'monthly' | 'yearly';

export interface ConsolidatedMonthValue {
  month: number;
  label: string;
  value: number;
  available: boolean;
  originalValue: string | number | null;
}

export interface BdoSgmConsolidatedAgent {
  nickname: string;
  fullName: string;
  reportYear: number;
  sourceSheet: string;
  sourceRow: number;
  fcMonths: ConsolidatedMonthValue[];
  bcMonths: ConsolidatedMonthValue[];
  finalFcTotal: number;
  finalBcTotal: number;
  firstPeriodTotalFc: number;
  firstPeriodTotalBc: number;
  secondPeriodTotalFc: number;
  secondPeriodTotalBc: number;
  wholeYearTotalFc: number;
  wholeYearTotalBc: number;
  workbookFirstPeriodTotalFc: number | null;
  workbookFirstPeriodTotalBc: number | null;
  workbookSecondPeriodTotalFc: number | null;
  workbookSecondPeriodTotalBc: number | null;
  workbookWholeYearTotalFc: number | null;
  workbookWholeYearTotalBc: number | null;
  ranking: number | null;
  validationStatus: 'Valid' | 'Warning';
  warnings: string[];
}

export interface BdoSgmConsolidatedRecord extends BdoSgmRankingRecord {
  nickname: string;
  finalTotal: number;
  wholeYearTotal: number;
  firstPeriodTotal: number;
  secondPeriodTotal: number;
  workbookGrandTotal?: number;
  ranking?: number;
  monthValues: ConsolidatedMonthValue[];
}

export interface BdoSgmConsolidatedParseResult {
  detected: boolean;
  format: 'BDO SGM Consolidated' | 'Unsupported';
  headerRow: number | null;
  headerRows: number[];
  records: BdoSgmConsolidatedRecord[];
  agents: BdoSgmConsolidatedAgent[];
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
  periodTotals: {
    finalFcTotal: number;
    finalBcTotal: number;
    wholeYearTotalFc: number;
    wholeYearTotalBc: number;
  };
}

type MetricColumn = {
  column: number;
  kind:
    | 'nickname'
    | 'fullName'
    | 'monthFc'
    | 'monthBc'
    | 'firstPeriodFc'
    | 'firstPeriodBc'
    | 'secondPeriodFc'
    | 'secondPeriodBc'
    | 'wholeYearFc'
    | 'wholeYearBc'
    | 'ranking';
  month?: number;
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value: unknown): string {
  return normalizeText(value)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlank(value: unknown): boolean {
  return value == null || normalizeText(value) === '';
}

function worksheetRows(worksheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
  } as XLSX.Sheet2JSONOpts) as unknown[][];
}

function mergedParentHeaders(worksheet: XLSX.WorkSheet, rowIndex: number, width: number): string[] {
  const headers = Array.from({ length: width }, (_, column) => normalizeHeader(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]?.v));
  for (const merge of worksheet['!merges'] || []) {
    if (merge.s.r > rowIndex || merge.e.r < rowIndex) continue;
    const value = normalizeHeader(worksheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })]?.v);
    for (let column = merge.s.c; column <= merge.e.c; column++) headers[column] = value;
  }
  return headers;
}

function headerMonth(value: string): number | null {
  for (const [month, index] of MONTH_INDEX) {
    if (new RegExp(`\\b${month}\\b`).test(value)) return index;
  }
  return null;
}

function findHeaderRows(worksheet: XLSX.WorkSheet, rows: unknown[][]): { parentRow: number; metricRow: number } | null {
  const limit = Math.min(rows.length, 25);
  for (let metricRow = 0; metricRow < limit; metricRow++) {
    const values = (rows[metricRow] || []).map(normalizeHeader);
    const hasNickname = values.includes('NICKNAME');
    const hasFullName = values.some((value) => value === 'NAMES' || value === 'FULL NAME' || value === 'AGENT NAME');
    const hasFc = values.some((value) => value === 'FINAL FC TOTAL' || value === 'TOTAL FC');
    const hasBc = values.some((value) => value === 'FINAL BC TOTAL' || value === 'TOTAL BC');
    if (!hasNickname || !hasFullName || !hasFc || !hasBc) continue;
    for (let parentRow = Math.max(0, metricRow - 3); parentRow < metricRow; parentRow++) {
      const parents = mergedParentHeaders(worksheet, parentRow, values.length);
      const monthCount = new Set(parents.map(headerMonth).filter((month): month is number => month != null)).size;
      if (monthCount >= 2 || parents.some((value) => value.includes('TOTAL OF WHOLE YEAR'))) {
        return { parentRow, metricRow };
      }
    }
  }
  return null;
}

function mapColumns(worksheet: XLSX.WorkSheet, rows: unknown[][], header: { parentRow: number; metricRow: number }): MetricColumn[] {
  const metricValues = (rows[header.metricRow] || []).map(normalizeHeader);
  const parents = mergedParentHeaders(worksheet, header.parentRow, metricValues.length);
  const columns: MetricColumn[] = [];
  const rankingCandidates: number[] = [];
  let latestMonth = -1;

  for (let column = 0; column < metricValues.length; column++) {
    const child = metricValues[column];
    const parent = parents[column];
    const month = headerMonth(parent);
    if (month != null) latestMonth = Math.max(latestMonth, month);

    if (child === 'NICKNAME') {
      columns.push({ column, kind: 'nickname' });
      continue;
    }
    if (child === 'NAMES' || child === 'FULL NAME' || child === 'AGENT NAME') {
      columns.push({ column, kind: 'fullName' });
      continue;
    }
    if (month != null && child === 'FINAL FC TOTAL') {
      columns.push({ column, kind: 'monthFc', month });
      continue;
    }
    if (month != null && child === 'FINAL BC TOTAL') {
      columns.push({ column, kind: 'monthBc', month });
      continue;
    }

    const wholeYear = parent.includes('TOTAL OF WHOLE YEAR') || parent.includes('WHOLE YEAR');
    if (child === 'TOTAL FC') {
      columns.push({
        column,
        kind: wholeYear ? 'wholeYearFc' : latestMonth <= 6 ? 'firstPeriodFc' : 'secondPeriodFc',
      });
      continue;
    }
    if (child === 'TOTAL BC') {
      columns.push({
        column,
        kind: wholeYear ? 'wholeYearBc' : latestMonth <= 6 ? 'firstPeriodBc' : 'secondPeriodBc',
      });
      continue;
    }
    if (child === 'RANKING' || child === 'RANK') {
      rankingCandidates.push(column);
      if (wholeYear) columns.push({ column, kind: 'ranking' });
    }
  }
  if (!columns.some((column) => column.kind === 'ranking') && rankingCandidates.length) {
    columns.push({ column: rankingCandidates[rankingCandidates.length - 1], kind: 'ranking' });
  }
  return columns;
}

function parsedNumber(value: unknown): { value: number | null; valid: boolean } {
  if (isBlank(value)) return { value: null, valid: true };
  if (/^#(?:N\/A|VALUE!|REF!|DIV\/0!|NAME\\?|NUM!|NULL!)$/i.test(normalizeText(value))) {
    return { value: null, valid: false };
  }
  const parsed = parseImportNumber(value);
  if (!parsed.valid || parsed.value == null || parsed.percentage || parsed.value < 0) return { value: null, valid: false };
  return { value: parsed.value, valid: true };
}

function monthValues(): ConsolidatedMonthValue[] {
  return MONTH_NAMES.map((label, month) => ({
    month: month + 1,
    label,
    value: 0,
    available: false,
    originalValue: null,
  }));
}

function sum(values: ConsolidatedMonthValue[], start = 0, end = 12): number {
  return values.slice(start, end).reduce((total, month) => total + month.value, 0);
}

function warningMessage(agent: string, field: string, workbookValue: number, calculatedValue: number): string {
  return `${field} mismatch for ${agent}: workbook value ${workbookValue.toLocaleString('en-US')}; calculated value ${calculatedValue.toLocaleString('en-US')}.`;
}

function recordFor(
  agent: BdoSgmConsolidatedAgent,
  cardLevel: BdoSgmCardLevel,
  count: number,
  reportDate: Date,
  finalTotal: number,
): BdoSgmConsolidatedRecord {
  const first = cardLevel === 'FIRST_CARD';
  const warnings = agent.warnings.filter((warning) => first ? /\bFC\b/.test(warning) : /\bBC\b/.test(warning));
  const wholeYearTotal = first ? agent.wholeYearTotalFc : agent.wholeYearTotalBc;
  const workbookGrandTotal = first ? agent.workbookWholeYearTotalFc : agent.workbookWholeYearTotalBc;
  return {
    name: agent.fullName,
    nickname: agent.nickname,
    count,
    volume: 0,
    metricType: BDO_SGM_METRIC_TYPE,
    cardLevel,
    cardLevelLabel: first ? '1ST CARD' : 'BUNDLE CARD',
    grandTotal: wholeYearTotal,
    finalTotal,
    wholeYearTotal,
    firstPeriodTotal: first ? agent.firstPeriodTotalFc : agent.firstPeriodTotalBc,
    secondPeriodTotal: first ? agent.secondPeriodTotalFc : agent.secondPeriodTotalBc,
    workbookGrandTotal: workbookGrandTotal ?? undefined,
    ranking: agent.ranking ?? undefined,
    monthValues: first ? agent.fcMonths : agent.bcMonths,
    sourceSheet: agent.sourceSheet,
    reportDate,
    rowIdx: agent.sourceRow,
    validationErrors: warnings.length ? warnings : undefined,
    normalizedMetrics: [{ metricType: BDO_SGM_METRIC_TYPE, count }],
  };
}

export function isBdoSgmConsolidatedWorksheet(worksheet: XLSX.WorkSheet, sheetName: string): boolean {
  const rows = worksheetRows(worksheet);
  const header = findHeaderRows(worksheet, rows);
  if (!header) return false;
  const normalizedSheet = normalizeHeader(sheetName);
  const columns = mapColumns(worksheet, rows, header);
  const monthFc = columns.filter((column) => column.kind === 'monthFc').length;
  const monthBc = columns.filter((column) => column.kind === 'monthBc').length;
  return normalizedSheet === 'HOH' || (monthFc >= 2 && monthBc >= 2);
}

export function parseBdoSgmConsolidatedWorksheet(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
  selectedReportDate: Date,
  reportPeriodType: ConsolidatedPeriodType,
): BdoSgmConsolidatedParseResult {
  const rows = worksheetRows(worksheet);
  const rowsScanned = rows.filter((row) => row.some((value) => !isBlank(value))).length;
  const empty = (errors: string[] = []): BdoSgmConsolidatedParseResult => ({
    detected: false,
    format: 'Unsupported',
    headerRow: null,
    headerRows: [],
    records: [],
    agents: [],
    issues: [],
    warnings: [],
    errors,
    rowsScanned,
    validAgentRows: 0,
    monthlyRecordsDetected: 0,
    skippedBlankCells: 0,
    invalidRows: 0,
    warningCount: 0,
    detectedMonths: [],
    detectedCardLevels: [],
    periodTotals: { finalFcTotal: 0, finalBcTotal: 0, wholeYearTotalFc: 0, wholeYearTotalBc: 0 },
  });

  const header = findHeaderRows(worksheet, rows);
  if (!header) return empty();
  const columns = mapColumns(worksheet, rows, header);
  const nicknameColumn = columns.find((column) => column.kind === 'nickname');
  const fullNameColumn = columns.find((column) => column.kind === 'fullName');
  const monthFcColumns = columns.filter((column) => column.kind === 'monthFc');
  const monthBcColumns = columns.filter((column) => column.kind === 'monthBc');
  if (!nicknameColumn || !fullNameColumn) return empty(['The HOH worksheet is missing NICKNAME or NAMES columns.']);
  if (!monthFcColumns.length || !monthBcColumns.length) return empty(['The HOH worksheet is missing monthly FINAL FC TOTAL or FINAL BC TOTAL columns.']);

  const reportYear = selectedReportDate.getFullYear();
  const issues: BdoSgmImportIssue[] = [];
  const warnings: string[] = [];
  const agents: BdoSgmConsolidatedAgent[] = [];
  let skippedBlankCells = 0;
  let invalidRows = 0;

  const addIssue = (row: number, reason: string, warning: boolean) => {
    issues.push({ worksheet: sheetName, row, reason, warning });
    if (warning) warnings.push(`Row ${row}: ${reason}`);
  };

  for (let rowIndex = header.metricRow + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const nickname = normalizeText(row[nicknameColumn.column]);
    const fullName = normalizeText(row[fullNameColumn.column]);
    if (!nickname && !fullName) continue;
    if (/^(?:GRAND TOTAL|TOTAL|NICKNAME|NAMES|FULL NAME)$/i.test(nickname || fullName)) continue;
    if (!fullName) {
      addIssue(rowIndex + 1, `Agent full name is missing for nickname "${nickname || 'Unknown'}".`, false);
      invalidRows++;
      continue;
    }

    const fcMonths = monthValues();
    const bcMonths = monthValues();
    const agentWarnings: string[] = [];
    let malformed = false;

    for (const column of [...monthFcColumns, ...monthBcColumns]) {
      const raw = row[column.column];
      const month = column.month!;
      const target = column.kind === 'monthFc' ? fcMonths[month] : bcMonths[month];
      target.originalValue = isBlank(raw) ? null : raw as string | number;
      if (isBlank(raw)) {
        skippedBlankCells++;
        continue;
      }
      const parsed = parsedNumber(raw);
      if (!parsed.valid || parsed.value == null) {
        const metric = column.kind === 'monthFc' ? 'FC' : 'BC';
        const reason = `${MONTH_NAMES[month]} ${metric} has invalid value "${normalizeText(raw).slice(0, 60)}"; treated as unavailable.`;
        addIssue(rowIndex + 1, `${fullName}: ${reason}`, true);
        agentWarnings.push(reason);
        malformed = true;
        continue;
      }
      target.value = parsed.value;
      target.available = true;
    }

    const calculated = {
      firstPeriodFc: sum(fcMonths, 0, 7),
      firstPeriodBc: sum(bcMonths, 0, 7),
      secondPeriodFc: sum(fcMonths, 7, 12),
      secondPeriodBc: sum(bcMonths, 7, 12),
      wholeYearFc: sum(fcMonths),
      wholeYearBc: sum(bcMonths),
    };

    const readSummary = (kind: MetricColumn['kind']): number | null => {
      const column = columns.find((candidate) => candidate.kind === kind);
      if (!column) return null;
      const parsed = parsedNumber(row[column.column]);
      if (!parsed.valid) {
        const reason = `${kind} has invalid value "${normalizeText(row[column.column]).slice(0, 60)}"; calculated value will be used.`;
        addIssue(rowIndex + 1, `${fullName}: ${reason}`, true);
        agentWarnings.push(reason);
      }
      return parsed.value;
    };

    const workbookFirstPeriodTotalFc = readSummary('firstPeriodFc');
    const workbookFirstPeriodTotalBc = readSummary('firstPeriodBc');
    const workbookSecondPeriodTotalFc = readSummary('secondPeriodFc');
    const workbookSecondPeriodTotalBc = readSummary('secondPeriodBc');
    const workbookWholeYearTotalFc = readSummary('wholeYearFc');
    const workbookWholeYearTotalBc = readSummary('wholeYearBc');
    const comparisons: Array<[string, number | null, number]> = [
      ['First-period FC', workbookFirstPeriodTotalFc, calculated.firstPeriodFc],
      ['First-period BC', workbookFirstPeriodTotalBc, calculated.firstPeriodBc],
      ['Second-period FC', workbookSecondPeriodTotalFc, calculated.secondPeriodFc],
      ['Second-period BC', workbookSecondPeriodTotalBc, calculated.secondPeriodBc],
      ['Whole-Year FC', workbookWholeYearTotalFc, calculated.wholeYearFc],
      ['Whole-Year BC', workbookWholeYearTotalBc, calculated.wholeYearBc],
    ];
    for (const [field, workbookValue, calculatedValue] of comparisons) {
      if (workbookValue == null || Math.abs(workbookValue - calculatedValue) < 0.000001) continue;
      const reason = warningMessage(fullName, field, workbookValue, calculatedValue);
      addIssue(rowIndex + 1, reason, true);
      agentWarnings.push(reason);
    }

    const rankingValue = readSummary('ranking');
    const ranking = rankingValue != null && Number.isInteger(rankingValue) ? rankingValue : null;
    const selectedMonth = Math.max(0, Math.min(11, selectedReportDate.getMonth()));
    const finalFcTotal = reportPeriodType === 'monthly'
      ? fcMonths[selectedMonth].value
      : reportPeriodType === 'yearly'
        ? calculated.wholeYearFc
        : sum(fcMonths, 0, selectedMonth + 1);
    const finalBcTotal = reportPeriodType === 'monthly'
      ? bcMonths[selectedMonth].value
      : reportPeriodType === 'yearly'
        ? calculated.wholeYearBc
        : sum(bcMonths, 0, selectedMonth + 1);

    agents.push({
      nickname,
      fullName,
      reportYear,
      sourceSheet: sheetName,
      sourceRow: rowIndex + 1,
      fcMonths,
      bcMonths,
      finalFcTotal,
      finalBcTotal,
      firstPeriodTotalFc: calculated.firstPeriodFc,
      firstPeriodTotalBc: calculated.firstPeriodBc,
      secondPeriodTotalFc: calculated.secondPeriodFc,
      secondPeriodTotalBc: calculated.secondPeriodBc,
      wholeYearTotalFc: calculated.wholeYearFc,
      wholeYearTotalBc: calculated.wholeYearBc,
      workbookFirstPeriodTotalFc,
      workbookFirstPeriodTotalBc,
      workbookSecondPeriodTotalFc,
      workbookSecondPeriodTotalBc,
      workbookWholeYearTotalFc,
      workbookWholeYearTotalBc,
      ranking,
      validationStatus: agentWarnings.length || malformed ? 'Warning' : 'Valid',
      warnings: [...new Set(agentWarnings)],
    });
  }

  if (!agents.length) {
    return {
      ...empty(['The HOH worksheet was detected, but no valid agent rows were found.']),
      detected: true,
      format: 'BDO SGM Consolidated',
      headerRow: header.metricRow + 1,
      headerRows: [header.parentRow + 1, header.metricRow + 1],
      issues,
      warnings,
      invalidRows,
    };
  }

  const records: BdoSgmConsolidatedRecord[] = [];
  for (const agent of agents) {
    if (reportPeriodType === 'monthly') {
      for (let month = 0; month < 12; month++) {
        if (agent.fcMonths[month].available) {
          records.push(recordFor(agent, 'FIRST_CARD', agent.fcMonths[month].value, new Date(reportYear, month, 1), agent.fcMonths[month].value));
        }
        if (agent.bcMonths[month].available) {
          records.push(recordFor(agent, 'BUNDLE_CARD', agent.bcMonths[month].value, new Date(reportYear, month, 1), agent.bcMonths[month].value));
        }
      }
    } else {
      const normalizedDate = reportPeriodType === 'yearly'
        ? new Date(reportYear, 0, 1)
        : new Date(reportYear, selectedReportDate.getMonth(), selectedReportDate.getDate());
      records.push(recordFor(agent, 'FIRST_CARD', agent.finalFcTotal, normalizedDate, agent.finalFcTotal));
      records.push(recordFor(agent, 'BUNDLE_CARD', agent.finalBcTotal, normalizedDate, agent.finalBcTotal));
    }
  }

  return {
    detected: true,
    format: 'BDO SGM Consolidated',
    headerRow: header.metricRow + 1,
    headerRows: [header.parentRow + 1, header.metricRow + 1],
    records,
    agents,
    issues,
    warnings,
    errors: [],
    rowsScanned,
    validAgentRows: agents.length,
    monthlyRecordsDetected: records.length,
    skippedBlankCells,
    invalidRows,
    warningCount: issues.filter((issue) => issue.warning).length,
    detectedMonths: MONTH_NAMES.map((_, month) => `${reportYear}-${String(month + 1).padStart(2, '0')}`),
    detectedCardLevels: ['FIRST_CARD', 'BUNDLE_CARD'],
    periodTotals: {
      finalFcTotal: agents.reduce((total, agent) => total + agent.finalFcTotal, 0),
      finalBcTotal: agents.reduce((total, agent) => total + agent.finalBcTotal, 0),
      wholeYearTotalFc: agents.reduce((total, agent) => total + agent.wholeYearTotalFc, 0),
      wholeYearTotalBc: agents.reduce((total, agent) => total + agent.wholeYearTotalBc, 0),
    },
  };
}
