const MONTHS = new Map([
  ['january', 0], ['jan', 0], ['february', 1], ['feb', 1], ['march', 2], ['mar', 2],
  ['april', 3], ['apr', 3], ['may', 4], ['june', 5], ['jun', 5], ['july', 6],
  ['jul', 6], ['august', 7], ['aug', 7], ['september', 8], ['sept', 8], ['sep', 8],
  ['october', 9], ['oct', 9], ['november', 10], ['nov', 10], ['december', 11], ['dec', 11],
]);

export type MbGoalMetric = {
  metricType: string;
  count?: number | null;
  volume?: number | null;
  goal?: number | null;
  actual?: number | null;
  achievement?: number | null;
};

export type MbGoalAchievementEntry = {
  name: string;
  rowIdx: number;
  reportDate: Date;
  count: number;
  volume: number;
  normalizedMetrics: MbGoalMetric[];
  transmittals?: number;
  approvals?: number;
  booked?: number;
  activations?: number;
  ntb?: number;
  supplementary?: number;
  agentCode?: string;
  agentLevel?: string;
  dateHired?: Date;
  agentType?: string;
  monthlyGoal?: number;
  monthlyActual?: number;
  monthlyAchievement?: number;
};

export type MbGoalAchievementParseResult = {
  entries: MbGoalAchievementEntry[];
  invalidRows: number;
  warnings: string[];
};

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function monthFrom(value: unknown) {
  for (const token of normalize(value).split(' ')) {
    const month = MONTHS.get(token);
    if (month !== undefined) return month;
  }
  return undefined;
}

