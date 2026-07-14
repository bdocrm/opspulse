import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import { matchMetricAlias, normalizeMetricHeader } from '@/lib/metric-import-mapping';
import { isBdoDashboardWorkbook, parseBdoDashboardWorkbook, type BdoImportRecord } from '@/lib/bdo-dashboard-import';
import { mapWorksheetCampaign } from '@/lib/campaign-import-selection';

type ParsedEntry = {
  name: string; count: number; volume: number;
  transmittals?: number; approvals?: number; booked?: number; activations?: number;
  transmittedVolume?: number; approvalsVolume?: number; bookedVolume?: number;
  ntb?: number; supplementary?: number; seatCategory?: string;
  agentLevel?: string; dateHired?: Date; agentType?: string;
  monthlyGoal?: number; monthlyActual?: number; monthlyAchievement?: number;
  overallGoal?: number; overallActual?: number; overallAchievement?: number;
  metricType?: string;
  sourceSheet?: string;
  campaignId?: string;
  campaignName?: string;
  reportDate?: Date;
  validationErrors?: string[];
  // MB PL wide-format per-category totals (transaction + volume)
  bauPayrollTxn?: number; bauPayrollVol?: number;
  bauDepositorTxn?: number; bauDepositorVol?: number;
  topupPayrollTxn?: number; topupPayrollVol?: number;
  topupDepositorTxn?: number; topupDepositorVol?: number;
  openMarketTxn?: number; openMarketVol?: number;
  // MB PA wide-format: TOTAL (C2G / BT / BalCon PA) + GRAND TOTAL
  c2gTxn?: number; c2gVol?: number;
  btTxn?: number; btVol?: number;
  balconTxn?: number; balconVol?: number;
  grandTotalTxn?: number; grandTotalVol?: number;
  rowIdx: number;
};

type AssignedCampaign = { id: string; campaignName: string };
type ReportPeriodType = 'daily' | 'monthly' | 'yearly';
type DuplicateMode = 'skip' | 'update' | 'replace_period';

type NormalizedMetric = {
  metricType: string;
  count?: number | null;
  volume?: number | null;
  goal?: number | null;
  actual?: number | null;
  achievement?: number | null;
};

function normalizePeriodDate(date: Date, periodType: ReportPeriodType) {
  if (periodType === 'monthly') return new Date(date.getFullYear(), date.getMonth(), 1);
  if (periodType === 'yearly') return new Date(date.getFullYear(), 0, 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function expandEntryMetrics(entry: ParsedEntry): NormalizedMetric[] {
  const metrics: NormalizedMetric[] = [];
  const countMetrics = [
    ['transmittals', entry.transmittals, entry.transmittedVolume],
    ['approvals', entry.approvals, entry.approvalsVolume],
    ['booked', entry.booked, entry.bookedVolume],
    ['activations', entry.activations, undefined],
  ] as const;
  for (const [metricType, count, metricVolume] of countMetrics) {
    if (count !== undefined || metricVolume !== undefined) metrics.push({ metricType, count: count ?? null, volume: metricVolume ?? null });
  }
  if (entry.ntb !== undefined) metrics.push({ metricType: 'ntb', count: entry.ntb });
  if (entry.supplementary !== undefined) metrics.push({ metricType: 'supplementary', count: entry.supplementary });
  if (entry.monthlyGoal !== undefined) metrics.push({ metricType: 'goal', goal: entry.monthlyGoal });
  if (entry.monthlyActual !== undefined) metrics.push({ metricType: 'actual', actual: entry.monthlyActual });
  if (entry.monthlyAchievement !== undefined) metrics.push({ metricType: 'achievement', achievement: entry.monthlyAchievement });
  if (!metrics.length) metrics.push({ metricType: entry.metricType || 'transmittals', count: entry.count, volume: entry.volume });
  if (metrics.length === 1 && metrics[0].volume == null && entry.volume) metrics[0].volume = entry.volume;
  return metrics;
}

type SheetPreview = {
  key: string;
  sheetName: string;
  hidden: boolean;
  selected: boolean;
  format: string;
  campaignId: string;
  campaignName: string;
  campaignMapping: 'sheet' | 'record' | 'selected' | 'unresolved';
  metricType: string;
  metricSource: 'sheet' | 'selected';
  reportDate: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  warnings: string[];
  errors: string[];
  matched: any[];
  notFound: any[];
  entries: ParsedEntry[];
};

async function ensureImportMetadataColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionEntry"
      ADD COLUMN IF NOT EXISTS "importFileName" TEXT,
      ADD COLUMN IF NOT EXISTS "importMetricType" TEXT,
      ADD COLUMN IF NOT EXISTS "importWorkbookSheets" TEXT,
      ADD COLUMN IF NOT EXISTS "importAuditLog" JSONB,
      ADD COLUMN IF NOT EXISTS "reportPeriodType" TEXT NOT NULL DEFAULT 'daily';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionDetail"
      ADD COLUMN IF NOT EXISTS "transmittedVolume" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "approvalsVolume" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "bookedVolume" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "sourceSheet" TEXT,
      ADD COLUMN IF NOT EXISTS "agentLevel" TEXT,
      ADD COLUMN IF NOT EXISTS "dateHired" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "agentType" TEXT,
      ADD COLUMN IF NOT EXISTS "monthlyGoal" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "monthlyActual" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "monthlyAchievement" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "overallGoal" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "overallActual" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "overallAchievement" DOUBLE PRECISION;
  `);
}

async function saveImportMetadata(entryId: string, fileName: string, metricType: string, sheetNames?: string[], auditLog?: any, db: any = prisma) {
  await db.$executeRaw`
    UPDATE "ProductionEntry"
    SET "importFileName" = ${fileName},
        "importMetricType" = ${metricType},
        "importWorkbookSheets" = ${sheetNames?.join(', ') || null},
        "importAuditLog" = ${auditLog ? JSON.stringify(auditLog) : null}::jsonb
    WHERE id = ${entryId}
  `;
}

function formatImportSummary(row: any) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    fileName: row.importFileName || 'Imported production data',
    metricType: row.importMetricType || 'unknown',
    reportDate: row.date,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    importedAt: row.createdAt,
    entryTime: row.time,
    detailCount: Number(row.detailCount || 0),
    totals: {
      transmittals: Number(row.transmittals || 0),
      approvals: Number(row.approvals || 0),
      booked: Number(row.booked || 0),
      volume: Number(row.volume || 0),
      ntb: Number(row.ntb || 0),
      supplementary: Number(row.supplementary || 0),
    },
  };
}

async function getImportSummary(entryId: string, collectorId: string) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT pe.id,
           pe."campaignId",
           c."campaignName",
           pe.date,
           pe.time,
           pe."periodStart",
           pe."periodEnd",
           pe."createdAt",
           pe."importFileName",
           pe."importMetricType",
           COUNT(pd.id) AS "detailCount",
           COALESCE(SUM(pd.transmittals), 0) AS transmittals,
           COALESCE(SUM(pd.approvals), 0) AS approvals,
           COALESCE(SUM(pd.booked), 0) AS booked,
           COALESCE(SUM(pd.volume), 0) AS volume,
           COALESCE(SUM(pd.ntb), 0) AS ntb,
           COALESCE(SUM(pd.supplementary), 0) AS supplementary
    FROM "ProductionEntry" pe
    JOIN "Campaign" c ON c.id = pe."campaignId"
    LEFT JOIN "ProductionDetail" pd ON pd."productionEntryId" = pe.id
    WHERE pe.id = ${entryId}
      AND pe."createdBy" = ${collectorId}
    GROUP BY pe.id, c."campaignName"
    LIMIT 1
  `;

  return rows[0] ? formatImportSummary(rows[0]) : null;
}

// Parse BPI PA / ACQ raw Excel rows. Supports three layouts:
//   1. Simple template: FULL NAME | COUNT/metric | VOLUME
//   2. BPI wide report:  AGENT CODE | LAST NAME | FIRST NAME | repeating TRANSACTION/VOLUME pairs
//      (per category: BAU Payroll, Depositor, Top Up, Open Market, …)
//   3. ACQ report:       AGENT CODE | LAST NAME | FIRST NAME | DATE ONBOARD | SEAT CATEGORY |
//      TOTAL + repeating NTB/SUPPLEMENTARY pairs per date
function parseExcelRows(rows: any[], metricType: string, campaignName = ''): ParsedEntry[] {
  const isMbPa = /\bmb pa\b/i.test(campaignName);
  let nameCol  = 1;
  let countCol = 3;
  let volumeCol = 4;
  let transmittalsCol = -1;
  let approvalsCol = -1;
  let bookedCol = -1;
  let activationsCol = -1;

  // Wide/ACQ-format markers
  let lastNameCol = -1;
  let firstNameCol = -1;
  let seatCategoryCol = -1;
  const transactionCols: number[] = [];
  const volumeCols: number[] = [];
  const ntbCols: number[] = [];
  const suppleCols: number[] = [];

  // Headers can span several rows (labels like TRANSACTION/VOLUME/NTB sit on a lower row)
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const row = rows[i] || [];
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim();
      if (!cell) continue;
      if (cell.includes('full name')) nameCol = j;
      if (cell.includes('last name')) lastNameCol = j;
      if (cell.includes('first name')) firstNameCol = j;
      if (cell.includes('seat cat')) seatCategoryCol = j;
      if (cell === 'count') countCol = j;
      if (cell === 'volume') { volumeCol = j; if (!volumeCols.includes(j)) volumeCols.push(j); }
      if (cell === 'transaction' && !transactionCols.includes(j)) transactionCols.push(j);
      if (cell === 'ntb' && !ntbCols.includes(j)) ntbCols.push(j);
      if (cell.includes('supple') && !suppleCols.includes(j)) suppleCols.push(j);
      if (cell === 'transmitted') transmittalsCol = j;
      if (cell === 'approvals') approvalsCol = j;
      if (cell === 'booked') bookedCol = j;
      if (cell === 'activation' || cell === 'activations' || cell === 'activated') activationsCol = j;
    }
  }

  // ─── ACQ FORMAT ─────────────────────────────────────────────────────────────
  // Name from LAST + FIRST; detect SEAT CATEGORY and take the HIGHEST NTB and
  // HIGHEST SUPPLEMENTARY across all columns (the TOTAL column is the max).
  if (lastNameCol >= 0 && firstNameCol >= 0 && ntbCols.length > 0) {
    ntbCols.sort((a, b) => a - b);
    suppleCols.sort((a, b) => a - b);

    let dataStartRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i]?.[lastNameCol] || '').trim().toLowerCase();
      if (v && v !== 'last name') { dataStartRow = i; break; }
    }
    if (dataStartRow < 0) return [];

    const entries: ParsedEntry[] = [];
    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const last = String(row[lastNameCol] || '').trim();
      const first = String(row[firstNameCol] || '').trim();
      if (!last || !first) continue; // skips the TOTAL row and any blank rows
      const name = `${last}, ${first}`.toUpperCase();
      const seatCategory = seatCategoryCol >= 0 ? String(row[seatCategoryCol] || '').trim() : '';

      let ntb = 0;
      for (const c of ntbCols) ntb = Math.max(ntb, Math.floor(Number(row[c]) || 0));
      let supplementary = 0;
      for (const c of suppleCols) supplementary = Math.max(supplementary, Math.floor(Number(row[c]) || 0));

      entries.push({ name, count: ntb, volume: 0, ntb, supplementary, seatCategory, rowIdx: i + 1 });
    }
    return entries;
  }

  // ─── WIDE FORMAT ────────────────────────────────────────────────────────────
  // Name comes from LAST NAME + FIRST NAME; per the report each agent has many
  // TRANSACTION/VOLUME pairs across categories, so we take the HIGHEST of each.
  if (lastNameCol >= 0 && firstNameCol >= 0 && transactionCols.length > 0) {
    transactionCols.sort((a, b) => a - b);
    volumeCols.sort((a, b) => a - b);

    // First data row = first row with a real last name (not the header word)
    let dataStartRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i]?.[lastNameCol] || '').trim().toLowerCase();
      if (v && v !== 'last name') { dataStartRow = i; break; }
    }
    if (dataStartRow < 0) return [];

    const entries: ParsedEntry[] = [];
    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const last = String(row[lastNameCol] || '').trim();
      const first = String(row[firstNameCol] || '').trim();
      if (!last || !first) continue; // skips the TOTAL row and any blank rows
      const name = `${last}, ${first}`.toUpperCase();

      let maxTx = 0;
      for (const c of transactionCols) maxTx = Math.max(maxTx, Math.floor(Number(row[c]) || 0));
      let maxVol = 0;
      for (const c of volumeCols) maxVol = Math.max(maxVol, Math.round(Number(row[c]) || 0));

      const txn = (i2: number) => { const c = transactionCols[i2]; return c !== undefined ? Math.max(0, Math.floor(Number(row[c]) || 0)) : 0; };
      const vol = (i2: number) => { const c = volumeCols[i2]; return c !== undefined ? Math.max(0, Math.round(Number(row[c]) || 0)) : 0; };
      // MB PA: first pairs are TOTAL(C2G, BT, BalCon PA) then GRAND TOTAL.
      // MB PL / BPI: first five pairs are BAU Payroll/Depositor, Top Up Payroll/Depositor, Open Market.
      const categories = isMbPa
        ? {
            c2gTxn: txn(0), c2gVol: vol(0),
            btTxn: txn(1), btVol: vol(1),
            balconTxn: txn(2), balconVol: vol(2),
            // Grand Total = sum of the three categories (the file's own grand-total
            // column isn't reliably positioned, so we derive it).
            grandTotalTxn: txn(0) + txn(1) + txn(2),
            grandTotalVol: vol(0) + vol(1) + vol(2),
          }
        : {
            bauPayrollTxn: txn(0), bauPayrollVol: vol(0),
            bauDepositorTxn: txn(1), bauDepositorVol: vol(1),
            topupPayrollTxn: txn(2), topupPayrollVol: vol(2),
            topupDepositorTxn: txn(3), topupDepositorVol: vol(3),
            openMarketTxn: txn(4), openMarketVol: vol(4),
          };

      if (metricType === 'all_metrics') {
        entries.push({ name, count: maxTx, volume: maxVol, transmittals: maxTx, approvals: 0, booked: 0, ...categories, rowIdx: i + 1 });
      } else {
        entries.push({ name, count: maxTx, volume: maxVol, ...categories, rowIdx: i + 1 });
      }
    }
    return entries;
  }

  // ─── SIMPLE TEMPLATE ────────────────────────────────────────────────────────
  // First data row = first row where col 0 is a number
  let dataStartRow = 2;
  for (let i = 0; i < rows.length; i++) {
    if (typeof rows[i][0] === 'number') {
      dataStartRow = i;
      break;
    }
  }

  const entries: ParsedEntry[] = [];
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const agentName = row[nameCol];
    if (!agentName || !String(agentName).trim()) continue;
    if (row[0] !== null && row[0] !== undefined && typeof row[0] !== 'number') continue;

    const volume = Math.max(0, Math.round(Number(row[volumeCol]) || 0));

    if (metricType === 'all_metrics') {
      // Try to read all three metrics from separate columns
      let transmittals = transmittalsCol >= 0 ? Math.max(0, Math.floor(Number(row[transmittalsCol]) || 0)) : 0;
      let approvals = approvalsCol >= 0 ? Math.max(0, Math.floor(Number(row[approvalsCol]) || 0)) : 0;
      let booked = bookedCol >= 0 ? Math.max(0, Math.floor(Number(row[bookedCol]) || 0)) : 0;
      let activations = activationsCol >= 0 ? Math.max(0, Math.floor(Number(row[activationsCol]) || 0)) : 0;

      // Fallback: if individual metric columns not found but COUNT column exists, use COUNT for transmittals
      if (transmittalsCol < 0 && approvalsCol < 0 && bookedCol < 0 && activationsCol < 0 && countCol >= 0) {
        transmittals = Math.max(0, Math.floor(Number(row[countCol]) || 0));
      }

      entries.push({
        name: String(agentName).trim(), count: transmittals, volume,
        transmittals: transmittalsCol >= 0 || (transmittalsCol < 0 && approvalsCol < 0 && bookedCol < 0 && activationsCol < 0) ? transmittals : undefined,
        approvals: approvalsCol >= 0 ? approvals : undefined,
        booked: bookedCol >= 0 ? booked : undefined,
        activations: activationsCol >= 0 ? activations : undefined,
        rowIdx: i + 1,
      });
    } else {
      // Single COUNT column
      const count = Math.max(0, Math.floor(Number(row[countCol]) || 0));
      entries.push({ name: String(agentName).trim(), count, volume, rowIdx: i + 1 });
    }
  }
  return entries;
}

