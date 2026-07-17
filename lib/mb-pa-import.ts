const MONTHS = new Map([
  ['january', 0], ['jan', 0], ['february', 1], ['feb', 1], ['march', 2], ['mar', 2],
  ['april', 3], ['apr', 3], ['may', 4], ['june', 5], ['jun', 5], ['july', 6],
  ['jul', 6], ['august', 7], ['aug', 7], ['september', 8], ['sept', 8], ['sep', 8],
  ['october', 9], ['oct', 9], ['november', 10], ['nov', 10], ['december', 11], ['dec', 11],
]);

export type MbPaMonthlyEntry = {
  name: string;
  rowIdx: number;
  reportDate: Date;
  count: number;
  volume: number;
  transmittals: number;
  transmittedVolume: number;
  c2gTxn: number;
  c2gVol: number;
  btTxn: number;
  btVol: number;
  balconTxn: number;
  balconVol: number;
  grandTotalTxn: number;
  grandTotalVol: number;
  agentLevel?: string;
  monthlyGoal?: number;
  monthlyActual: number;
  monthlyAchievement?: number;
};

export type MbPaMonthlyParseResult = {
  entries: MbPaMonthlyEntry[];
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

function numeric(value: unknown): { value?: number; present: boolean; error?: string } {
  if (value == null || text(value) === '') return { present: false };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, present: true } : { present: true, error: 'invalid number' };
  }
  const raw = text(value);
  if (/^(?:-|n\/?a|none|null)$/i.test(raw)) return { value: 0, present: true };
  const isPercent = raw.endsWith('%');
  const cleaned = raw.replace(/[₱,$\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/%$/, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { present: true, error: `invalid number "${raw.slice(0, 30)}"` };
  return { value: isPercent ? parsed / 100 : parsed, present: true };
}

function isNameHeader(value: unknown) {
  return ['name', 'agent', 'agent name', 'full name'].includes(normalize(value));
}

function isFooter(value: unknown) {
  const name = normalize(value);
  return !name || ['total', 'grand total', 'subtotal', 'summary', 'overall'].some((label) => name === label || name.startsWith(`${label} `));
}

export function isMbPaMonthlyLayout(rows: unknown[][]) {
  const labels = rows.slice(0, 20).flatMap((row) => (row || []).map(normalize)).filter(Boolean);
  const has = (pattern: RegExp) => labels.some((label) => pattern.test(label));
  return has(/^(?:trans|transaction|transactions)$/)
    && has(/^billings?$/)
    && has(/^c2g$/)
    && has(/^bt$/)
    && has(/^bal\s*con(?:\s*pa)?$|^balcon(?:\s*pa)?$/)
    && has(/^total\s+(?:trans|transaction|transactions)$/)
    && has(/^total\s+billings?$/);
}

/**
 * Parses the MB PA annual dashboard layout:
 *
 *   MONTH -> TRANS(C2G/BT/BALCON) -> BILLINGS(C2G/BT/BALCON)
 *         -> TOTAL TRANS/TOTAL BILLINGS -> TIER/TARGET/ACHIEVEMENT
 *
 * Merged cells do not need to be expanded. The parser uses the start of each
 * month and parent group to reconstruct the logical header for every column.
 */
export function parseMbPaMonthlyRows(rows: unknown[][], fallbackDate: Date): MbPaMonthlyParseResult | null {
  if (!isMbPaMonthlyLayout(rows)) return null;

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
      const existing = monthStartsByPeriod.get(key);
      if (!existing || c < existing.col) monthStartsByPeriod.set(key, { col: c, month, year });
    }
  }
  const monthStarts = [...monthStartsByPeriod.values()].sort((a, b) => a.col - b.col);
  if (!monthStarts.length) return null;

  const maxCols = Math.max(0, ...rows.map((row) => (row || []).length));
  const columnLabel = (col: number) => headerRows.map((row) => normalize(row[col])).filter(Boolean).join(' ');
  const directLabels = (col: number) => headerRows.map((row) => normalize(row[col])).filter(Boolean);
  const entries: MbPaMonthlyEntry[] = [];
  const warnings: string[] = [];
  let invalidRows = 0;

  for (let monthIndex = 0; monthIndex < monthStarts.length; monthIndex++) {
    const period = monthStarts[monthIndex];
    const end = monthStarts[monthIndex + 1]?.col ?? maxCols;
    const cols = Array.from({ length: Math.max(0, end - period.col) }, (_, index) => period.col + index);
    const findColumn = (predicate: (label: string, direct: string[]) => boolean, candidates = cols) =>
      candidates.find((col) => predicate(columnLabel(col), directLabels(col)));

    const transStart = findColumn((label, direct) => direct.some((item) => /^(?:trans|transaction|transactions)$/.test(item)) && !/total/.test(label));
    const billingsStart = findColumn((label, direct) => direct.some((item) => /^(?:billing|billings)$/.test(item)) && !/total/.test(label));
    if (transStart === undefined || billingsStart === undefined || billingsStart <= transStart) continue;

    const totalStart = findColumn((_label, direct) => direct.some((item) => item === 'total'), cols.filter((col) => col > billingsStart));
    const transCols = cols.filter((col) => col >= transStart && col < billingsStart);
    const billingsCols = cols.filter((col) => col >= billingsStart && (totalStart === undefined || col < totalStart));
    const categoryColumn = (category: 'c2g' | 'bt' | 'balcon', candidates: number[], fallbackOffset: number) => {
      const match = candidates.find((col) => {
        const label = columnLabel(col);
        if (category === 'c2g') return /\bc2g\b/.test(label);
        if (category === 'bt') return /\bbt\b/.test(label);
        return /\bbal\s*con\b|\bbalcon\b/.test(label);
      });
      return match ?? candidates[fallbackOffset];
    };

    const c2gTxnCol = categoryColumn('c2g', transCols, 0);
    const btTxnCol = categoryColumn('bt', transCols, 1);
    const balconTxnCol = categoryColumn('balcon', transCols, 2);
    const c2gVolCol = categoryColumn('c2g', billingsCols, 0);
    const btVolCol = categoryColumn('bt', billingsCols, 1);
    const balconVolCol = categoryColumn('balcon', billingsCols, 2);
    const totalTxnCol = findColumn((label) => /total\s+(?:trans|transaction)/.test(label)) ?? totalStart;
    const totalVolCol = findColumn((label) => /total\s+billings?/.test(label)) ?? (totalStart === undefined ? undefined : totalStart + 1);
    const tierCol = findColumn((label) => /\btier\b/.test(label));
    const targetCol = findColumn((label) => /\btarget\b|\bgoal\b/.test(label));
    const achievementCol = findColumn((label) => /\bachievement\b|\bachieve\b|\battainment\b/.test(label));
    const relevantCols = [c2gTxnCol, btTxnCol, balconTxnCol, c2gVolCol, btVolCol, balconVolCol, totalTxnCol, totalVolCol, tierCol, targetCol, achievementCol]
      .filter((col): col is number => col !== undefined);

    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = text(row[nameCol]);
      if (isFooter(name) || /\brank\b|\baverage\b/i.test(name)) continue;
      if (!relevantCols.some((col) => row[col] != null && text(row[col]) !== '')) continue;

      const read = (col: number | undefined, field: string) => {
        const parsed = col === undefined ? { present: false } : numeric(row[col]);
        if (parsed.error) {
          invalidRows++;
          warnings.push(`Row ${r + 1}, ${field} (${period.month + 1}/${period.year}): ${parsed.error}`);
        }
        return parsed;
      };
      const c2gTxn = read(c2gTxnCol, 'C2G TRANS');
      const btTxn = read(btTxnCol, 'BT TRANS');
      const balconTxn = read(balconTxnCol, 'BALCON TRANS');
      const c2gVol = read(c2gVolCol, 'C2G BILLINGS');
      const btVol = read(btVolCol, 'BT BILLINGS');
      const balconVol = read(balconVolCol, 'BALCON BILLINGS');
      const totalTxn = read(totalTxnCol, 'TOTAL TRANS');
      const totalVol = read(totalVolCol, 'TOTAL BILLINGS');
      const target = read(targetCol, 'TARGET');
      const achievement = read(achievementCol, 'ACHIEVEMENT');
      const txnParts = [c2gTxn.value ?? 0, btTxn.value ?? 0, balconTxn.value ?? 0];
      const volParts = [c2gVol.value ?? 0, btVol.value ?? 0, balconVol.value ?? 0];
      const grandTotalTxn = Math.max(0, Math.floor(totalTxn.value ?? txnParts.reduce((sum, value) => sum + value, 0)));
      const grandTotalVol = Math.max(0, Math.round(totalVol.value ?? volParts.reduce((sum, value) => sum + value, 0)));

      entries.push({
        name,
        rowIdx: r + 1,
        reportDate: new Date(period.year, period.month, 1),
        count: grandTotalTxn,
        volume: grandTotalVol,
        transmittals: grandTotalTxn,
        transmittedVolume: grandTotalVol,
        c2gTxn: Math.max(0, Math.floor(c2gTxn.value ?? 0)),
        c2gVol: Math.max(0, Math.round(c2gVol.value ?? 0)),
        btTxn: Math.max(0, Math.floor(btTxn.value ?? 0)),
        btVol: Math.max(0, Math.round(btVol.value ?? 0)),
        balconTxn: Math.max(0, Math.floor(balconTxn.value ?? 0)),
        balconVol: Math.max(0, Math.round(balconVol.value ?? 0)),
        grandTotalTxn,
        grandTotalVol,
        agentLevel: tierCol === undefined ? undefined : text(row[tierCol]) || undefined,
        monthlyGoal: target.value,
        monthlyActual: grandTotalVol,
        monthlyAchievement: achievement.value,
      });
    }
  }

  return entries.length || monthStarts.length ? { entries, invalidRows, warnings } : null;
}