function yearFrom(value: unknown) {
  const match = text(value).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function isNameHeader(value: unknown) {
  const valueNormalized = normalize(value);
  const compact = valueNormalized.replace(/\s+/g, '');
  return ['name', 'agent', 'agent name', 'full name'].includes(valueNormalized)
    || ['agentname', 'agentfullname', 'fullname'].includes(compact);
}

function isFooter(value: unknown) {
  const valueNormalized = normalize(value);
  return !valueNormalized || ['total', 'grand total', 'subtotal', 'summary', 'overall']
    .some((label) => valueNormalized === label || valueNormalized.startsWith(`${label} `));
}

function numeric(value: unknown): { present: boolean; value?: number; error?: string } {
  if (value == null || text(value) === '') return { present: false };
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0
      ? { present: true, value }
      : { present: true, error: 'invalid or negative number' };
  }
  const raw = text(value);
  if (/^(?:-|n\/?a|none|null)$/i.test(raw)) return { present: true, value: 0 };
  const isPercent = raw.endsWith('%');
  const cleaned = raw.replace(/[₱,$\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/%$/, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return { present: true, error: `invalid number "${raw.slice(0, 30)}"` };
  return { present: true, value: isPercent ? parsed / 100 : parsed };
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && value > 30_000 && value < 60_000) {
    // Excel's 1900 date system, including its historical leap-year offset.
    const utc = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function metricFromLabels(labels: string[]) {
  const joined = labels.join(' ');
  if (/\bntb\b|new to bank/.test(joined)) return 'ntb';
  if (/\bsupple(?:mentary|mental)?\b|\bsupp\b/.test(joined)) return 'supplementary';
  if (labels.some((label) => /^trans(?:actions?)?(?:\s|$)/.test(label))) return 'transactions';
  if (labels.some((label) => /^vol(?:ume)?(?:\s|$)/.test(label))) return 'volume';
  if (/transmitted|transmittal/.test(joined)) return 'transmittals';
  if (/approval|approved/.test(joined)) return 'approvals';
  if (/booked|booking/.test(joined)) return 'booked';
  if (/activation|activated/.test(joined)) return 'activations';

  const qualifiers = [
    ['gross_turn_ins_volume', /gross turn ins?.*(?:volume|vol|amount)|(?:volume|vol|amount).*gross turn ins?/],
    ['gross_turn_ins_transactions', /gross turn ins?.*(?:transaction|txn|count)|(?:transaction|txn|count).*gross turn ins?/],
    ['disbursed_volume', /disbursed.*(?:volume|vol|amount)|(?:volume|vol|amount).*disbursed/],
    ['disbursed_transactions', /disbursed.*(?:transaction|txn|count)|(?:transaction|txn|count).*disbursed/],
    ['open_market_volume', /open market.*(?:volume|vol|amount)|(?:volume|vol|amount).*open market/],
    ['open_market_transactions', /open market.*(?:transaction|txn|count)|(?:transaction|txn|count).*open market/],
  ] as const;
  return qualifiers.find(([, pattern]) => pattern.test(joined))?.[0];
}

type ColumnDefinition = {
  col: number;
  metric?: string;
  field: 'goal' | 'actual' | 'achievement' | 'score' | 'count' | 'volume';
};

function columnDefinition(direct: string[], logical: string[]): Omit<ColumnDefinition, 'col'> | null {
  const directText = direct.join(' ');
  const logicalText = logical.join(' ');
  const metric = metricFromLabels([...direct].reverse()) || metricFromLabels([...logical].reverse());
  const hasPercent = direct.some((label) => label.includes('%')) || logical.some((label) => label.includes('%'));
  const field: ColumnDefinition['field'] | undefined =
    /achievement|achieve|attainment/.test(directText) ? 'achievement'
      : /\bscore\b/.test(logicalText) ? 'score'
      : hasPercent || /percentage|percent/.test(logicalText) ? 'achievement'
      : /\bactual\b|performance/.test(logicalText) ? 'actual'
      : /\btarget\b|\bgoal\b/.test(logicalText) ? 'goal'
      : /\bvolume\b|\bamount\b|\bbillings?\b/.test(logicalText) ? 'volume'
      : /\bcount\b|\btransaction\b/.test(logicalText) ? 'count'
      : undefined;
  return field ? { metric, field } : null;
}

export function isMbGoalAchievementLayout(rows: unknown[][]) {
  const header = rows.slice(0, 20);
  const labels = header.flatMap((row) => (row || []).map(normalize)).filter(Boolean);
  const has = (pattern: RegExp) => labels.some((label) => pattern.test(label));
  return header.some((row) => (row || []).some(isNameHeader))
    && labels.some((label) => monthFrom(label) !== undefined)
    && has(/^(?:target|goal)$/)
    && has(/^actual$|^performance$/)
    && (has(/^achievement$|^% achievement$|^attainment$/) || labels.some((label) => label.includes('%')))
    && has(/^trans(?:actions?)?(?:\s|$)|^vol(?:ume)?(?:\s|$)|\bntb\b|\bsupple|\btransmittal|\btransmitted|\bapproval|\bbooked|\bactivation|\bdisbursed|\bgross turn ins?\b/);
}

/**
 * Parses the annual MB goal/achievement worksheets used by MB ACQ and MB PL.
 * Each populated agent/month becomes one entry. Merged month and TARGET /
 * ACTUAL / % / SCORE headings are reconstructed by carrying their labels only
 * inside the current month block.
 */
export function parseMbGoalAchievementRows(rows: unknown[][], fallbackDate: Date): MbGoalAchievementParseResult | null {
  if (!isMbGoalAchievementLayout(rows)) return null;

  let nameHeaderRow = -1;
  let nameCol = -1;
  for (let r = 0; r < Math.min(rows.length, 30) && nameCol < 0; r++) {
    const found = (rows[r] || []).findIndex(isNameHeader);
    if (found >= 0) {
      nameHeaderRow = r;
      nameCol = found;
    }
  }
  if (nameCol < 0) return null;

  let dataStartRow = -1;
  for (let r = nameHeaderRow + 1; r < rows.length; r++) {
    const candidate = text(rows[r]?.[nameCol]);
    if (candidate && !isNameHeader(candidate)) {
      dataStartRow = r;
      break;
    }
  }
  if (dataStartRow < 0) return null;

  const headerRows = rows.slice(0, dataStartRow);
  const workbookYear = headerRows.flat().map(yearFrom).find((year) => year !== undefined) ?? fallbackDate.getFullYear();
  const monthStartsByPeriod = new Map<string, { col: number; month: number; year: number }>();
  for (let r = 0; r < headerRows.length; r++) {
    for (let c = nameCol + 1; c < (headerRows[r] || []).length; c++) {
      const month = monthFrom(headerRows[r][c]);
      if (month === undefined) continue;
      const year = yearFrom(headerRows[r][c]) ?? workbookYear;
      const key = `${year}-${month}`;
      const current = monthStartsByPeriod.get(key);
      if (!current || c < current.col) monthStartsByPeriod.set(key, { col: c, month, year });
    }
  }
  const monthStarts = [...monthStartsByPeriod.values()].sort((a, b) => a.col - b.col);
  if (!monthStarts.length) return null;

  const maxCols = Math.max(0, ...rows.map((row) => (row || []).length));
  const headerAlias = (aliases: RegExp[]) => {
    for (let r = 0; r < headerRows.length; r++) {
      const col = (headerRows[r] || []).findIndex((value) => aliases.some((pattern) => pattern.test(normalize(value))));
      if (col >= 0) return col;
    }
    return undefined;
  };
  const agentCodeCol = headerAlias([/^agent code$/, /^agent id$/, /^code$/]);
  const statusCol = headerAlias([/^status$/, /^agent status$/, /^type$/]);
  const dateHiredCol = headerAlias([/^date (?:on board|onboard|hired)$/, /^onboard date$/]);
  const levelCol = headerAlias([/^tenure$/, /^level$/, /^tier$/]);
  const entries: MbGoalAchievementEntry[] = [];
  const warnings: string[] = [];
  let invalidRows = 0;

  for (let monthIndex = 0; monthIndex < monthStarts.length; monthIndex++) {
    const period = monthStarts[monthIndex];
    const end = monthStarts[monthIndex + 1]?.col ?? maxCols;
    const carriedByRow = headerRows.map((row) => {
      const carried: string[] = [];
      let active = '';
      for (let col = period.col; col < end; col++) {
        const value = normalize(row?.[col]);
        if (value) active = value;
        carried[col] = active;
      }
      return carried;
    });
    const columns: ColumnDefinition[] = [];
    for (let col = period.col; col < end; col++) {
      const direct = headerRows.map((row) => normalize(row?.[col])).filter(Boolean);
      const logical = carriedByRow.map((row) => row[col]).filter(Boolean);
      const definition = columnDefinition(direct, logical);
      if (definition) columns.push({ col, ...definition });
    }
    if (!columns.length) continue;

    for (let rowIndex = dataStartRow; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const name = text(row[nameCol]);
      if (isFooter(name) || /\brank\b|\baverage\b/i.test(name)) continue;

      const values = new Map<string, { goal?: number; actual?: number; achievement?: number; score?: number; count?: number; volume?: number; present: boolean }>();
      let rowHasValue = false;
      let rowHasError = false;
      for (const column of columns) {
        const parsed = numeric(row[column.col]);
        if (!parsed.present) continue;
        rowHasValue = true;
        if (parsed.error) {
          rowHasError = true;
          warnings.push(`Row ${rowIndex + 1}, column ${column.col + 1} (${period.month + 1}/${period.year}): ${parsed.error}`);
          continue;
        }
        const key = column.metric || 'overall';
        const metric = values.get(key) || { present: false };
        metric.present = true;
        metric[column.field] = parsed.value;
        values.set(key, metric);
      }
      if (!rowHasValue) continue;
      if (rowHasError) invalidRows++;

      const normalizedMetrics: MbGoalMetric[] = [];
      for (const [metricType, metric] of values) {
        if (!metric.present) continue;
        const actual = metric.actual ?? metric.count;
        const isVolumeMetric = metricType === 'volume' || /_volume$/.test(metricType);
        normalizedMetrics.push({
          metricType,
          count: metricType === 'overall' || isVolumeMetric || actual === undefined ? null : actual,
          volume: metric.volume ?? (isVolumeMetric ? actual ?? null : null),
          goal: metric.goal ?? null,
          actual: actual ?? null,
          achievement: metric.achievement ?? null,
        });
        if (metric.score !== undefined) {
          normalizedMetrics.push({ metricType: `${metricType}_score`, actual: metric.score });
        }
      }
      if (!normalizedMetrics.length) continue;

      const valueFor = (metricType: string) => values.get(metricType)?.actual ?? values.get(metricType)?.count;
      const ntb = valueFor('ntb');
      const supplementary = valueFor('supplementary');
      const transactions = valueFor('transactions');
      const transmittals = valueFor('transmittals') ?? transactions;
      const approvals = valueFor('approvals');
      const booked = valueFor('booked');
      const activations = valueFor('activations');
      const firstCount = [transmittals, approvals, booked, activations, ntb, supplementary].find((value) => value !== undefined) ?? 0;
      const firstVolume = [...values.entries()]
        .map(([metricType, value]) => value.volume ?? (metricType === 'volume' || /_volume$/.test(metricType) ? value.actual ?? value.count : undefined))
        .find((value) => value !== undefined) ?? 0;
      const overall = values.get('overall');
      const ntbGoal = values.get('ntb')?.goal;

      entries.push({
        name,
        rowIdx: rowIndex + 1,
        reportDate: new Date(period.year, period.month, 1),
        count: Math.max(0, Math.floor(firstCount)),
        volume: Math.max(0, Math.round(firstVolume)),
        normalizedMetrics,
        transmittals: transmittals === undefined ? undefined : Math.floor(transmittals),
        approvals: approvals === undefined ? undefined : Math.floor(approvals),
        booked: booked === undefined ? undefined : Math.floor(booked),
        activations: activations === undefined ? undefined : Math.floor(activations),
        ntb: ntb === undefined ? undefined : Math.floor(ntb),
        supplementary: supplementary === undefined ? undefined : Math.floor(supplementary),
        agentCode: agentCodeCol === undefined ? undefined : text(row[agentCodeCol]) || undefined,
        agentLevel: levelCol === undefined ? undefined : text(row[levelCol]) || undefined,
        dateHired: dateHiredCol === undefined ? undefined : parseDate(row[dateHiredCol]),
        agentType: statusCol === undefined ? undefined : text(row[statusCol]) || undefined,
        monthlyGoal: overall?.goal ?? ntbGoal,
        monthlyActual: overall?.actual,
        monthlyAchievement: overall?.achievement,
      });
    }
  }

  return { entries, invalidRows, warnings };
}