function nameToEmail(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${slug}-${Date.now()}@imported.local`;
}

function normalizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function agentNameMatches(savedName: string, importedName: string): boolean {
  const saved = normalizeAgentName(savedName);
  const imported = normalizeAgentName(importedName);
  if (!saved || !imported) return false;
  if (saved === imported || saved.includes(imported) || imported.includes(saved)) return true;
  const importedTokens = imported.split(' ').filter((token) => token.length > 1);
  return importedTokens.length > 0 && importedTokens.every((token) => saved.includes(token));
}

function normalizeHeader(value: any): string {
  return normalizeMetricHeader(String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));
}

function cellText(value: any): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function parseNumberSafe(value: any): { value: number; error?: string } {
  if (value == null || value === '') return { value: 0 };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value: 0, error: 'Invalid number' };
    if (value < 0) return { value: 0, error: 'Negative values are not allowed' };
    return { value };
  }
  if (/^(?:-|n\/?a|none|null)$/i.test(String(value).trim())) return { value: 0 };
  const cleaned = String(value).replace(/[₱,$\s]/g, '').replace(/[()]/g, '-').trim();
  if (!cleaned) return { value: 0 };
  const parsed = Number(cleaned.replace(/%$/, '')) / (cleaned.endsWith('%') ? 100 : 1);
  if (!Number.isFinite(parsed)) return { value: 0, error: `Invalid number "${String(value).slice(0, 30)}"` };
  if (parsed < 0) return { value: 0, error: 'Negative values are not allowed' };
  return { value: parsed };
}

function isFooterOrBlankName(value: string) {
  const normalized = normalizeHeader(value);
  return !normalized || ['total', 'grand total', 'subtotal', 'summary', 'overall'].some((word) => normalized === word || normalized.startsWith(`${word} `));
}

function findHeaderAlias(rows: any[][], aliases: string[], maxRows = 20): { row: number; col: number } | null {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const value = normalizeHeader(row[c]);
      if (normalizedAliases.some((alias) => value === alias || value.includes(alias))) return { row: r, col: c };
    }
  }
  return null;
}

function detectMetricFromText(text: string, fallback: string) {
  const alias = matchMetricAlias(text);
  if (alias === 'approvals' || alias === 'booked' || alias === 'transmittals' || alias === 'activations') return alias;
  const normalized = normalizeHeader(text);
  if (/\bntb\b|\bsupplementary\b|\bacq\b/.test(normalized)) return 'acq';
  if (/\ball metrics\b/.test(normalized)) return 'all_metrics';
  return fallback;
}

function parseReportDateFromRows(rows: any[][], fallback: Date, context = ''): Date {
  const min = new Date(2020, 0, 1).getTime();
  const max = new Date(2035, 11, 31).getTime();
  const contextualDate = parseDetectedDate(context, fallback);
  if (contextualDate && contextualDate.getTime() >= min && contextualDate.getTime() <= max) return contextualDate;
  for (const row of rows.slice(0, 20)) {
    for (const cell of row || []) {
      const candidate = parseDetectedDate(cell, fallback);
      if (candidate && candidate.getTime() >= min && candidate.getTime() <= max) {
        return new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
      }
    }
  }
  return fallback;
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rowHasAnyValue(row: any[]) {
  return (row || []).some((cell) => cell != null && String(cell).trim() !== '');
}

const MONTH_INDEX = new Map([
  ['january', 0], ['february', 1], ['march', 2], ['april', 3], ['may', 4], ['june', 5],
  ['july', 6], ['august', 7], ['september', 8], ['october', 9], ['november', 10], ['december', 11],
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['jun', 5], ['jul', 6], ['aug', 7],
  ['sep', 8], ['sept', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthIndexFromText(value: any): number | undefined {
  const text = normalizeHeader(value);
  if (!text) return undefined;
  for (const token of text.split(/\s+/)) {
    const month = MONTH_INDEX.get(token);
    if (month !== undefined) return month;
  }
  return undefined;
}

function yearFromText(value: any): number | undefined {
  const match = cellText(value).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function parseCellDate(value: any): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && value > 30000 && value < 60000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function parseDetectedDate(value: any, fallback: Date): Date | undefined {
  if (value == null || value === '') return undefined;
  const month = monthIndexFromText(value);
  if (month !== undefined) return new Date(yearFromText(value) || fallback.getFullYear(), month, 1);
  const parsed = parseCellDate(value);
  return parsed ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) : undefined;
}

function findDateHeader(rows: any[][], maxRows = 30): { row: number; col: number } | null {
  const aliases = new Set(['date', 'report date', 'reporting date', 'month', 'report month', 'reporting month', 'period', 'reporting period']);
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      if (aliases.has(normalizeHeader(rows[r][c]))) return { row: r, col: c };
    }
  }
  return null;
}

function detectedSectionDate(row: any[], fallback: Date): Date | undefined {
  const populated = (row || []).filter((cell) => cell != null && cellText(cell) !== '');
  if (!populated.length || populated.length > 3) return undefined;
  const combined = populated.map(cellText).join(' ');
  return monthIndexFromText(combined) !== undefined ? parseDetectedDate(combined, fallback) : undefined;
}

function detectDatesByRow(rows: any[][], fallback: Date, dateCol?: number) {
  const dates = new Map<number, Date>();
  let activeDate = fallback;
  for (let r = 0; r < rows.length; r++) {
    const sectionDate = detectedSectionDate(rows[r] || [], activeDate);
    if (sectionDate) {
      activeDate = sectionDate;
      continue;
    }
    dates.set(r + 1, dateCol === undefined ? activeDate : parseDetectedDate(rows[r]?.[dateCol], activeDate) || activeDate);
  }
  return dates;
}

// Dashboard workbooks use merged month/metric headers. Build a logical header
// for every column by carrying the last month and parent metric to child columns.
function parseMonthlyAgentRows(rows: any[][], sheetName: string, campaignName: string, fallbackDate: Date) {
  const monthHits: Array<{ row: number; col: number; month: number; year?: number }> = [];
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const value = rows[r][c];
      const month = monthIndexFromText(value);
      if (month !== undefined) monthHits.push({ row: r, col: c, month, year: yearFromText(value) });
    }
  }
  if (!monthHits.length) return null;

  let headerRow = -1;
  let nameCol = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = (rows[r] || []).map(normalizeHeader);
    const candidate = cells.findIndex((value) => ['agent', 'agent name', 'name', 'full name'].includes(value));
    if (candidate >= 0) { headerRow = r; nameCol = candidate; break; }
  }
  if (headerRow < 0 || nameCol < 0) return null;

  let dataStartRow = -1;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const value = cellText(rows[r]?.[nameCol]);
    if (value && !['agent', 'agent name', 'name', 'full name'].includes(normalizeHeader(value))) { dataStartRow = r; break; }
  }
  if (dataStartRow < 0) return null;
  const lastHeaderRow = dataStartRow - 1;
  const headerMonthHits = monthHits.filter((hit) => hit.row <= lastHeaderRow);
  if (!headerMonthHits.length) return null;
  const maxCols = Math.max(0, ...rows.slice(0, lastHeaderRow + 1).map((row) => row.length));
  const sortedMonths = headerMonthHits.sort((a, b) => a.col - b.col || a.row - b.row);
  const columns: Array<{ col: number; month: number; metric?: string; field: string }> = [];
  let currentMetric = '';
  for (let c = 0; c < maxCols; c++) {
    const monthHit = [...sortedMonths].reverse().find((hit) => hit.col <= c);
    if (!monthHit || c === nameCol) continue;
    const labels = rows.slice(0, lastHeaderRow + 1).map((row) => normalizeHeader(row[c])).filter(Boolean);
    const text = labels.join(' ');
    const parent = /transmitted|transmittal/.test(text) ? 'transmittals' : /approval/.test(text) ? 'approvals' : /booked|booking/.test(text) ? 'booked' : /activation|activated/.test(text) ? 'activations' : '';
    if (parent) currentMetric = parent;
    const field = /achievement|achieve/.test(text) ? 'achievement'
      : /actual/.test(text) ? 'actual'
      : /goal|target/.test(text) ? 'goal'
      : /volume|amount/.test(text) ? 'volume'
      : /count|transaction/.test(text) ? 'count' : '';
    if (field) columns.push({ col: c, month: monthHit.month, metric: parent || currentMetric || undefined, field });
  }
  if (!columns.length) return null;

  const explicitYear = rows.slice(0, dataStartRow).flat().map(cellText).find((value) => /^20\d{2}$/.test(value));
  const year = Number(explicitYear) || fallbackDate.getFullYear();
  const levelHit = findHeaderAlias(rows, ['level'], 30);
  const dateHiredHit = findHeaderAlias(rows, ['date hired', 'date onboard'], 30);
  const typeHit = findHeaderAlias(rows, ['type', 'status'], 30);
  const entries: ParsedEntry[] = [];
  let invalidRows = 0;
  const warnings: string[] = [];

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = cellText(row[nameCol]);
    if (!name || isFooterOrBlankName(name) || /rank|average/i.test(name)) continue;
    for (const month of [...new Set(columns.map((column) => column.month))].sort((a, b) => a - b)) {
      const values = columns.filter((column) => column.month === month);
      const hasMetric = (metric: string) => values.some((item) => item.metric === metric);
      const get = (field: string, metric?: string) => {
        const column = values.find((item) => item.field === field && (!metric || item.metric === metric));
        return column ? parseNumberSafe(row[column.col]) : { value: 0 };
      };
      const parsed = values.map((column) => parseNumberSafe(row[column.col]));
      const errors = parsed.flatMap((item) => item.error ? [item.error] : []);
      if (errors.length) { invalidRows++; warnings.push(`Row ${r + 1}: ${errors.join(', ')}`); continue; }
      const txCount = get('count', 'transmittals').value;
      const approvalCount = get('count', 'approvals').value;
      const bookedCount = get('count', 'booked').value;
      const activationCount = get('count', 'activations').value;
      const txVolume = get('volume', 'transmittals').value;
      const approvalVolume = get('volume', 'approvals').value;
      const bookedVolume = get('volume', 'booked').value;
      const actual = get('actual').value;
      if (![txCount, approvalCount, bookedCount, activationCount, txVolume, approvalVolume, bookedVolume, actual, get('goal').value].some((value) => value !== 0)) continue;
      entries.push({
        name, rowIdx: r + 1, sourceSheet: sheetName, campaignName,
        reportDate: new Date([...sortedMonths].reverse().find((hit) => hit.month === month)?.year || year, month, 1), metricType: 'all_metrics',
        count: Math.floor(txCount), volume: Math.round(actual || txVolume || approvalVolume || bookedVolume),
        transmittals: hasMetric('transmittals') ? Math.floor(txCount) : undefined,
        approvals: hasMetric('approvals') ? Math.floor(approvalCount) : undefined,
        booked: hasMetric('booked') ? Math.floor(bookedCount) : undefined,
        activations: hasMetric('activations') ? Math.floor(activationCount) : undefined,
        transmittedVolume: hasMetric('transmittals') ? Math.round(txVolume) : undefined,
        approvalsVolume: hasMetric('approvals') ? Math.round(approvalVolume) : undefined,
        bookedVolume: hasMetric('booked') ? Math.round(bookedVolume) : undefined,
        agentLevel: levelHit ? cellText(row[levelHit.col]) : undefined,
        dateHired: dateHiredHit ? parseCellDate(row[dateHiredHit.col]) : undefined,
        agentType: typeHit ? cellText(row[typeHit.col]) : undefined,
        monthlyGoal: get('goal').value, monthlyActual: actual, monthlyAchievement: get('achievement').value,
      });
    }
  }
  return { format: 'Monthly Dashboard', entries, invalidRows, warnings, errors: [] as string[] };
}

function parseDetectedRows(rows: any[][], metricType: string, campaignName: string, sheetName: string, reportDate: Date): {
  format: string;
  entries: ParsedEntry[];
  invalidRows: number;
  warnings: string[];
  errors: string[];
} {
  const monthly = parseMonthlyAgentRows(rows, sheetName, campaignName, reportDate);
  if (monthly?.entries.length) return monthly;
  const warnings: string[] = [];
  const errors: string[] = [];
  const nameHit = findHeaderAlias(rows, ['full name', 'agent name']);
  const lastHit = findHeaderAlias(rows, ['last name']);
  const firstHit = findHeaderAlias(rows, ['first name']);
  const countHit = findHeaderAlias(rows, ['count']);
  const volumeHit = findHeaderAlias(rows, ['volume', 'total volume']);
  const transmittedHit = findHeaderAlias(rows, ['transmitted', 'transmittals', 'transmittal']);
  const approvalsHit = findHeaderAlias(rows, ['approval', 'approvals']);
  const bookedHit = findHeaderAlias(rows, ['booked', 'booking']);
  const activationsHit = findHeaderAlias(rows, ['activation', 'activations', 'activated']);
  const transmittedCountHit = findHeaderAlias(rows, ['transmitted count', 'transmittal count']);
  const approvalCountHit = findHeaderAlias(rows, ['approval count', 'approved count']);
  const bookedCountHit = findHeaderAlias(rows, ['booked count', 'booking count']);
  const activationCountHit = findHeaderAlias(rows, ['activation count', 'activated count']);
  const transmittedVolumeHit = findHeaderAlias(rows, ['transmitted volume', 'transmittal volume']);
  const approvalVolumeHit = findHeaderAlias(rows, ['approval volume', 'approved volume']);
  const bookedVolumeHit = findHeaderAlias(rows, ['booked volume', 'booking volume']);
  const goalHit = findHeaderAlias(rows, ['goal', 'target']);
  const actualHit = findHeaderAlias(rows, ['actual', 'performance']);
  const achievementHit = findHeaderAlias(rows, ['achievement', 'attainment']);
  const ntbHit = findHeaderAlias(rows, ['ntb']);
  const suppHit = findHeaderAlias(rows, ['supplementary', 'supplemental']);
  const dateHit = findDateHeader(rows);
  const agentCodeHit = findHeaderAlias(rows, ['agent code']);
  const seatHit = findHeaderAlias(rows, ['seat category', 'seat cat']);

  const isAcq = Boolean(agentCodeHit && lastHit && firstHit && (ntbHit || suppHit));
  const isAllMetrics = Boolean(nameHit && (transmittedHit || approvalsHit || bookedHit || activationsHit || goalHit || actualHit || achievementHit || ntbHit || suppHit));
  const isSingleMetric = Boolean(nameHit && (countHit || volumeHit || transmittedHit || approvalsHit || bookedHit || activationsHit || goalHit || actualHit || achievementHit || ntbHit || suppHit));

  if (!isAcq && !isAllMetrics && !isSingleMetric) {
    return { format: 'Unsupported', entries: [], invalidRows: 0, warnings, errors: ['Supported headers were not found.'] };
  }

  if (isAcq || (lastHit && firstHit && (ntbHit || suppHit))) {
    const datesByRow = detectDatesByRow(rows, reportDate, dateHit?.col);
    const parsed = parseExcelRows(rows, 'acq', campaignName);
    const entries = parsed
      .filter((entry) => !isFooterOrBlankName(entry.name))
      .map((entry) => ({ ...entry, metricType: 'acq', sourceSheet: sheetName, campaignName, reportDate: datesByRow.get(entry.rowIdx) || reportDate }));
    return { format: 'ACQ', entries, invalidRows: Math.max(0, parsed.length - entries.length), warnings, errors };
  }

  const headerRow = Math.max(nameHit?.row ?? 0, countHit?.row ?? 0, transmittedHit?.row ?? 0, approvalsHit?.row ?? 0, bookedHit?.row ?? 0, activationsHit?.row ?? 0, goalHit?.row ?? 0, actualHit?.row ?? 0, achievementHit?.row ?? 0, ntbHit?.row ?? 0, suppHit?.row ?? 0, volumeHit?.row ?? 0, dateHit?.row ?? 0);
  const nameCol = nameHit?.col ?? 1;
  const metric = isAllMetrics ? 'all_metrics' : detectMetricFromText(`${sheetName} ${(rows[headerRow] || []).join(' ')}`, metricType);
  const entries: ParsedEntry[] = [];
  let invalidRows = 0;
  const seenHeaderRows = new Set<string>();
  let activeSectionDate = reportDate;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!rowHasAnyValue(row)) continue;
    const sectionDate = detectedSectionDate(row, activeSectionDate);
    if (sectionDate) {
      activeSectionDate = sectionDate;
      continue;
    }
    const normalizedRow = row.map(normalizeHeader).join('|');
    if (seenHeaderRows.has(normalizedRow) || normalizedRow.includes('full name') || normalizedRow.includes('agent name')) {
      seenHeaderRows.add(normalizedRow);
      continue;
    }
    const rawName = cellText(row[nameCol]);
    if (isFooterOrBlankName(rawName)) continue;

    const rowErrors: string[] = [];
    const volume = parseNumberSafe(row[volumeHit?.col ?? 4]);
    if (volume.error) rowErrors.push(volume.error);
    const count = parseNumberSafe(row[countHit?.col ?? transmittedHit?.col ?? approvalsHit?.col ?? bookedHit?.col ?? activationsHit?.col ?? 3]);
    if (count.error) rowErrors.push(count.error);
    const transmittals = parseNumberSafe(row[transmittedCountHit?.col ?? transmittedHit?.col ?? -1]);
    const approvals = parseNumberSafe(row[approvalCountHit?.col ?? approvalsHit?.col ?? -1]);
    const booked = parseNumberSafe(row[bookedCountHit?.col ?? bookedHit?.col ?? -1]);
    const activations = parseNumberSafe(row[activationCountHit?.col ?? activationsHit?.col ?? -1]);
    const transmittedVolume = parseNumberSafe(row[transmittedVolumeHit?.col ?? -1]);
    const approvalVolume = parseNumberSafe(row[approvalVolumeHit?.col ?? -1]);
    const bookedVolume = parseNumberSafe(row[bookedVolumeHit?.col ?? -1]);
    const goal = parseNumberSafe(row[goalHit?.col ?? -1]);
    const actual = parseNumberSafe(row[actualHit?.col ?? -1]);
    const achievement = parseNumberSafe(row[achievementHit?.col ?? -1]);
    const ntb = parseNumberSafe(row[ntbHit?.col ?? -1]);
    const supplementary = parseNumberSafe(row[suppHit?.col ?? -1]);
    for (const parsed of [transmittals, approvals, booked, activations, transmittedVolume, approvalVolume, bookedVolume, goal, actual, achievement, ntb, supplementary]) if (parsed.error) rowErrors.push(parsed.error);

    if (rowErrors.length > 0) {
      invalidRows++;
      warnings.push(`Row ${i + 1}: ${rowErrors.join(', ')}`);
      continue;
    }

    const detectedRowDate = dateHit ? parseDetectedDate(row[dateHit.col], activeSectionDate) : undefined;
    entries.push({
      name: rawName,
      count: Math.floor(metric === 'approvals' ? approvals.value || count.value : metric === 'booked' ? booked.value || count.value : transmittals.value || count.value),
      volume: Math.round(volume.value),
      transmittals: isAllMetrics && transmittedHit ? Math.floor(transmittals.value) : undefined,
      approvals: isAllMetrics && approvalsHit ? Math.floor(approvals.value) : undefined,
      booked: isAllMetrics && bookedHit ? Math.floor(booked.value) : undefined,
      activations: isAllMetrics && activationsHit ? Math.floor(activations.value) : undefined,
      transmittedVolume: transmittedVolumeHit ? Math.round(transmittedVolume.value) : undefined,
      approvalsVolume: approvalVolumeHit ? Math.round(approvalVolume.value) : undefined,
      bookedVolume: bookedVolumeHit ? Math.round(bookedVolume.value) : undefined,
      ntb: ntbHit ? Math.floor(ntb.value) : undefined,
      supplementary: suppHit ? Math.floor(supplementary.value) : undefined,
      monthlyGoal: goalHit ? goal.value : undefined,
      monthlyActual: actualHit ? actual.value : undefined,
      monthlyAchievement: achievementHit ? achievement.value : undefined,
      metricType: metric,
      sourceSheet: sheetName,
      campaignName,
      reportDate: detectedRowDate || activeSectionDate,
      rowIdx: i + 1,
    });
  }

  return {
    format: isAllMetrics ? 'All Metrics' : 'Single Metric',
    entries,
    invalidRows,
    warnings,
    errors,
  };
}

// Build the ProductionDetail write payload from a parsed row, mapping the
// selected metric plus any ACQ fields (NTB / supplementary / seat category).
function buildDetailData(row: ParsedEntry, metricType: string): Record<string, any> {
  const data: Record<string, any> = {
    transmittals: BigInt(0),
    approvals: BigInt(0),
    booked: BigInt(0),
    volume: BigInt(row.volume),
  };
  if (metricType === 'transmittals') data.transmittals = BigInt(row.count);
  else if (metricType === 'approvals') data.approvals = BigInt(row.count);
  else if (metricType === 'booked') data.booked = BigInt(row.count);
  else if (metricType === 'activations') data.activations = BigInt(row.count);
  else if (metricType === 'all_metrics') {
    data.transmittals = BigInt(row.transmittals || 0);
    data.approvals = BigInt(row.approvals || 0);
    data.booked = BigInt(row.booked || 0);
    data.activations = BigInt(row.activations || 0);
  }
  // ACQ acquisition metrics
  if (row.ntb !== undefined) data.ntb = BigInt(row.ntb || 0);
  if (row.supplementary !== undefined) data.supplementary = BigInt(row.supplementary || 0);
  if (row.seatCategory) data.seatCategory = row.seatCategory;
  if (row.sourceSheet) data.sourceSheet = row.sourceSheet;
  if (row.agentLevel) data.agentLevel = row.agentLevel;
  if (row.dateHired) data.dateHired = row.dateHired;
  if (row.agentType) data.agentType = row.agentType;
  if (row.monthlyGoal !== undefined) data.monthlyGoal = row.monthlyGoal;
  if (row.monthlyActual !== undefined) data.monthlyActual = row.monthlyActual;
  if (row.monthlyAchievement !== undefined) data.monthlyAchievement = row.monthlyAchievement;
  if (row.overallGoal !== undefined) data.overallGoal = row.overallGoal;
  if (row.overallActual !== undefined) data.overallActual = row.overallActual;
  if (row.overallAchievement !== undefined) data.overallAchievement = row.overallAchievement;
  if (row.transmittedVolume !== undefined) data.transmittedVolume = BigInt(row.transmittedVolume || 0);
  if (row.approvalsVolume !== undefined) data.approvalsVolume = BigInt(row.approvalsVolume || 0);
  if (row.bookedVolume !== undefined) data.bookedVolume = BigInt(row.bookedVolume || 0);
  // MB PL wide-format per-category totals
  if (row.bauPayrollTxn !== undefined) {
    data.bauPayrollTxn = BigInt(row.bauPayrollTxn || 0);
    data.bauPayrollVol = BigInt(row.bauPayrollVol || 0);
    data.bauDepositorTxn = BigInt(row.bauDepositorTxn || 0);
    data.bauDepositorVol = BigInt(row.bauDepositorVol || 0);
    data.topupPayrollTxn = BigInt(row.topupPayrollTxn || 0);
    data.topupPayrollVol = BigInt(row.topupPayrollVol || 0);
    data.topupDepositorTxn = BigInt(row.topupDepositorTxn || 0);
    data.topupDepositorVol = BigInt(row.topupDepositorVol || 0);
    data.openMarketTxn = BigInt(row.openMarketTxn || 0);
    data.openMarketVol = BigInt(row.openMarketVol || 0);
  }
  // MB PA wide-format per-category totals
  if (row.c2gTxn !== undefined) {
    data.c2gTxn = BigInt(row.c2gTxn || 0);
    data.c2gVol = BigInt(row.c2gVol || 0);
    data.btTxn = BigInt(row.btTxn || 0);
    data.btVol = BigInt(row.btVol || 0);
    data.balconTxn = BigInt(row.balconTxn || 0);
    data.balconVol = BigInt(row.balconVol || 0);
    data.grandTotalTxn = BigInt(row.grandTotalTxn || 0);
    data.grandTotalVol = BigInt(row.grandTotalVol || 0);
  }
  return data;
}

function buildDetailDataForWrite(row: ParsedEntry, metricType: string, partial = false): Record<string, any> {
  const effectiveMetric = row.metricType || metricType;
  const data: Record<string, any> = partial ? {} : {
    transmittals: BigInt(0),
    approvals: BigInt(0),
    booked: BigInt(0),
    volume: BigInt(0),
  };

  if (!partial || row.volume !== undefined) data.volume = BigInt(Math.round(row.volume || 0));
  if (effectiveMetric === 'transmittals') data.transmittals = BigInt(row.count || 0);
  else if (effectiveMetric === 'approvals') data.approvals = BigInt(row.count || 0);
  else if (effectiveMetric === 'booked') data.booked = BigInt(row.count || 0);
  else if (effectiveMetric === 'activations') data.activations = BigInt(row.count || 0);
  else if (effectiveMetric === 'all_metrics') {
    data.transmittals = BigInt(row.transmittals || 0);
    data.approvals = BigInt(row.approvals || 0);
    data.booked = BigInt(row.booked || 0);
    data.activations = BigInt(row.activations || 0);
  }
  if (row.ntb !== undefined) data.ntb = BigInt(row.ntb || 0);
  if (row.supplementary !== undefined) data.supplementary = BigInt(row.supplementary || 0);
  if (row.seatCategory) data.seatCategory = row.seatCategory;
  if (row.sourceSheet) data.sourceSheet = row.sourceSheet;
  if (row.agentLevel) data.agentLevel = row.agentLevel;
  if (row.dateHired) data.dateHired = row.dateHired;
  if (row.agentType) data.agentType = row.agentType;
  for (const key of ['monthlyGoal', 'monthlyActual', 'monthlyAchievement', 'overallGoal', 'overallActual', 'overallAchievement'] as const) {
    if (row[key] !== undefined) data[key] = row[key];
  }
  if (row.transmittedVolume !== undefined) data.transmittedVolume = BigInt(row.transmittedVolume || 0);
  if (row.approvalsVolume !== undefined) data.approvalsVolume = BigInt(row.approvalsVolume || 0);
  if (row.bookedVolume !== undefined) data.bookedVolume = BigInt(row.bookedVolume || 0);

  for (const key of [
    'bauPayrollTxn', 'bauPayrollVol', 'bauDepositorTxn', 'bauDepositorVol',
    'topupPayrollTxn', 'topupPayrollVol', 'topupDepositorTxn', 'topupDepositorVol',
    'openMarketTxn', 'openMarketVol', 'c2gTxn', 'c2gVol', 'btTxn', 'btVol',
    'balconTxn', 'balconVol', 'grandTotalTxn', 'grandTotalVol',
  ] as const) {
    if (row[key] !== undefined) data[key] = BigInt(row[key] || 0);
  }
  return data;
}

function detailResponse(row: ParsedEntry, agentName: string, metricType: string) {
  const effectiveMetric = row.metricType || metricType;
  const detail: any = {
    row: row.rowIdx,
    sheet: row.sourceSheet,
    campaign: row.campaignName,
    agent: agentName,
    date: row.reportDate ? ymd(row.reportDate) : '',
    volume: row.volume,
  };
  if (effectiveMetric === 'all_metrics') {
    detail.transmittals = row.transmittals;
    detail.approvals = row.approvals;
    detail.booked = row.booked;
  } else if (effectiveMetric === 'acq') {
    detail.ntb = row.ntb;
    detail.supplementary = row.supplementary;
    detail.seatCategory = row.seatCategory;
  } else {
    detail[effectiveMetric] = row.count;
  }
  return detail;
}

async function getAssignedCampaigns(userId: string, primaryCampaignId?: string | null): Promise<AssignedCampaign[]> {
  const assigned = await prisma.userCampaign.findMany({
    where: { userId },
    select: { campaign: { select: { id: true, campaignName: true } } },
  });
  const campaigns = assigned.map((row) => row.campaign);
  if (primaryCampaignId && !campaigns.some((campaign) => campaign.id === primaryCampaignId)) {
    const primary = await prisma.campaign.findUnique({ where: { id: primaryCampaignId }, select: { id: true, campaignName: true } });
    if (primary) campaigns.push(primary);
  }
  return campaigns;
}

function classifyEntries(entries: ParsedEntry[], agentsByCampaign: Map<string, { id: string; name: string }[]>) {
  const matched: any[] = [];
  const notFound: any[] = [];
  for (const entry of entries) {
    const agent = (agentsByCampaign.get(entry.campaignId || '') || []).find((candidate) => agentNameMatches(candidate.name, entry.name));
    const baseData: any = {
      name: entry.name,
      count: entry.count,
      volume: entry.volume,
      sheet: entry.sourceSheet,
      campaignId: entry.campaignId,
      campaignName: entry.campaignName,
      metricType: entry.metricType,
      reportDate: entry.reportDate ? ymd(entry.reportDate) : '',
      row: entry.rowIdx,
      goal: entry.monthlyGoal,
      actual: entry.monthlyActual,
      achievement: entry.monthlyAchievement,
    };
    if (entry.metricType === 'all_metrics') {
      baseData.transmittals = entry.transmittals;
      baseData.approvals = entry.approvals;
      baseData.booked = entry.booked;
      baseData.activations = entry.activations;
    }
    if (entry.ntb !== undefined || entry.seatCategory !== undefined) {
      baseData.ntb = entry.ntb ?? 0;
      baseData.supplementary = entry.supplementary ?? 0;
      baseData.seatCategory = entry.seatCategory ?? '';
    }
    if (agent) matched.push({ ...baseData, agentId: agent.id, agentName: agent.name });
    else notFound.push(baseData);
  }
  const sorter = (a: any, b: any) => (b.volume !== a.volume ? b.volume - a.volume : b.count - a.count);
  matched.sort(sorter);
  notFound.sort(sorter);
  return { matched, notFound };
}

function normalizedMetricKey(campaignId: string, agentId: string, metricType: string, reportDate: Date, reportPeriodType: ReportPeriodType) {
  return `${campaignId}|${agentId}|${metricType}|${reportPeriodType}|${ymd(reportDate)}`;
}

function legacyMetricTypes(detail: any): string[] {
  const importedType = detail.productionEntry?.importMetricType;
  if (importedType && !['all', 'all_metrics', 'acq'].includes(importedType)) return [importedType];
  if (importedType === 'acq') return ['ntb', 'supplementary'];
  if (importedType === 'all' || importedType === 'all_metrics') {
    return ['transmittals', 'approvals', 'booked', 'activations', ...(detail.monthlyGoal != null ? ['goal'] : []), ...(detail.monthlyActual != null ? ['actual'] : []), ...(detail.monthlyAchievement != null ? ['achievement'] : [])];
  }
  const inferred: string[] = [];
  if (Number(detail.transmittals) !== 0) inferred.push('transmittals');
  if (Number(detail.approvals) !== 0) inferred.push('approvals');
  if (Number(detail.booked) !== 0) inferred.push('booked');
  if (Number(detail.activations) !== 0) inferred.push('activations');
  if (Number(detail.ntb) !== 0) inferred.push('ntb');
  if (Number(detail.supplementary) !== 0) inferred.push('supplementary');
  if (detail.monthlyGoal != null) inferred.push('goal');
  if (detail.monthlyActual != null) inferred.push('actual');
  if (detail.monthlyAchievement != null) inferred.push('achievement');
  return inferred;
}

function monthSummaryFromRecords(records: any[], sheets: SheetPreview[]) {
  const summary = new Map<string, { month: string; label: string; reportDate: string; new: number; existing: number; invalid: number }>();
  const get = (date: string) => {
    const month = date.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const current = summary.get(month) || { month, label: `${MONTH_NAMES[monthNumber - 1]} ${year}`, reportDate: `${month}-01`, new: 0, existing: 0, invalid: 0 };
    summary.set(month, current);
    return current;
  };
  for (const record of records) {
    const item = get(record.reportDate);
    if (record.status === 'Existing') item.existing++;
    else item.new++;
  }
  for (const sheet of sheets) {
    if (sheet.invalidRows > 0) get(sheet.reportDate).invalid += sheet.invalidRows;
  }
  return [...summary.values()].sort((a, b) => a.month.localeCompare(b.month));
}

async function buildWorkbookPreview({
  workbook,
  selectedCampaigns,
  metricType,
  selectedReportDate,
  reportPeriodType,
}: {
  workbook: XLSX.WorkBook;
  selectedCampaigns: AssignedCampaign[];
  metricType: string;
  selectedReportDate: Date;
  reportPeriodType: ReportPeriodType;
}) {
  const campaignIds = selectedCampaigns.map((campaign) => campaign.id);
  const campaignAgents = await prisma.user.findMany({
    where: { role: 'AGENT', campaignId: { in: campaignIds } },
    select: { id: true, name: true, campaignId: true },
  });
  const agentsByCampaign = new Map<string, { id: string; name: string }[]>();
  for (const agent of campaignAgents) {
    const bucket = agentsByCampaign.get(agent.campaignId || '') || [];
    bucket.push({ id: agent.id, name: agent.name });
    agentsByCampaign.set(agent.campaignId || '', bucket);
  }

  const hiddenByName = new Map<string, boolean>();
  workbook.Workbook?.Sheets?.forEach((sheetInfo: any, index: number) => {
    hiddenByName.set(workbook.SheetNames[index], Boolean(sheetInfo?.Hidden));
  });

  const allSeen = new Set<string>();
  const sheets: SheetPreview[] = workbook.SheetNames.map((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null } as any);
    const mapping = mapWorksheetCampaign(sheetName, selectedCampaigns);
    const reportDate = parseReportDateFromRows(rows, selectedReportDate, sheetName);
    const detectedMetric = detectMetricFromText(`${sheetName} ${rows.slice(0, 5).flat().join(' ')}`, metricType);
    const parsed = parseDetectedRows(rows, detectedMetric, mapping.campaign.campaignName, sheetName, reportDate);
    const entries: ParsedEntry[] = [];
    let duplicateRows = 0;
    const warnings = [...parsed.warnings];
    const sheetSeen = new Set<string>();

    for (const entry of parsed.entries) {
      const effectiveMetric = entry.metricType || detectedMetric;
      const entryDate = entry.reportDate || reportDate;
      const key = [mapping.campaign.id, normalizeAgentName(entry.name), ymd(normalizePeriodDate(entryDate, reportPeriodType)), effectiveMetric].join('|');
      if (sheetSeen.has(key) || allSeen.has(key)) {
        duplicateRows++;
        warnings.push(`Row ${entry.rowIdx}: duplicate ${sheetSeen.has(key) ? 'within this sheet' : 'already found in another sheet'}; it will be skipped.`);
        continue;
      }
      sheetSeen.add(key);
      allSeen.add(key);
      entries.push({
        ...entry,
        campaignId: mapping.campaign.id,
        campaignName: mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.campaign.campaignName,
        metricType: effectiveMetric,
        reportDate: entryDate,
      });
    }

    entries.sort((a, b) => (a.reportDate?.getTime() || 0) - (b.reportDate?.getTime() || 0) || a.rowIdx - b.rowIdx);
    const { matched, notFound } = classifyEntries(entries, agentsByCampaign);
    const errors = [...parsed.errors];
    if (hiddenByName.get(sheetName) && entries.length === 0) warnings.push('Hidden sheet skipped because no valid production data was found.');
    if (mapping.source === 'selected') warnings.push(`No campaign alias matched this worksheet; using the only selected campaign, ${mapping.campaign.campaignName}.`);
    if (mapping.source === 'unresolved') warnings.push('Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.');

    return {
      key: `${index}:${sheetName}`,
      sheetName: sheetName.replace(/[\r\n\t]/g, ' ').slice(0, 80),
      hidden: Boolean(hiddenByName.get(sheetName)),
      selected: entries.length > 0,
      format: entries.length > 0 ? parsed.format : 'Skipped',
      campaignId: mapping.campaign.id,
      campaignName: mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.campaign.campaignName,
      campaignMapping: mapping.source,
      metricType: detectedMetric,
      metricSource: detectedMetric === metricType ? 'selected' : 'sheet',
      reportDate: ymd(entries[0]?.reportDate || reportDate),
      totalRows: rows.filter(rowHasAnyValue).length,
      validRows: entries.length,
      invalidRows: parsed.invalidRows,
      duplicateRows,
      warnings,
      errors,
      matched,
      notFound,
      entries,
    };
  });

  const accepted = sheets.filter((sheet) => sheet.validRows > 0);
  const candidateDates = sheets.flatMap((sheet) => sheet.entries.map((entry) => normalizePeriodDate(entry.reportDate || selectedReportDate, reportPeriodType)));
  const matchedAgentIds = campaignAgents.map((agent) => agent.id);
  const campaignIdSet = [...new Set(sheets.map((sheet) => sheet.campaignId))];
  const minDate = candidateDates.length ? new Date(Math.min(...candidateDates.map((date) => date.getTime()))) : selectedReportDate;
  const maxDate = candidateDates.length ? new Date(Math.max(...candidateDates.map((date) => date.getTime()))) : selectedReportDate;
  const [existingMetrics, legacyDetails] = matchedAgentIds.length && candidateDates.length ? await Promise.all([
    prisma.productionMetricRecord.findMany({
      where: { campaignId: { in: campaignIdSet }, agentId: { in: matchedAgentIds }, reportPeriodType, reportDate: { gte: minDate, lte: maxDate } },
      select: { campaignId: true, agentId: true, metricType: true, reportDate: true },
    }),
    prisma.productionDetail.findMany({
      where: { campaignId: { in: campaignIdSet }, agentId: { in: matchedAgentIds }, productionEntry: { date: { gte: new Date(minDate.getFullYear(), minDate.getMonth(), 1), lte: new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0) } } },
      select: {
        campaignId: true, agentId: true, transmittals: true, approvals: true, booked: true, activations: true, ntb: true, supplementary: true,
        monthlyGoal: true, monthlyActual: true, monthlyAchievement: true,
        productionEntry: { select: { date: true, reportPeriodType: true, importMetricType: true } },
      },
    }),
  ]) : [[], []];
  const existingKeys = new Set(existingMetrics.map((record) => normalizedMetricKey(record.campaignId, record.agentId, record.metricType, record.reportDate, reportPeriodType)));
  for (const detail of legacyDetails) {
    if (detail.productionEntry.reportPeriodType !== reportPeriodType) continue;
    const normalizedDate = normalizePeriodDate(detail.productionEntry.date, reportPeriodType);
    for (const type of legacyMetricTypes(detail)) existingKeys.add(normalizedMetricKey(detail.campaignId, detail.agentId, type, normalizedDate, reportPeriodType));
  }

  const previewSeen = new Set<string>();
  const previewRecords = sheets.flatMap((sheet) => sheet.entries.flatMap((entry) => {
    const agent = (agentsByCampaign.get(entry.campaignId || '') || []).find((candidate) => agentNameMatches(candidate.name, entry.name));
    const normalizedDate = normalizePeriodDate(entry.reportDate || selectedReportDate, reportPeriodType);
    return expandEntryMetrics(entry).flatMap((metric) => {
      const key = normalizedMetricKey(entry.campaignId || sheet.campaignId, agent?.id || normalizeAgentName(entry.name), metric.metricType, normalizedDate, reportPeriodType);
      if (previewSeen.has(key)) return [];
      previewSeen.add(key);
      return [{
      sheet: entry.sourceSheet || sheet.sheetName,
      campaignName: entry.campaignName || sheet.campaignName,
      agent: agent?.name || entry.name,
      reportPeriodType,
      reportDate: ymd(normalizedDate),
      metricType: metric.metricType,
      count: metric.count ?? null,
      volume: metric.volume ?? null,
      goal: metric.goal ?? null,
      actual: metric.actual ?? null,
      achievement: metric.achievement ?? null,
      status: agent && existingKeys.has(key) ? 'Existing' : 'New',
      validationMessage: agent ? '' : 'Agent not found; approve creation before import.',
      row: entry.rowIdx,
      }];
    });
  })).sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.campaignName.localeCompare(b.campaignName) || a.agent.localeCompare(b.agent));
  const monthSummary = monthSummaryFromRecords(previewRecords, sheets);
  return {
    workbookSummary: {
      totalWorksheets: sheets.length,
      worksheetsAccepted: accepted.length,
      worksheetsSkipped: sheets.length - accepted.length,
      totalValidRecords: sheets.reduce((sum, sheet) => sum + sheet.validRows, 0),
      totalInvalidRecords: sheets.reduce((sum, sheet) => sum + sheet.invalidRows, 0),
      totalDuplicateRecords: sheets.reduce((sum, sheet) => sum + sheet.duplicateRows, 0),
    },
    sheets,
    matched: sheets.flatMap((sheet) => sheet.matched),
    notFound: sheets.flatMap((sheet) => sheet.notFound),
    previewRecords,
    monthSummary,
    detectedRange: monthSummary.length ? { earliestMonth: monthSummary[0].month, latestMonth: monthSummary[monthSummary.length - 1].month } : null,
  };
}

function bdoNaturalKey(record: BdoImportRecord) {
  return [record.worksheetSource, record.recordKind, record.entityName || '', record.category || '', record.product || '', record.metric, record.year, record.month || 0].map((value) => String(value).trim().toLowerCase()).join('|');
}

function buildBdoPreview(workbook: XLSX.WorkBook, reportDate: Date, selectedCampaigns: AssignedCampaign[], reportPeriodType: ReportPeriodType) {
  const parsed = parseBdoDashboardWorkbook(workbook, reportDate);
  const recordMappings = new Map(parsed.records.map((record) => [record, mapWorksheetCampaign(`${record.worksheetSource} ${record.category || ''} ${record.product || ''} ${record.metric}`, selectedCampaigns)]));
  const sheetMappings = new Map<string, { campaign: AssignedCampaign; source: 'sheet' | 'record' | 'selected' | 'unresolved' }>(parsed.sheets.map((sheet) => {
    const records = sheet.records.map((record) => recordMappings.get(record)!);
    const detected = records.filter((mapping) => mapping.source === 'sheet');
    const unresolvedRecords = records.filter((mapping) => mapping.source === 'unresolved');
    if (detected.length && !unresolvedRecords.length) return [sheet.sheetName, { campaign: detected[0].campaign, source: 'record' as const }];
    return [sheet.sheetName, mapWorksheetCampaign(sheet.sheetName, selectedCampaigns)];
  }));
  const seen = new Set<string>();
  let duplicateCount = 0;
  parsed.records = parsed.records.filter((record) => {
    const key = bdoNaturalKey(record);
    if (seen.has(key)) { duplicateCount++; return false; }
    seen.add(key);
    return true;
  });
  const retainedRecords = new Set(parsed.records);
  for (const sheet of parsed.sheets) sheet.records = sheet.records.filter((record) => retainedRecords.has(record));
  const previewRecords = parsed.records.map((record) => {
    const detectedMapping = recordMappings.get(record)!;
    const sheetMapping = sheetMappings.get(record.worksheetSource)!;
    const mapping = detectedMapping.source === 'sheet' ? detectedMapping : sheetMapping;
    return ({
    sheet: record.worksheetSource,
    campaignId: mapping.campaign.id,
    campaignName: mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.campaign.campaignName,
    agent: record.entityName || record.category || record.metric,
    reportPeriodType,
    reportDate: ymd(record.reportDate),
    metricType: record.metric,
    count: record.numericValue ?? null,
    volume: null,
    goal: record.target ?? null,
    actual: record.actual ?? null,
    achievement: record.achievement ?? null,
    status: 'New',
    validationMessage: record.remark || '',
    row: record.sourceRow,
    });
  });
  const monthMap = new Map<string, any>();
  for (const record of parsed.records) {
    const month = `${record.year}-${String(record.month || 1).padStart(2, '0')}`;
    const current = monthMap.get(month) || { month, label: new Date(record.year, (record.month || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), reportDate: `${month}-01`, new: 0, existing: 0, invalid: 0 };
    current.new++;
    monthMap.set(month, current);
  }
  const worksheetPreviews = parsed.sheets.map((sheet, index) => {
    const mapping = sheetMappings.get(sheet.sheetName)!;
    const mappingWarnings = mapping.source === 'unresolved' ? ['Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.'] : [];
    return ({
    key: `${index}:${sheet.sheetName}`,
    sheetName: sheet.sheetName,
    hidden: false,
    selected: sheet.records.length > 0,
    format: sheet.detectedType,
    campaignId: mapping.campaign.id,
    campaignName: mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.source === 'record' ? 'Detected per record' : mapping.campaign.campaignName,
    campaignMapping: mapping.source,
    metricType: 'all_metrics',
    metricSource: 'sheet' as const,
    reportDate: sheet.records[0] ? ymd(sheet.records[0].reportDate) : ymd(reportDate),
    totalRows: sheet.records.length + sheet.warnings.length,
    validRows: sheet.records.length,
    invalidRows: sheet.warnings.filter((warning) => !/unsupported worksheet/i.test(warning.message)).length,
    duplicateRows: 0,
    detectedMonths: sheet.months,
    warnings: [...mappingWarnings, ...sheet.warnings.map((warning) => warning.message)],
    errors: [] as string[],
    status: sheet.status,
    });
  });
  return {
    parsed,
    recordMappings,
    previewRecords,
    worksheetPreviews,
    monthSummary: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    workbookSummary: {
      totalWorksheets: workbook.SheetNames.length,
      worksheetsAccepted: parsed.sheets.filter((sheet) => sheet.records.length > 0).length,
      worksheetsSkipped: parsed.sheets.filter((sheet) => sheet.records.length === 0).length,
      totalValidRecords: parsed.records.length,
      totalInvalidRecords: parsed.issues.filter((issue) => !/unsupported worksheet/i.test(issue.message)).length,
      totalDuplicateRecords: duplicateCount,
      inWorkbookDuplicateRecords: duplicateCount,
      workbookYear: parsed.workbookYear,
      supportedWorksheets: parsed.sheets.filter((sheet) => sheet.detectedType !== 'Unsupported').map((sheet) => sheet.sheetName),
      unsupportedWorksheets: parsed.sheets.filter((sheet) => sheet.detectedType === 'Unsupported').map((sheet) => sheet.sheetName),
      detectedMonths: parsed.detectedMonths,
      detectedCategories: parsed.detectedCategories,
      detectedMetrics: parsed.detectedMetrics,
      agentCount: parsed.agents.length,
      teamLeaderCount: parsed.teamLeaders.length,
      manpowerRecordCount: parsed.records.filter((record) => record.recordKind === 'manpower').length,
    },
  };
}

async function markExistingBdoRecords(preview: ReturnType<typeof buildBdoPreview>, selectedCampaignIds: string[], reportPeriodType: ReportPeriodType) {
  if (!preview.parsed.records.length) return;
  const years = [...new Set(preview.parsed.records.map((record) => record.year))];
  const existing = await prisma.$queryRaw<Array<{ campaignId: string; worksheetSource: string; recordKind: string; entityName: string; category: string; product: string; metric: string; year: number; month: number | null }>>`
    SELECT "campaignId", "worksheetSource", "recordKind", "entityName", "category", "product", "metric", "year", "month"
    FROM "DashboardImportRecord"
    WHERE "campaignId" = ANY(${selectedCampaignIds}::text[]) AND "reportPeriodType" = ${reportPeriodType} AND "year" = ANY(${years}::int[])
  `;
  const existingKeys = new Set(existing.map((record) => `${record.campaignId}|${[record.worksheetSource, record.recordKind, record.entityName, record.category, record.product, record.metric, record.year, record.month || 0].map((value) => String(value).trim().toLowerCase()).join('|')}`));
  let count = 0;
  preview.parsed.records.forEach((record, index) => {
    const sheet = preview.worksheetPreviews.find((candidate) => candidate.sheetName === record.worksheetSource);
    if (!sheet || sheet.campaignMapping === 'unresolved' || !existingKeys.has(`${preview.previewRecords[index].campaignId}|${bdoNaturalKey(record)}`)) return;
    preview.previewRecords[index].status = 'Existing';
    count++;
  });
  preview.workbookSummary.totalDuplicateRecords += count;
  for (const summary of preview.monthSummary) {
    const existingInMonth = preview.previewRecords.filter((record) => record.reportDate.startsWith(summary.month) && record.status === 'Existing').length;
    summary.existing = existingInMonth;
    summary.new -= existingInMonth;
  }
}

async function persistBdoImport({
  preview, selectedCampaigns, campaignMappings, fileName, importMode, duplicateMode, reportPeriodType, reportDate, importedById, selectedWorksheetKeys,
}: {
  preview: ReturnType<typeof buildBdoPreview>;
  selectedCampaigns: AssignedCampaign[];
  campaignMappings: Record<string, string>;
  fileName: string;
  importMode: string;
  duplicateMode: DuplicateMode;
  reportPeriodType: ReportPeriodType;
  reportDate: Date;
  importedById: string;
  selectedWorksheetKeys: string[];
}) {
  const selectedSheets = preview.worksheetPreviews.filter((sheet) => !selectedWorksheetKeys.length || selectedWorksheetKeys.includes(sheet.key));
  const campaignBySheet = new Map(selectedSheets.map((sheet) => [sheet.sheetName, campaignMappings[sheet.key] || (sheet.campaignMapping === 'unresolved' ? '' : sheet.campaignId)]));
  const explicitlyMappedSheets = new Set(selectedSheets.filter((sheet) => Boolean(campaignMappings[sheet.key])).map((sheet) => sheet.sheetName));
  const records = preview.parsed.records
    .filter((record) => campaignBySheet.has(record.worksheetSource))
    .map((record) => {
      const detected = preview.recordMappings.get(record);
      return { record, campaignId: !explicitlyMappedSheets.has(record.worksheetSource) && detected?.source === 'sheet' ? detected.campaign.id : campaignBySheet.get(record.worksheetSource)! };
    });
  const importedCampaignIds = [...new Set(records.map((item) => item.campaignId))];
  return prisma.$transaction(async (tx) => {
    const batchId = crypto.randomUUID();
    await tx.$executeRaw`
      INSERT INTO "DashboardImportBatch" ("id", "campaignId", "fileName", "importMode", "duplicateMode", "reportPeriodType", "reportDate", "workbookYear", "totalWorksheets", "supportedSheets", "importedById", "status")
      VALUES (${batchId}, ${importedCampaignIds[0] || selectedCampaigns[0].id}, ${fileName}, ${importMode}, ${duplicateMode}, ${reportPeriodType}, ${reportDate}, ${preview.parsed.workbookYear}, ${preview.workbookSummary.totalWorksheets}, ${preview.workbookSummary.worksheetsAccepted}, ${importedById}, 'PROCESSING')
    `;
    let inserted = 0; let updated = 0; let skipped = preview.workbookSummary.inWorkbookDuplicateRecords;
    if (duplicateMode === 'replace_period') {
      const periods = new Set(records.map(({ record, campaignId }) => `${campaignId}|${record.worksheetSource}|${record.year}|${record.month || 0}`));
      for (const period of periods) {
        const [campaignId, worksheet, year, month] = period.split('|');
        await tx.$executeRaw`DELETE FROM "DashboardImportRecord" WHERE "campaignId" = ${campaignId} AND "worksheetSource" = ${worksheet} AND "year" = ${Number(year)} AND COALESCE("month", 0) = ${Number(month)} AND "reportPeriodType" = ${reportPeriodType}`;
      }
    }
    for (const item of records) {
      const { record, campaignId } = item;
      const entityName = record.entityName || '';
      const category = record.category || '';
      const product = record.product || '';
      const month = record.month || 0;
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "DashboardImportRecord"
        WHERE "campaignId" = ${campaignId} AND "worksheetSource" = ${record.worksheetSource} AND "recordKind" = ${record.recordKind}
          AND "entityName" = ${entityName} AND "category" = ${category} AND "product" = ${product} AND "metric" = ${record.metric}
          AND "year" = ${record.year} AND COALESCE("month", 0) = ${month} AND "reportPeriodType" = ${reportPeriodType}
        LIMIT 1
      `;
      if (existing.length && duplicateMode === 'skip') { skipped++; continue; }
      if (existing.length) {
        await tx.$executeRaw`
          UPDATE "DashboardImportRecord" SET "batchId" = ${batchId}, "sourceRow" = ${record.sourceRow}, "monitoringType" = ${record.monitoringType || null}, "level" = ${record.level || null},
            "reportDate" = ${record.reportDate}, "target" = ${record.target ?? null}, "actual" = ${record.actual ?? null}, "achievement" = ${record.achievement ?? null},
            "numericValue" = ${record.numericValue ?? null}, "declaredSeat" = ${record.declaredSeat ?? null}, "actualHeadCount" = ${record.actualHeadCount ?? null}, "remark" = ${record.remark || null}, "sourceFile" = ${fileName}, "importedById" = ${importedById}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${existing[0].id}
        `;
        updated++;
      } else {
        await tx.$executeRaw`
          INSERT INTO "DashboardImportRecord" ("id", "batchId", "campaignId", "worksheetSource", "sourceRow", "recordKind", "monitoringType", "entityName", "level", "category", "product", "metric", "month", "year", "reportPeriodType", "reportDate", "target", "actual", "achievement", "numericValue", "declaredSeat", "actualHeadCount", "remark", "sourceFile", "importedById")
          VALUES (${crypto.randomUUID()}, ${batchId}, ${campaignId}, ${record.worksheetSource}, ${record.sourceRow}, ${record.recordKind}, ${record.monitoringType || null}, ${entityName}, ${record.level || null}, ${category}, ${product}, ${record.metric}, ${record.month || null}, ${record.year}, ${reportPeriodType}, ${record.reportDate}, ${record.target ?? null}, ${record.actual ?? null}, ${record.achievement ?? null}, ${record.numericValue ?? null}, ${record.declaredSeat ?? null}, ${record.actualHeadCount ?? null}, ${record.remark || null}, ${fileName}, ${importedById})
        `;
        inserted++;
      }
    }
    for (const issue of preview.parsed.issues.slice(0, 2000)) {
      await tx.$executeRaw`INSERT INTO "DashboardImportIssue" ("id", "batchId", "worksheetSource", "sourceRow", "message", "rawValue") VALUES (${crypto.randomUUID()}, ${batchId}, ${issue.worksheet}, ${issue.row || null}, ${issue.message}, ${issue.rawValue || null})`;
    }
    const invalid = preview.parsed.issues.filter((issue) => !/unsupported worksheet/i.test(issue.message)).length;
    await tx.$executeRaw`UPDATE "DashboardImportBatch" SET "insertedCount" = ${inserted}, "updatedCount" = ${updated}, "skippedCount" = ${skipped}, "failedCount" = ${invalid}, "status" = 'COMPLETED', "completedAt" = CURRENT_TIMESTAMP WHERE "id" = ${batchId}`;
    return { batchId, inserted, updated, skipped, invalid, importedCampaignIds, importedCampaigns: importedCampaignIds.length, success: inserted + updated, created: 0, details: [], errors: preview.parsed.issues.slice(0, 50).map((issue) => `${issue.worksheet}${issue.row ? ` row ${issue.row}` : ''}: ${issue.message}`), message: `Import completed for ${importedCampaignIds.length} campaign${importedCampaignIds.length === 1 ? '' : 's'}: ${inserted} inserted, ${updated} updated, ${skipped} skipped, and ${invalid} invalid.` };
  }, { timeout: 120000 });
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can view bulk imports' }, { status: 403 });
    }

    await ensureImportMetadataColumns();

    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get('entryId');

    if (entryId) {
      const summary = await getImportSummary(entryId, user.id);
      if (!summary) {
        const dashboardBatches = await prisma.$queryRaw<any[]>`
          SELECT b.*, c."campaignName", COUNT(r.id)::int AS "detailCount"
          FROM "DashboardImportBatch" b
          JOIN "Campaign" c ON c.id = b."campaignId"
          LEFT JOIN "DashboardImportRecord" r ON r."batchId" = b.id
          WHERE b.id = ${entryId} AND b."importedById" = ${user.id}
          GROUP BY b.id, c."campaignName"
          LIMIT 1
        `;
        const batch = dashboardBatches[0];
        if (!batch) return NextResponse.json({ error: 'Import file not found' }, { status: 404 });
        return NextResponse.json({ importFile: { id: batch.id, campaignId: batch.campaignId, campaignName: batch.campaignName, fileName: batch.fileName, metricType: 'all_metrics', reportDate: batch.reportDate, importedAt: batch.createdAt, detailCount: Number(batch.detailCount || 0), totals: { transmittals: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 }, details: [] } });
      }

      const details = await prisma.productionDetail.findMany({
        where: { productionEntryId: entryId },
        select: {
          id: true,
          transmittals: true,
          approvals: true,
          booked: true,
          volume: true,
          ntb: true,
          supplementary: true,
          seatCategory: true,
          agent: { select: { name: true, seatNumber: true } },
        },
        orderBy: { agent: { name: 'asc' } },
      });

      return NextResponse.json({
        importFile: {
          ...summary,
          details: details.map((detail) => ({
            id: detail.id,
            agent: detail.agent.name,
            seatNumber: detail.agent.seatNumber,
            transmittals: Number(detail.transmittals || 0),
            approvals: Number(detail.approvals || 0),
            booked: Number(detail.booked || 0),
            volume: Number(detail.volume || 0),
            ntb: Number(detail.ntb || 0),
            supplementary: Number(detail.supplementary || 0),
            seatCategory: detail.seatCategory,
          })),
        },
      });
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT pe.id,
             pe."campaignId",
             c."campaignName",
             pe.date,
             pe.time,
             pe."periodStart",
             pe."periodEnd",
             pe."createdAt",
             pe."importFileName",
             pe."importMetricType",
             COUNT(pd.id) AS "detailCount",
             COALESCE(SUM(pd.transmittals), 0) AS transmittals,
             COALESCE(SUM(pd.approvals), 0) AS approvals,
             COALESCE(SUM(pd.booked), 0) AS booked,
             COALESCE(SUM(pd.volume), 0) AS volume,
             COALESCE(SUM(pd.ntb), 0) AS ntb,
             COALESCE(SUM(pd.supplementary), 0) AS supplementary
      FROM "ProductionEntry" pe
      JOIN "Campaign" c ON c.id = pe."campaignId"
      LEFT JOIN "ProductionDetail" pd ON pd."productionEntryId" = pe.id
      WHERE pe."createdBy" = ${user.id}
      GROUP BY pe.id, c."campaignName"
      ORDER BY pe."createdAt" DESC
      LIMIT 50
    `;
    const dashboardRows = await prisma.$queryRaw<any[]>`
      SELECT b.id, b."campaignId", c."campaignName", b."fileName", b."reportDate", b."createdAt", (b."insertedCount" + b."updatedCount") AS "detailCount"
      FROM "DashboardImportBatch" b
      JOIN "Campaign" c ON c.id = b."campaignId"
      WHERE b."importedById" = ${user.id} AND b.status = 'COMPLETED'
      ORDER BY b."createdAt" DESC
      LIMIT 50
    `;
    const dashboardImports = dashboardRows.map((batch) => ({ id: batch.id, campaignId: batch.campaignId, campaignName: batch.campaignName, fileName: batch.fileName, metricType: 'all_metrics', reportDate: batch.reportDate, importedAt: batch.createdAt, detailCount: Number(batch.detailCount || 0), totals: { transmittals: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 } }));
    const imports = [...rows.map(formatImportSummary), ...dashboardImports].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()).slice(0, 50);
    return NextResponse.json({ imports });
  } catch (error) {
    console.error('Bulk import history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can bulk import' }, { status: 403 });
    }

    const collectorUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, campaignId: true },
    });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const mode = (formData.get('mode') as string) || 'import';
    const importMode = (formData.get('importMode') as string) || 'single';
    const requestedMetricType = (formData.get('metricType') as string) || 'transmittals';
    const reportPeriodType = ((formData.get('reportPeriodType') as string) || 'daily') as ReportPeriodType;
    const duplicateMode = ((formData.get('duplicateMode') as string) || 'skip') as DuplicateMode;
    const reportMonthValue = Number(formData.get('reportMonth') || 0);
    const reportYearValue = Number(formData.get('reportYear') || 0);
    const reportDateStr = formData.get('reportDate') as string;
    const periodStartStr = (formData.get('periodStart') as string) || '';
    const periodEndStr = (formData.get('periodEnd') as string) || '';
    const legacyCampaignId = (formData.get('campaignId') as string) || '';
    let submittedCampaignIds: string[] = [];
    try {
      const parsed = JSON.parse((formData.get('campaignIds') as string) || '[]');
      if (Array.isArray(parsed)) submittedCampaignIds = [...new Set(parsed.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))];
    } catch {
      return NextResponse.json({ error: 'The selected campaign list is invalid.' }, { status: 400 });
    }
    if (!submittedCampaignIds.length && legacyCampaignId) submittedCampaignIds = [legacyCampaignId];

    if (!['all', 'worksheets', 'single'].includes(importMode)) {
      return NextResponse.json({ error: 'Import Mode must be Import All Data, Import Selected Worksheets, or Import Single Metric.' }, { status: 400 });
    }
    if ((importMode === 'all' || importMode === 'worksheets') && requestedMetricType !== 'all') {
      return NextResponse.json({ error: 'Import All Data requires Metric Type to be ALL METRICS.' }, { status: 400 });
    }
    if (importMode === 'single' && ['all', 'all_metrics'].includes(requestedMetricType)) {
      return NextResponse.json({ error: 'Import Single Metric requires an individual Metric Type.' }, { status: 400 });
    }
    if (!['daily', 'monthly', 'yearly'].includes(reportPeriodType)) {
      return NextResponse.json({ error: 'Report Period must be Daily, Monthly, or Yearly.' }, { status: 400 });
    }
    if (!['skip', 'update', 'replace_period'].includes(duplicateMode)) {
      return NextResponse.json({ error: 'Duplicate handling must be Skip Existing, Update Existing, or Replace Matching Period Data.' }, { status: 400 });
    }
    if (!submittedCampaignIds.length) {
      return NextResponse.json({ error: 'Select at least one campaign before previewing the file.' }, { status: 400 });
    }
    const metricType = requestedMetricType === 'all' ? 'all_metrics' : requestedMetricType;

    await ensureImportMetadataColumns();

    const assignedCampaigns = await getAssignedCampaigns(user.id, collectorUser?.campaignId);
    const selectedCampaigns = submittedCampaignIds
      .map((id) => assignedCampaigns.find((campaign) => campaign.id === id))
      .filter((campaign): campaign is AssignedCampaign => Boolean(campaign));
    if (selectedCampaigns.length !== submittedCampaignIds.length) {
      return NextResponse.json({ error: 'One or more selected campaigns are invalid or inactive.' }, { status: 400 });
    }

    // Resolve the target campaign: prefer the one chosen on the import page,
    // otherwise fall back to the collector's assigned campaign.
    const effectiveCampaignId = selectedCampaigns[0].id;
    const campaignExists = selectedCampaigns[0];
    const campaignName = campaignExists?.campaignName || '';
    let campaignAgents = await prisma.user.findMany({
      where: { campaignId: effectiveCampaignId, role: 'AGENT' },
      select: { id: true, name: true },
    });
    const findExistingAgent = (importedName: string) =>
      campaignAgents.find((agent) => agentNameMatches(agent.name, importedName)) || null;
    const rememberAgent = (agent: { id: string; name: string }) => {
      if (!campaignAgents.some((existing) => existing.id === agent.id)) campaignAgents.push(agent);
    };

    // If the collector has no campaign assigned yet, bind them to the one they
    // are importing into. Without this, their dashboard (which keys off the
    // collector's own campaign) would never show the imported agents.
    if (mode !== 'preview') {
      if (!collectorUser?.campaignId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { campaignId: effectiveCampaignId },
        });
      }
      await prisma.userCampaign.upsert({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: effectiveCampaignId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          campaignId: effectiveCampaignId,
        },
      });
    }

    let reportDate: Date;
    if (reportPeriodType === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDateStr || '')) return NextResponse.json({ error: 'Daily reporting requires a valid complete Report Date.' }, { status: 400 });
      const [year, month, day] = reportDateStr.split('-').map(Number);
      reportDate = new Date(year, month - 1, day);
      if (reportDate.getFullYear() !== year || reportDate.getMonth() !== month - 1 || reportDate.getDate() !== day) return NextResponse.json({ error: 'Daily Report Date is invalid.' }, { status: 400 });
    } else if (reportPeriodType === 'monthly') {
      if (!Number.isInteger(reportMonthValue) || reportMonthValue < 1 || reportMonthValue > 12 || !Number.isInteger(reportYearValue) || reportYearValue < 2000 || reportYearValue > 2100) return NextResponse.json({ error: 'Monthly reporting requires a valid Report Month and Report Year.' }, { status: 400 });
      reportDate = new Date(reportYearValue, reportMonthValue - 1, 1);
    } else {
      if (!Number.isInteger(reportYearValue) || reportYearValue < 2000 || reportYearValue > 2100) return NextResponse.json({ error: 'Yearly reporting requires a valid Report Year.' }, { status: 400 });
      reportDate = new Date(reportYearValue, 0, 1);
    }

    // MTD reporting period detected from the file (YYYY-MM-DD). Persisted on the
    // production entry so the imported batch carries its full range, not just a day.
    const parseYmd = (s: string): Date | null => {
      if (!s) return null;
      const [y, m, d] = s.split('-').map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    };
    const periodStart = parseYmd(periodStartStr);
    const periodEnd = parseYmd(periodEndStr);

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File is too large. Maximum upload size is 10 MB.' }, { status: 400 });
    }

    const lowerFileName = file.name.toLowerCase();
    const excelExtension = /\.(xlsx|xls)$/i.test(lowerFileName);
    const csvExtension = lowerFileName.endsWith('.csv');
    const neutralMime = !file.type || file.type === 'application/octet-stream';
    const excelMime = neutralMime || file.type.includes('spreadsheet') || file.type.includes('excel') || file.type === 'application/vnd.ms-office';
    const csvMime = neutralMime || file.type.includes('csv') || file.type === 'text/plain';
    if ((excelExtension && !excelMime) || (csvExtension && !csvMime)) {
      return NextResponse.json({ error: 'The file extension and content type do not match.' }, { status: 400 });
    }
    const isExcel = excelExtension && excelMime;
    const isCsv = csvExtension && csvMime;
    if (isExcel) {
      const fileBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(fileBuffer);
      const isZipWorkbook = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const isLegacyWorkbook = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
      if (!isZipWorkbook && !isLegacyWorkbook) {
        return NextResponse.json({ error: 'The uploaded file is not a valid Excel workbook.' }, { status: 400 });
      }

      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: true });
      } catch {
        return NextResponse.json({ error: 'The workbook is corrupted, unreadable, or password-protected.' }, { status: 400 });
      }
      if (!workbook.SheetNames.length) {
        return NextResponse.json({ error: 'No worksheets found in Excel file' }, { status: 400 });
      }

      if (isBdoDashboardWorkbook(workbook)) {
        if (importMode === 'single') {
          return NextResponse.json({ error: 'BDO dashboard workbooks require Import All Data or Import Selected Worksheets.' }, { status: 400 });
        }
        const bdoPreview = buildBdoPreview(workbook, reportDate, selectedCampaigns, reportPeriodType);
        await markExistingBdoRecords(bdoPreview, selectedCampaigns.map((campaign) => campaign.id), reportPeriodType);
        if (bdoPreview.workbookSummary.worksheetsAccepted === 0 || bdoPreview.workbookSummary.totalValidRecords === 0) {
          return NextResponse.json({
            error: 'The workbook contains supported BDO worksheets, but no valid monthly data was found.',
            workbookSummary: bdoPreview.workbookSummary,
            worksheetPreviews: bdoPreview.worksheetPreviews,
          }, { status: 400 });
        }
        if (mode === 'preview') {
          return NextResponse.json({
            preview: true,
            multiSheet: true,
            bdoDashboard: true,
            matched: [],
            notFound: [],
            metricType: 'all_metrics',
            reportDate: ymd(reportDate),
            reportPeriodType,
            previewRecords: bdoPreview.previewRecords,
            monthSummary: bdoPreview.monthSummary,
            workbookSummary: bdoPreview.workbookSummary,
            worksheetPreviews: bdoPreview.worksheetPreviews,
            validationWarnings: bdoPreview.parsed.issues.slice(0, 200),
          });
        }
        const selectedWorksheetKeys: string[] = JSON.parse((formData.get('selectedWorksheetKeys') as string) || '[]');
        const campaignMappings: Record<string, string> = JSON.parse((formData.get('campaignMappings') as string) || '{}');
        const selectedBdoSheets = bdoPreview.worksheetPreviews.filter((sheet) => (!selectedWorksheetKeys.length || selectedWorksheetKeys.includes(sheet.key)) && sheet.validRows > 0);
        const invalidMapping = selectedBdoSheets.find((sheet) => {
          const mappedId = campaignMappings[sheet.key];
          return (sheet.campaignMapping === 'unresolved' && !mappedId) || Boolean(mappedId && !selectedCampaigns.some((campaign) => campaign.id === mappedId));
        });
        if (invalidMapping) {
          return NextResponse.json({ error: 'Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.' }, { status: 400 });
        }
        const result = await persistBdoImport({
          preview: bdoPreview,
          selectedCampaigns,
          campaignMappings,
          fileName: file.name,
          importMode,
          duplicateMode,
          reportPeriodType,
          reportDate,
          importedById: user.id,
          selectedWorksheetKeys,
        });
        return NextResponse.json({ ...result, workbookSummary: bdoPreview.workbookSummary, worksheetPreviews: bdoPreview.worksheetPreviews, normalizedImported: result.inserted, normalizedDuplicates: result.skipped });
      }

      const preview = await buildWorkbookPreview({
        workbook,
        selectedCampaigns,
        metricType,
        selectedReportDate: reportDate,
        reportPeriodType,
      });

      if (mode === 'preview') {
        if (preview.workbookSummary.totalValidRecords === 0) {
          return NextResponse.json({
            error: 'No valid production rows found in any worksheet.',
            workbookSummary: preview.workbookSummary,
            worksheetPreviews: preview.sheets.map(({ entries, ...sheet }) => sheet),
          }, { status: 400 });
        }

        return NextResponse.json({
          preview: true,
          multiSheet: true,
          matched: preview.matched,
          notFound: preview.notFound,
          metricType,
          reportDate: ymd(reportDate),
          reportPeriodType,
          reportMonth: reportDate.getMonth() + 1,
          reportYear: reportDate.getFullYear(),
          previewRecords: preview.previewRecords,
          monthSummary: preview.monthSummary,
          detectedRange: preview.detectedRange,
          workbookSummary: preview.workbookSummary,
          worksheetPreviews: preview.sheets.map(({ entries, ...sheet }) => sheet),
        });
      }

      const confirmedNewAgents: string[] = JSON.parse((formData.get('confirmedNewAgents') as string) || '[]');
      const selectedWorksheetKeys: string[] = JSON.parse((formData.get('selectedWorksheetKeys') as string) || '[]');
      const campaignMappings: Record<string, string> = JSON.parse((formData.get('campaignMappings') as string) || '{}');
      const selectedKeySet = new Set(
        selectedWorksheetKeys.length
          ? selectedWorksheetKeys
          : preview.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.key)
      );
      const selectedSheets = preview.sheets.filter((sheet) => selectedKeySet.has(sheet.key) && sheet.validRows > 0);
      const invalidMapping = selectedSheets.find((sheet) => {
        const mappedId = campaignMappings[sheet.key];
        return (sheet.campaignMapping === 'unresolved' && !mappedId) || Boolean(mappedId && !selectedCampaigns.some((campaign) => campaign.id === mappedId));
      });
      if (invalidMapping) {
        return NextResponse.json({ error: 'Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.' }, { status: 400 });
      }
      const entries = selectedSheets.flatMap((sheet) => {
        const mappedCampaignId = campaignMappings[sheet.key];
        const mappedCampaign = mappedCampaignId ? selectedCampaigns.find((campaign) => campaign.id === mappedCampaignId) : null;
        return sheet.entries.map((entry) => mappedCampaign
          ? { ...entry, campaignId: mappedCampaign.id, campaignName: mappedCampaign.campaignName }
          : entry);
      }).sort((a, b) => (a.reportDate?.getTime() || 0) - (b.reportDate?.getTime() || 0) || a.rowIdx - b.rowIdx);

      if (entries.length === 0) {
        return NextResponse.json({ error: 'No selected worksheets contain valid rows to import.' }, { status: 400 });
      }

      const importPayload = await prisma.$transaction(async (tx) => {
      const targetCampaignIds = [...new Set(entries.map((entry) => entry.campaignId || effectiveCampaignId))];
      const importAgents = await tx.user.findMany({
        where: { role: 'AGENT', campaignId: { in: targetCampaignIds } },
        select: { id: true, name: true, campaignId: true },
      });
      const findImportAgent = (name: string, targetCampaignId: string) =>
        importAgents.find((agent) => agent.campaignId === targetCampaignId && agentNameMatches(agent.name, name)) || null;
      const createdAgents: Record<string, string> = {};
      let createdAgentCount = 0;
      for (const name of confirmedNewAgents) {
        const row = entries.find((entry) => entry.name === name);
        const targetCampaignId = row?.campaignId || effectiveCampaignId;
        const existing = findImportAgent(name, targetCampaignId);
        if (existing) {
          createdAgents[name] = existing.id;
          continue;
        }

        const password = await bcrypt.hash(crypto.randomUUID(), 10);
        const newAgent = await tx.user.create({
          data: {
            name,
            email: nameToEmail(name),
            password,
            role: 'AGENT',
            campaignId: targetCampaignId,
          },
        });
        createdAgents[name] = newAgent.id;
        createdAgentCount++;
        importAgents.push({ id: newAgent.id, name: newAgent.name, campaignId: targetCampaignId });
      }

      const results = {
        success: 0,
        created: createdAgentCount,
        errors: [] as string[],
        details: [] as any[],
      };
      const entryByCampaignDate = new Map<string, string>();
      const sheetNames = selectedSheets.map((sheet) => sheet.sheetName);
      const createdEntryIds = new Set<string>();
      let enrichedRecords = 0;
      let skippedRecords = 0;
      let insertedLegacyDetails = 0;
      const normalizedRecords: any[] = [];
      const normalizedDates = entries.map((row) => normalizePeriodDate(row.reportDate || reportDate, reportPeriodType));
      const earliestDate = new Date(Math.min(...normalizedDates.map((date) => date.getTime())));
      const latestDate = new Date(Math.max(...normalizedDates.map((date) => date.getTime())));
      const importAgentIds = importAgents.map((agent) => agent.id);
      const [storedMetrics, storedDetails] = await Promise.all([
        tx.productionMetricRecord.findMany({
          where: { campaignId: { in: targetCampaignIds }, agentId: { in: importAgentIds }, reportPeriodType, reportDate: { gte: earliestDate, lte: latestDate } },
          select: { id: true, productionEntryId: true, campaignId: true, agentId: true, metricType: true, reportDate: true, count: true, volume: true, goal: true, actual: true, achievement: true },
        }),
        tx.productionDetail.findMany({
          where: {
            campaignId: { in: targetCampaignIds }, agentId: { in: importAgentIds },
            productionEntry: { date: { gte: new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1), lte: new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0) } },
          },
          select: {
            id: true, productionEntryId: true, campaignId: true, agentId: true,
            transmittals: true, approvals: true, booked: true, activations: true, ntb: true, supplementary: true,
            monthlyGoal: true, monthlyActual: true, monthlyAchievement: true,
            productionEntry: { select: { date: true, reportPeriodType: true, importMetricType: true } },
          },
        }),
      ]);
      const storedMetricByKey = new Map<string, any>(storedMetrics.map((record) => [normalizedMetricKey(record.campaignId, record.agentId, record.metricType, record.reportDate, reportPeriodType), record]));
      const storedDetailByKey = new Map<string, any>();
      for (const detail of storedDetails) {
        if (detail.productionEntry.reportPeriodType !== reportPeriodType) continue;
        const normalizedDate = normalizePeriodDate(detail.productionEntry.date, reportPeriodType);
        const detailKey = `${detail.campaignId}|${detail.agentId}|${ymd(normalizedDate)}`;
        if (!storedDetailByKey.has(detailKey)) storedDetailByKey.set(detailKey, detail);
        for (const type of legacyMetricTypes(detail)) {
          const key = normalizedMetricKey(detail.campaignId, detail.agentId, type, normalizedDate, reportPeriodType);
          if (!storedMetricByKey.has(key)) storedMetricByKey.set(key, { productionEntryId: detail.productionEntryId, legacy: true });
        }
      }

      for (const row of entries) {
        try {
          const targetCampaignId = row.campaignId || effectiveCampaignId;
          const agent = findImportAgent(row.name, targetCampaignId);
          if (!agent) {
            results.errors.push(`${row.sourceSheet} row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
            continue;
          }
          const normalizedDate = normalizePeriodDate(row.reportDate || reportDate, reportPeriodType);
          const metrics = expandEntryMetrics(row);
          const existingForRow = metrics.map((metric) => storedMetricByKey.get(normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType))).filter(Boolean);
          let rowChanged = false;
          for (const metric of metrics) {
            const key = normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType);
            const existing = storedMetricByKey.get(key);
            if (!existing) continue;
            const enrichment: Record<string, any> = {};
            if (existing.id) {
              if (existing.count == null && metric.count != null) enrichment.count = BigInt(Math.round(metric.count));
              if (existing.volume == null && metric.volume != null) enrichment.volume = BigInt(Math.round(metric.volume));
              if (existing.goal == null && metric.goal != null) enrichment.goal = metric.goal;
              if (existing.actual == null && metric.actual != null) enrichment.actual = metric.actual;
              if (existing.achievement == null && metric.achievement != null) enrichment.achievement = metric.achievement;
            }
            if (Object.keys(enrichment).length) {
              await tx.productionMetricRecord.update({ where: { id: existing.id }, data: enrichment });
              Object.assign(existing, enrichment);
              enrichedRecords++;
              rowChanged = true;
            } else {
              skippedRecords++;
            }
          }

          const missingMetrics = metrics.filter((metric) => !storedMetricByKey.has(normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType)));
          let savedEntryId = existingForRow.find((record) => record.productionEntryId)?.productionEntryId as string | undefined;
          const detailKey = `${targetCampaignId}|${agent.id}|${ymd(normalizedDate)}`;
          const existingDetail = storedDetailByKey.get(detailKey);
          if (!savedEntryId) savedEntryId = existingDetail?.productionEntryId;
          const entryKey = `${targetCampaignId}|${ymd(normalizedDate)}`;
          if (!savedEntryId) savedEntryId = entryByCampaignDate.get(entryKey);
          if (missingMetrics.length && !savedEntryId) {
            const entryPeriodStart = reportPeriodType === 'daily' ? periodStart : normalizedDate;
            const entryPeriodEnd = reportPeriodType === 'monthly' ? new Date(normalizedDate.getFullYear(), normalizedDate.getMonth() + 1, 0)
              : reportPeriodType === 'yearly' ? new Date(normalizedDate.getFullYear(), 11, 31) : periodEnd;
            const entry = await tx.productionEntry.create({
              data: {
                campaignId: targetCampaignId, date: normalizedDate, time: new Date().toLocaleTimeString(), createdBy: user.id,
                reportPeriodType, periodStart: entryPeriodStart, periodEnd: entryPeriodEnd,
              },
            });
            savedEntryId = entry.id;
            createdEntryIds.add(entry.id);
            entryByCampaignDate.set(entryKey, entry.id);
          }
          if (missingMetrics.length && !existingDetail && existingForRow.length === 0 && savedEntryId) {
            const detail = await tx.productionDetail.create({
              data: { productionEntryId: savedEntryId, agentId: agent.id, campaignId: targetCampaignId, ...buildDetailDataForWrite(row, row.metricType || metricType, false) },
              select: { id: true, productionEntryId: true },
            });
            storedDetailByKey.set(detailKey, detail);
            insertedLegacyDetails++;
          }
          for (const metric of missingMetrics) {
            const key = normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType);
            normalizedRecords.push({
              productionEntryId: savedEntryId!,
              campaignId: targetCampaignId,
              agentId: agent.id,
              reportPeriodType,
              reportDate: normalizedDate,
              reportMonth: reportPeriodType === 'yearly' ? null : normalizedDate.getMonth() + 1,
              reportYear: normalizedDate.getFullYear(),
              metricType: metric.metricType,
              count: metric.count == null ? null : BigInt(Math.round(metric.count)),
              volume: metric.volume == null ? null : BigInt(Math.round(metric.volume)),
              goal: metric.goal ?? null,
              actual: metric.actual ?? null,
              achievement: metric.achievement ?? null,
              sourceFile: file.name,
              sourceSheet: row.sourceSheet || '',
              sourceRow: row.rowIdx,
            });
            storedMetricByKey.set(key, { productionEntryId: savedEntryId, pending: true });
            rowChanged = true;
          }

          if (rowChanged) {
            results.success++;
            results.details.push(detailResponse({ ...row, reportDate: normalizedDate }, agent.name, row.metricType || metricType));
          }
        } catch (rowError) {
          throw new Error(`${row.sourceSheet} row ${row.rowIdx}: Database write failed.`, { cause: rowError });
        }
      }

      const normalizedInsert = normalizedRecords.length
        ? await tx.productionMetricRecord.createMany({ data: normalizedRecords, skipDuplicates: true })
        : { count: 0 };
      skippedRecords += normalizedRecords.length - normalizedInsert.count;

      const auditLog = {
        fileName: file.name,
        importingUser: user.id,
        importedAt: new Date().toISOString(),
        selectedCampaigns: selectedCampaigns.map((campaign) => campaign.id),
        selectedMetric: metricType,
        selectedReportDate: ymd(reportDate),
        workbookSheetNames: workbook.SheetNames,
        perSheetResult: selectedSheets.map(({ entries: _entries, matched: _matched, notFound: _notFound, ...sheet }) => sheet),
        insertedRecords: normalizedInsert.count,
        enrichedRecords,
        insertedLegacyDetails,
        normalizedRecords: normalizedInsert.count,
        skippedRecords: skippedRecords + preview.workbookSummary.totalDuplicateRecords,
        invalidRecords: preview.workbookSummary.totalInvalidRecords,
        errorSummary: results.errors.slice(0, 50),
      };
      for (const entryId of createdEntryIds) {
        await saveImportMetadata(entryId, file.name, metricType, sheetNames, auditLog, tx);
      }

      results.details.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.agent.localeCompare(b.agent));

      return {
        message: `Import completed for ${targetCampaignIds.length} campaign${targetCampaignIds.length === 1 ? '' : 's'}: inserted ${normalizedInsert.count}, skipped ${skippedRecords + preview.workbookSummary.totalDuplicateRecords}, and found ${preview.workbookSummary.totalInvalidRecords + results.errors.length} invalid record(s).`,
        importedCampaignIds: targetCampaignIds,
        importedCampaigns: targetCampaignIds.length,
        workbookSummary: preview.workbookSummary,
        worksheetPreviews: selectedSheets.map(({ entries: _entries, matched: _matched, notFound: _notFound, ...sheet }) => sheet),
        inserted: normalizedInsert.count,
        updated: enrichedRecords,
        skipped: skippedRecords + preview.workbookSummary.totalDuplicateRecords,
        invalid: preview.workbookSummary.totalInvalidRecords + results.errors.length,
        insertedLegacyDetails,
        normalizedImported: normalizedInsert.count,
        normalizedDuplicates: skippedRecords + preview.workbookSummary.totalDuplicateRecords,
        ...results,
      };
      }, { timeout: 120000 });
      return NextResponse.json(importPayload);
    }
    if (!isExcel && !isCsv) {
      return NextResponse.json({ error: 'Only .xlsx, .xls, and .csv files are supported.' }, { status: 400 });
    }

    // ─── EXCEL PATH ───────────────────────────────────────────────────────────
    if (isExcel) {
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        return NextResponse.json({ error: 'No sheet found in Excel file' }, { status: 400 });
      }

      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 } as any);

      if (rows.length < 3) {
        return NextResponse.json({ error: 'Excel file has insufficient rows' }, { status: 400 });
      }

      const entries = parseExcelRows(rows, metricType, campaignName);
      if (entries.length === 0) {
        return NextResponse.json(
          {
            error:
              'No production rows found. Check that required columns exist: FULL NAME or LAST NAME/FIRST NAME plus COUNT, TRANSMITTED, APPROVALS, BOOKED, VOLUME, NTB, or SUPPLEMENTARY.',
          },
          { status: 400 }
        );
      }

      // ── PREVIEW MODE: classify agents, no DB writes ──────────────────────
      if (mode === 'preview') {
        const matched: any[] = [];
        const notFound: any[] = [];

        for (const entry of entries) {
          const agent = findExistingAgent(entry.name);

          const baseData: any = { name: entry.name, count: entry.count, volume: entry.volume };
          if (metricType === 'all_metrics') {
            baseData.transmittals = entry.transmittals;
            baseData.approvals = entry.approvals;
            baseData.booked = entry.booked;
          }
          if (entry.ntb !== undefined || entry.seatCategory !== undefined) {
            baseData.ntb = entry.ntb ?? 0;
            baseData.supplementary = entry.supplementary ?? 0;
            baseData.seatCategory = entry.seatCategory ?? '';
          }

          if (agent) {
            matched.push({ ...baseData, agentId: agent.id, agentName: agent.name });
          } else {
            notFound.push(baseData);
          }
        }

        // Sort by volume descending, then by count/metrics descending
        matched.sort((a, b) => {
          if (b.volume !== a.volume) return b.volume - a.volume;
          return b.count - a.count;
        });
        notFound.sort((a, b) => {
          if (b.volume !== a.volume) return b.volume - a.volume;
          return b.count - a.count;
        });

        return NextResponse.json({ preview: true, matched, notFound, metricType, reportDate });
      }

      // ── IMPORT MODE ──────────────────────────────────────────────────────
      const confirmedNewAgents: string[] = JSON.parse(
        (formData.get('confirmedNewAgents') as string) || '[]'
      );

      // Create any confirmed new agents
      const createdAgents: Record<string, string> = {}; // name → id
      for (const name of confirmedNewAgents) {
        const existing = findExistingAgent(name);
        if (existing) {
          createdAgents[name] = existing.id;
          continue;
        }

        const email = nameToEmail(name);
        const password = await bcrypt.hash(crypto.randomUUID(), 10);
        const newAgent = await prisma.user.create({
          data: {
            name,
            email,
            password,
            role: 'AGENT',
            campaignId: effectiveCampaignId,
          },
        });
        createdAgents[name] = newAgent.id;
        rememberAgent({ id: newAgent.id, name: newAgent.name });
      }

      const results = {
        success: 0,
        created: confirmedNewAgents.length,
        errors: [] as string[],
        details: [] as any[],
      };

      // Create one ProductionEntry for the batch
      const entry = await prisma.productionEntry.create({
        data: {
          campaignId: effectiveCampaignId,
          date: reportDate,
          time: new Date().toLocaleTimeString(),
          createdBy: user.id,
          reportPeriodType,
          periodStart,
          periodEnd,
        },
      });
      await saveImportMetadata(entry.id, file.name, metricType);

      for (const row of entries) {
        try {
          let agent = findExistingAgent(row.name);

          // Use newly created agent if available
          if (!agent && createdAgents[row.name]) {
            agent = await prisma.user.findUnique({
              where: { id: createdAgents[row.name] },
              select: { id: true, name: true },
            });
          }

          if (!agent) {
            results.errors.push(`Row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
            continue;
          }

          const metricData = buildDetailData(row, metricType);

          const existingDetail = await prisma.productionDetail.findUnique({
            where: {
              productionEntryId_agentId: {
                productionEntryId: entry.id,
                agentId: agent.id,
              },
            },
          });

          if (existingDetail) {
            await prisma.productionDetail.update({
              where: { id: existingDetail.id },
              data: metricData,
            });
          } else {
            await prisma.productionDetail.create({
              data: {
                productionEntryId: entry.id,
                agentId: agent.id,
                campaignId: effectiveCampaignId,
                ...metricData,
              },
            });
          }

          results.success++;
          const detail: any = {
            row: row.rowIdx,
            agent: agent.name,
            date: reportDate.toLocaleDateString(),
            volume: row.volume,
          };
          if (metricType === 'all_metrics') {
            detail.transmittals = row.transmittals;
            detail.approvals = row.approvals;
            detail.booked = row.booked;
          } else {
            detail[metricType] = row.count;
          }
          if (row.ntb !== undefined) {
            detail.ntb = row.ntb;
            detail.supplementary = row.supplementary;
            detail.seatCategory = row.seatCategory;
          }
          results.details.push(detail);
        } catch (rowError: any) {
          results.errors.push(`Row ${row.rowIdx}: ${rowError.message}`);
        }
      }

      // Sort results by volume descending, then by the primary metric
      results.details.sort((a, b) => {
        if (b.volume !== a.volume) return b.volume - a.volume;
        const aMetric = metricType === 'all_metrics' ? a.transmittals : a[metricType] || a.count || 0;
        const bMetric = metricType === 'all_metrics' ? b.transmittals : b[metricType] || b.count || 0;
        return bMetric - aMetric;
      });

      return NextResponse.json({
        message: `Imported ${results.success} records. ${results.created} new agent(s) created.`,
        ...results,
      });
    }

    // ─── CSV PATH — same BPI PA column format as Excel ───────────────────────
    const text = await file.text();
    const lines = text.trim().split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
    }

    // Convert CSV text to 2D array and reuse the same Excel parser
    const csvRows = lines.map(line =>
      line.split(',').map(cell => {
        const v = cell.trim().replace(/^"|"$/g, '');
        const n = Number(v);
        return v === '' ? null : isNaN(n) ? v : n;
      })
    );

    const csvSheetName = file.name.replace(/[\r\n\t]/g, ' ').slice(0, 80) || 'CSV';
    const csvWorkbook = {
      SheetNames: [csvSheetName],
      Sheets: { [csvSheetName]: XLSX.utils.aoa_to_sheet(csvRows) },
    } as XLSX.WorkBook;
    const csvPreview = await buildWorkbookPreview({
      workbook: csvWorkbook,
      selectedCampaigns,
      metricType,
      selectedReportDate: reportDate,
      reportPeriodType,
    });
    const csvEntries = csvPreview.sheets.flatMap((sheet) => sheet.entries)
      .sort((a, b) => (a.reportDate?.getTime() || 0) - (b.reportDate?.getTime() || 0) || a.rowIdx - b.rowIdx);

    if (csvEntries.length === 0) {
      return NextResponse.json({ error: 'No data rows found. Check that your CSV matches the BPI PA template format.' }, { status: 400 });
    }

    // Preview mode for CSV
    if (mode === 'preview') {
      return NextResponse.json({
        preview: true,
        matched: csvPreview.matched,
        notFound: csvPreview.notFound,
        previewRecords: csvPreview.previewRecords,
        monthSummary: csvPreview.monthSummary,
        detectedRange: csvPreview.detectedRange,
        workbookSummary: csvPreview.workbookSummary,
        worksheetPreviews: csvPreview.sheets.map(({ entries, ...sheet }) => sheet),
        metricType,
        reportPeriodType,
        reportDate: ymd(reportDate),
      });
    }

    // Import mode for CSV
    const csvCampaignMappings: Record<string, string> = JSON.parse((formData.get('campaignMappings') as string) || '{}');
    const csvSheetPreview = csvPreview.sheets[0];
    const csvTargetCampaignId = csvCampaignMappings[csvSheetPreview.key] || (csvSheetPreview.campaignMapping === 'unresolved' ? '' : csvSheetPreview.campaignId);
    if (!csvTargetCampaignId || !selectedCampaigns.some((campaign) => campaign.id === csvTargetCampaignId)) {
      return NextResponse.json({ error: 'The CSV could not be matched automatically. Please review the campaign mapping.' }, { status: 400 });
    }
    const csvCampaignAgents = await prisma.user.findMany({ where: { campaignId: csvTargetCampaignId, role: 'AGENT' }, select: { id: true, name: true } });
    const findCsvAgent = (name: string) => csvCampaignAgents.find((agent) => agentNameMatches(agent.name, name)) || null;
    const csvImportPayload = await prisma.$transaction(async (tx) => {
    const confirmedNewAgentsCsv: string[] = JSON.parse(
      (formData.get('confirmedNewAgents') as string) || '[]'
    );

    const createdAgentsCsv: Record<string, string> = {};
    for (const name of confirmedNewAgentsCsv) {
      const existing = findCsvAgent(name);
      if (existing) { createdAgentsCsv[name] = existing.id; continue; }

      const email = nameToEmail(name);
      const password = await bcrypt.hash(crypto.randomUUID(), 10);
      const newAgent = await tx.user.create({
        data: { name, email, password, role: 'AGENT', campaignId: csvTargetCampaignId },
      });
      createdAgentsCsv[name] = newAgent.id;
      csvCampaignAgents.push({ id: newAgent.id, name: newAgent.name });
    }

    const csvResults = {
      success: 0,
      created: confirmedNewAgentsCsv.length,
      errors: [] as string[],
      details: [] as any[],
    };

    const normalizedCsvRecords: any[] = [];
    const csvEntryByDate = new Map<string, string>();
    const csvCreatedEntryIds = new Set<string>();
    let csvEnriched = 0;
    let csvSkipped = 0;
    const csvDates = csvEntries.map((row) => normalizePeriodDate(row.reportDate || reportDate, reportPeriodType));
    const csvEarliest = new Date(Math.min(...csvDates.map((date) => date.getTime())));
    const csvLatest = new Date(Math.max(...csvDates.map((date) => date.getTime())));
    const csvAgentIds = csvCampaignAgents.map((agent) => agent.id);
    const [csvStoredMetrics, csvStoredDetails] = await Promise.all([
      tx.productionMetricRecord.findMany({
        where: { campaignId: csvTargetCampaignId, agentId: { in: csvAgentIds }, reportPeriodType, reportDate: { gte: csvEarliest, lte: csvLatest } },
        select: { id: true, productionEntryId: true, campaignId: true, agentId: true, metricType: true, reportDate: true, count: true, volume: true, goal: true, actual: true, achievement: true },
      }),
      tx.productionDetail.findMany({
        where: { campaignId: csvTargetCampaignId, agentId: { in: csvAgentIds }, productionEntry: { date: { gte: new Date(csvEarliest.getFullYear(), csvEarliest.getMonth(), 1), lte: new Date(csvLatest.getFullYear(), csvLatest.getMonth() + 1, 0) } } },
        select: {
          id: true, productionEntryId: true, campaignId: true, agentId: true,
          transmittals: true, approvals: true, booked: true, activations: true, ntb: true, supplementary: true,
          monthlyGoal: true, monthlyActual: true, monthlyAchievement: true,
          productionEntry: { select: { date: true, reportPeriodType: true, importMetricType: true } },
        },
      }),
    ]);
    const csvMetricByKey = new Map<string, any>(csvStoredMetrics.map((record) => [normalizedMetricKey(record.campaignId, record.agentId, record.metricType, record.reportDate, reportPeriodType), record]));
    const csvDetailByKey = new Map<string, any>();
    for (const detail of csvStoredDetails) {
      if (detail.productionEntry.reportPeriodType !== reportPeriodType) continue;
      const date = normalizePeriodDate(detail.productionEntry.date, reportPeriodType);
      const detailKey = `${detail.campaignId}|${detail.agentId}|${ymd(date)}`;
      if (!csvDetailByKey.has(detailKey)) csvDetailByKey.set(detailKey, detail);
      for (const type of legacyMetricTypes(detail)) {
        const key = normalizedMetricKey(detail.campaignId, detail.agentId, type, date, reportPeriodType);
        if (!csvMetricByKey.has(key)) csvMetricByKey.set(key, { productionEntryId: detail.productionEntryId, legacy: true });
      }
    }

    for (const row of csvEntries) {
      try {
        let agent = findCsvAgent(row.name);
        if (!agent && createdAgentsCsv[row.name]) {
          agent = await tx.user.findUnique({ where: { id: createdAgentsCsv[row.name] }, select: { id: true, name: true } });
        }
        if (!agent) {
          csvResults.errors.push(`Row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
          continue;
        }

        const normalizedDate = normalizePeriodDate(row.reportDate || reportDate, reportPeriodType);
        const metrics = expandEntryMetrics(row);
        const existingForRow = metrics.map((metric) => csvMetricByKey.get(normalizedMetricKey(csvTargetCampaignId, agent!.id, metric.metricType, normalizedDate, reportPeriodType))).filter(Boolean);
        let rowChanged = false;
        for (const metric of metrics) {
          const key = normalizedMetricKey(csvTargetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType);
          const existing = csvMetricByKey.get(key);
          if (!existing) continue;
          const enrichment: Record<string, any> = {};
          if (existing.id) {
            if (existing.count == null && metric.count != null) enrichment.count = BigInt(Math.round(metric.count));
            if (existing.volume == null && metric.volume != null) enrichment.volume = BigInt(Math.round(metric.volume));
            if (existing.goal == null && metric.goal != null) enrichment.goal = metric.goal;
            if (existing.actual == null && metric.actual != null) enrichment.actual = metric.actual;
            if (existing.achievement == null && metric.achievement != null) enrichment.achievement = metric.achievement;
          }
          if (Object.keys(enrichment).length) {
            await tx.productionMetricRecord.update({ where: { id: existing.id }, data: enrichment });
            Object.assign(existing, enrichment);
            csvEnriched++;
            rowChanged = true;
          } else csvSkipped++;
        }
        const missingMetrics = metrics.filter((metric) => !csvMetricByKey.has(normalizedMetricKey(csvTargetCampaignId, agent!.id, metric.metricType, normalizedDate, reportPeriodType)));
        const detailKey = `${csvTargetCampaignId}|${agent.id}|${ymd(normalizedDate)}`;
        const existingDetail = csvDetailByKey.get(detailKey);
        let savedEntryId = existingForRow.find((record) => record.productionEntryId)?.productionEntryId || existingDetail?.productionEntryId || csvEntryByDate.get(ymd(normalizedDate));
        if (missingMetrics.length && !savedEntryId) {
          const entry = await tx.productionEntry.create({
            data: {
              campaignId: csvTargetCampaignId, date: normalizedDate, time: new Date().toLocaleTimeString(), createdBy: user.id, reportPeriodType,
              periodStart: reportPeriodType === 'daily' ? periodStart : normalizedDate,
              periodEnd: reportPeriodType === 'monthly' ? new Date(normalizedDate.getFullYear(), normalizedDate.getMonth() + 1, 0) : reportPeriodType === 'yearly' ? new Date(normalizedDate.getFullYear(), 11, 31) : periodEnd,
            },
          });
          savedEntryId = entry.id;
          csvEntryByDate.set(ymd(normalizedDate), entry.id);
          csvCreatedEntryIds.add(entry.id);
        }
        if (missingMetrics.length && !existingDetail && existingForRow.length === 0 && savedEntryId) {
          const detail = await tx.productionDetail.create({
            data: { productionEntryId: savedEntryId, agentId: agent.id, campaignId: csvTargetCampaignId, ...buildDetailDataForWrite(row, row.metricType || metricType, false) },
            select: { id: true, productionEntryId: true },
          });
          csvDetailByKey.set(detailKey, detail);
        }
        for (const metric of missingMetrics) {
          const key = normalizedMetricKey(csvTargetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType);
          normalizedCsvRecords.push({
            productionEntryId: savedEntryId!, campaignId: csvTargetCampaignId, agentId: agent.id,
            reportPeriodType, reportDate: normalizedDate,
            reportMonth: reportPeriodType === 'yearly' ? null : normalizedDate.getMonth() + 1,
            reportYear: normalizedDate.getFullYear(), metricType: metric.metricType,
            count: metric.count == null ? null : BigInt(Math.round(metric.count)),
            volume: metric.volume == null ? null : BigInt(Math.round(metric.volume)),
            goal: metric.goal ?? null, actual: metric.actual ?? null, achievement: metric.achievement ?? null,
            sourceFile: file.name, sourceSheet: row.sourceSheet || 'CSV', sourceRow: row.rowIdx,
          });
          csvMetricByKey.set(key, { productionEntryId: savedEntryId, pending: true });
          rowChanged = true;
        }
        if (rowChanged) {
          csvResults.success++;
          csvResults.details.push(detailResponse({ ...row, reportDate: normalizedDate }, agent.name, row.metricType || metricType));
        }
      } catch (rowError) {
        throw new Error(`Row ${row.rowIdx}: Database write failed.`, { cause: rowError });
      }
    }
    const normalizedCsvInsert = normalizedCsvRecords.length
      ? await tx.productionMetricRecord.createMany({ data: normalizedCsvRecords, skipDuplicates: true })
      : { count: 0 };
    csvSkipped += normalizedCsvRecords.length - normalizedCsvInsert.count;
    for (const entryId of csvCreatedEntryIds) await saveImportMetadata(entryId, file.name, metricType, [csvSheetName], undefined, tx);

    csvResults.details.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.agent.localeCompare(b.agent));

    return {
      message: `Import completed for 1 campaign: inserted ${normalizedCsvInsert.count}, skipped ${csvSkipped + csvPreview.workbookSummary.totalDuplicateRecords}, and found ${csvPreview.workbookSummary.totalInvalidRecords + csvResults.errors.length} invalid record(s).`,
      importedCampaignIds: [csvTargetCampaignId],
      importedCampaigns: 1,
      inserted: normalizedCsvInsert.count,
      updated: csvEnriched,
      skipped: csvSkipped + csvPreview.workbookSummary.totalDuplicateRecords,
      invalid: csvPreview.workbookSummary.totalInvalidRecords + csvResults.errors.length,
      normalizedImported: normalizedCsvInsert.count,
      normalizedDuplicates: csvSkipped + csvPreview.workbookSummary.totalDuplicateRecords,
      ...csvResults,
    };
    }, { timeout: 120000 });
    return NextResponse.json(csvImportPayload);
  } catch (error) {
    console.error('Bulk import error:', error);
    return NextResponse.json({ error: 'Import failed. No records were saved.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can delete bulk imports' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get('entryId');
    if (!entryId) {
      return NextResponse.json({ error: 'Import id is required' }, { status: 400 });
    }

    const entry = await prisma.productionEntry.findFirst({
      where: { id: entryId, createdBy: user.id },
      select: { id: true },
    });
    if (!entry) {
      const deleted = await prisma.$executeRaw`DELETE FROM "DashboardImportBatch" WHERE id = ${entryId} AND "importedById" = ${user.id}`;
      if (!deleted) return NextResponse.json({ error: 'Import file not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }

    await prisma.$transaction([
      prisma.productionDetail.deleteMany({ where: { productionEntryId: entryId } }),
      prisma.productionEntry.deleteMany({ where: { id: entryId, createdBy: user.id } }),
    ]);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Bulk import delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
